import { execFileSync } from 'node:child_process';
import { acquireWriterLease, inspectWriterLease, checkoutIdentity, LeaseRefused } from './writer-leases.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fixture, repo, stepFile, id } from './workflow-test-fixture.js';
import { assertPrepared, releaseStoppedPreparation, sha256, withPreparedActivity } from './workflow-preparation.js';
import { cancelWorkflow, inspectWorkflow, prepareWorkflow, executeWorkflowTest } from './index.js';
import type { CoreContext, ExecutionPort, LifecyclePort, Result } from './contracts.js';

async function setup(lifecycle?: LifecyclePort, execution?: ExecutionPort) {
  const r = repo();
  const mapping = { schemaVersion: 1, workflow: 'plan-step', criteria: [{ sourcePath: stepFile, sourceDigest: sha256(fs.readFileSync(path.join(r.cwd, stepFile))), criterionIndex: 1, evidence: 'test', testRequirements: [{ suiteId: 'workflow-suite', format: 'node-tap-v13' }] }] };
  const p = await fixture('plan-step', '# Contract\n\n## Procedure\n\n```specplane-test-requirements\n' + JSON.stringify(mapping) + '\n```\n');
  const context: CoreContext = { checkout: r.cwd, extensionId: p.host.extensionId, compatibility: { manifest: p.manifest, host: p.host }, lifecycle, execution };
  const initiation = { protocol: 1, workflow: 'plan-step', extensionId: context.extensionId, checkout: r.cwd, mode: 'attended', selection: { planId: id } } as const;
  const prepared = await prepareWorkflow(initiation, context);
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  if (!prepared.ok) throw new Error('Preparation failed');
  const requestId = prepared.value.requestId;
  return { ...r, p, context, initiation, prepared: prepared.value, requestId, close: () => releaseStoppedPreparation(requestId) };
}
function code(result: Result<unknown>, expected: string): void {
  assert.equal(result.ok, false, JSON.stringify(result));
  if (!result.ok) assert.equal(result.error.code, expected, JSON.stringify(result));
}
const stopped: LifecyclePort = { stopWorkflow: async () => ({ stopped: true, recoveryRequired: false }) };

test('inspection observes current revision after stale inputs without exposing private state; cancellation preserves partial edits', async () => {
  const f = await setup(stopped);
  try {
    f.put('source.ts', 'partial implementation');
    f.put('.specplane/config.yaml', fs.readFileSync(path.join(f.cwd, '.specplane/config.yaml'), 'utf8') + '# changed policy\n');
    f.git('commit', '-am', 'external state change');
    f.put('untracked.txt', 'preserve');
    const observed = inspectWorkflow(f.requestId, { ...f.context, signal: AbortSignal.abort() });
    assert.equal(observed.ok, true, JSON.stringify(observed));
    if (observed.ok) {
      assert.equal(observed.value.observed.head, f.git('rev-parse', 'HEAD'));
      assert.equal(observed.value.recording, null);
      assert.deepEqual(Object.keys(observed.value).sort(), ['cancellation', 'checkout', 'lease', 'observed', 'phase', 'recording', 'requestId', 'workflow']);
    }
    const cancelled = await cancelWorkflow(f.requestId, f.context);
    assert.equal(cancelled.ok, true, JSON.stringify(cancelled));
    if (cancelled.ok) { assert.equal(cancelled.value.lease, 'released'); assert.equal(cancelled.value.cancellation, 'stopped'); }
    assert.equal(fs.readFileSync(path.join(f.cwd, 'untracked.txt'), 'utf8'), 'preserve');
    assert.equal(fs.readFileSync(path.join(f.cwd, 'source.ts'), 'utf8'), 'partial implementation');
    assert.equal(inspectWorkflow(f.requestId, f.context).ok, true);
    assert.equal((await cancelWorkflow(f.requestId, f.context)).ok, true);
    await assert.rejects(assertPrepared(f.requestId, f.context), /cancelled/);
  } finally { f.close(); }
});

test('owner/checkout checks refuse before stopping; unknown workflows do not infer dead workers', async () => {
  let stops = 0;
  const f = await setup({ stopWorkflow: async () => { stops++; return { stopped: true, recoveryRequired: false }; } });
  try {
    for (const context of [{ ...f.context, extensionId: 'other' }, { ...f.context, checkout: f.p.root }]) {
      code(inspectWorkflow(f.requestId, context), 'STALE_STATE');
      code(await cancelWorkflow(f.requestId, context), 'STALE_STATE');
    }
    code(inspectWorkflow('unknown-process', f.context), 'STALE_STATE');
    code(await cancelWorkflow('unknown-process', f.context), 'STALE_STATE');
    code(await cancelWorkflow('', f.context), 'INVALID_EVIDENCE');
    assert.equal(stops, 0);
    await assertPrepared(f.requestId, f.context);
  } finally { f.close(); }
});

test('missing, false, uncertain and throwing stopped acknowledgments retain cancellation and lease', async () => {
  for (const lifecycle of [undefined, { stopWorkflow: async () => ({ stopped: false, recoveryRequired: false }) }, { stopWorkflow: async () => ({ stopped: true, recoveryRequired: true }) }, { stopWorkflow: async () => { throw new Error('host unavailable'); } }]) {
    const f = await setup(lifecycle);
    try {
      code(await cancelWorkflow(f.requestId, f.context), 'RECOVERY_REQUIRED');
      const observed = inspectWorkflow(f.requestId, f.context);
      assert.equal(observed.ok, true);
      if (observed.ok) { assert.equal(observed.value.lease, 'held'); assert.equal(observed.value.cancellation, 'requested'); }
      code(await prepareWorkflow(f.initiation, f.context), 'LOCKED');
      await assert.rejects(assertPrepared(f.requestId, f.context), /cancelled/);
    } finally { f.close(); }
  }
});

test('cancellation uses preparation-bound host method and reserves against concurrent cancellation', async () => {
  let acknowledge!: () => void;
  let began!: () => void;
  const started = new Promise<void>(resolve => began = resolve);
  const gate = new Promise<void>(resolve => acknowledge = resolve);
  let originalCalls = 0;
  const port: LifecyclePort = { stopWorkflow: async request => { originalCalls++; assert.equal(request.checkout, f.cwd); assert.equal(request.requestId, f.requestId); began(); await gate; return { stopped: true, recoveryRequired: false }; } };
  const f = await setup(port);
  try {
    port.stopWorkflow = async () => { throw new Error('replacement must not run'); };
    const callerContext = { ...f.context, lifecycle: stopped };
    const pending = cancelWorkflow(f.requestId, callerContext);
    await started;
    callerContext.extensionId = 'mutated-after-dispatch';
    callerContext.checkout = f.p.root;
    code(await cancelWorkflow(f.requestId, f.context), 'LOCKED');
    acknowledge();
    assert.equal((await pending).ok, true);
    assert.equal(originalCalls, 1);
    assert.equal((await cancelWorkflow(f.requestId, f.context)).ok, true);
    assert.equal(originalCalls, 1);
  } finally { acknowledge(); f.close(); }
});

test('acknowledgment cannot release a workflow with any active core phase', async () => {
  for (const phase of ['execution', 'validation', 'recording'] as const) {
    const f = await setup(stopped);
    let finish!: () => void;
    const gate = new Promise<void>(resolve => finish = resolve);
    const pending = withPreparedActivity(f.requestId, phase, () => gate);
    try {
      code(await cancelWorkflow(f.requestId, f.context), 'RECOVERY_REQUIRED');
      const inspection = inspectWorkflow(f.requestId, f.context);
      assert.equal(inspection.ok, true);
      if (inspection.ok) { assert.equal(inspection.value.phase, phase); assert.equal(inspection.value.lease, 'held'); }
      finish(); await pending;
      assert.equal((await cancelWorkflow(f.requestId, f.context)).ok, true);
    } finally { finish(); await pending; f.close(); }
  }
});

test('public cancellation propagates into running execution and blocks later dispatch until explicit acknowledgment', async () => {
  let began!: () => void;
  const started = new Promise<void>(resolve => began = resolve);
  let releaseExecution!: () => void;
  const gate = new Promise<void>(resolve => releaseExecution = resolve);
  let executionStopped = false;
  const f = await setup({ stopWorkflow: async () => ({ stopped: executionStopped, recoveryRequired: !executionStopped }) }, { execute: async request => {
    began();
    await new Promise<void>(resolve => request.signal!.addEventListener('abort', () => resolve(), { once: true }));
    await gate;
    executionStopped = true;
    throw new Error('stopped');
  } });
  const request = { requestId: f.requestId, criterionIds: [f.prepared.criteria[0].id], executable: 'node', args: [], reportFormat: 'node-tap-v13' } as const;
  try {
    const execution = executeWorkflowTest({ ...request, args: [], criterionIds: [...request.criterionIds] }, f.context);
    await started;
    code(await cancelWorkflow(f.requestId, f.context), 'RECOVERY_REQUIRED');
    releaseExecution();
    code(await execution, 'CANCELLED');
    code(await executeWorkflowTest({ ...request, args: [], criterionIds: [...request.criterionIds] }, f.context), 'CANCELLED');
    assert.equal((await cancelWorkflow(f.requestId, f.context)).ok, true);
    const next = await prepareWorkflow(f.initiation, f.context);
    assert.equal(next.ok, true, JSON.stringify(next));
    if (next.ok) releaseStoppedPreparation(next.value.requestId);
  } finally { releaseExecution(); f.close(); }
});


test('host stop method is bound before asynchronous preparation can yield', async () => {
  const r = repo(), p = await fixture('validate');
  let calls = 0;
  const lifecycle: LifecyclePort = { stopWorkflow: async () => { calls++; return { stopped: true, recoveryRequired: false }; } };
  const context: CoreContext = { checkout: r.cwd, extensionId: p.host.extensionId, compatibility: { manifest: p.manifest, host: p.host }, lifecycle };
  const pending = prepareWorkflow({ protocol: 1, workflow: 'validate', extensionId: context.extensionId, checkout: r.cwd, mode: 'attended', selection: { specIds: [], input: 'Inspect repository' } }, context);
  lifecycle.stopWorkflow = async () => { throw new Error('late replacement'); };
  const prepared = await pending;
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  if (!prepared.ok) return;
  try { assert.equal((await cancelWorkflow(prepared.value.requestId, context)).ok, true); assert.equal(calls, 1); }
  finally { releaseStoppedPreparation(prepared.value.requestId); }
});


test('prepared host evidence survives owner exit and prevents another process reclaiming any writer key', async () => {
  const r = repo(), p = await fixture('plan-step');
  const context: CoreContext = { checkout: r.cwd, extensionId: p.host.extensionId, compatibility: { manifest: p.manifest, host: p.host } };
  const initiation = { protocol: 1, workflow: 'plan-step', extensionId: context.extensionId, checkout: r.cwd, mode: 'attended', selection: { planId: id } };
  const script = `import { prepareWorkflow } from ${JSON.stringify(new URL('./index.js', import.meta.url).href)};
    const { initiation, context } = JSON.parse(process.argv[1]);
    const result = await prepareWorkflow(initiation, context);
    if (!result.ok) throw new Error(JSON.stringify(result));
    console.log(result.value.requestId);`;
  const requestId = execFileSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify({ initiation, context })], { encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: '' } }).trim();
  r.put('partial.txt', 'preserve after owner exit');
  const runtime = path.join(checkoutIdentity(r.cwd).commonDir, 'specplane-runtime');
  const before = Object.fromEntries(fs.readdirSync(runtime).map(name => [name, fs.readFileSync(path.join(runtime, name), 'utf8')]));
  assert.equal(Object.keys(before).filter(name => name.startsWith('host-')).length, 1);
  const recovery = (error: unknown) => error instanceof LeaseRefused && error.code === 'RECOVERY_REQUIRED' && /host worker evidence/.test(error.message);
  for (const request of [
    { checkouts: [r.cwd], requestId: 'checkout-only' },
    { checkouts: [r.cwd], plans: [id], requestId: 'plan' },
    { checkouts: [r.cwd], repository: true, requestId: 'repository' },
  ]) {
    assert.throws(() => inspectWriterLease(request), recovery);
    assert.throws(() => acquireWriterLease(request), recovery);
  }
  code(inspectWorkflow(requestId, context), 'STALE_STATE');
  code(await cancelWorkflow(requestId, { ...context, lifecycle: stopped }), 'STALE_STATE');
  const refused = await prepareWorkflow(initiation as Parameters<typeof prepareWorkflow>[0], context);
  code(refused, 'RECOVERY_REQUIRED');
  assert.deepEqual(Object.fromEntries(fs.readdirSync(runtime).map(name => [name, fs.readFileSync(path.join(runtime, name), 'utf8')])), before);
  assert.equal(fs.readFileSync(path.join(r.cwd, 'partial.txt'), 'utf8'), 'preserve after owner exit');
});
