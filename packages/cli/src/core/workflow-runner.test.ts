import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fixture, repo, stepFile, id } from './workflow-test-fixture.js';
import { sha256, releaseStoppedPreparation } from './workflow-preparation.js';
import { inspectWorkflow as inspectCore } from './workflow-lifecycle.js';
import { createWorkflowRunner, parseServeArgs, type RunnerResponse } from './workflow-runner.js';
import type { ExecutionPort } from './contracts.js';
import { selectCodexWorkflowChannel } from '../harness/codex-channel.js';

function queue() {
  const chunks: (string | Uint8Array)[] = []; let wake: (() => void) | undefined; let done = false;
  return {
    push(c: string | Uint8Array) { chunks.push(c); wake?.(); },
    end() { done = true; wake?.(); },
    async *[Symbol.asyncIterator]() { for (;;) { if (chunks.length) { yield chunks.shift()!; continue; } if (done) return; await new Promise<void>(r => wake = r); wake = undefined; } },
  };
}
async function setup(execution?: ExecutionPort, extra: { stopTimeoutMs?: number } = {}) {
  const r = repo();
  const mapping = { schemaVersion: 1, workflow: 'plan-step', criteria: [{ sourcePath: stepFile, sourceDigest: sha256(fs.readFileSync(path.join(r.cwd, stepFile))), criterionIndex: 1, evidence: 'test', testRequirements: [{ suiteId: 'workflow-suite', format: 'node-tap-v13' }] }] };
  const p = await fixture('plan-step', '# Contract\n\n## Procedure\n\n```specplane-test-requirements\n' + JSON.stringify(mapping) + '\n```\n');
  const runner = createWorkflowRunner({ checkout: r.cwd, extensionId: p.host.extensionId, compatibilityFor: () => ({ manifest: p.manifest, host: p.host }), execution, ...extra });
  const input = queue(); const out: RunnerResponse[] = []; const diag: string[] = [];
  const exit = runner.serve({ input, write: l => out.push(JSON.parse(l)), diagnostic: t => diag.push(t) });
  const send = (o: unknown) => input.push(JSON.stringify(o) + '\n');
  const reply = async (n: number) => { for (let i = 0; i < 400 && out.length < n; i++) await new Promise(r => setTimeout(r, 10)); return out[n - 1]; };
  return { ...r, p, runner, input, out, diag, exit, send, reply };
}
const initiation = (f: { cwd: string; p: { host: { extensionId: string } } }) => ({ protocol: 1, workflow: 'plan-step', extensionId: f.p.host.extensionId, checkout: f.cwd, mode: 'attended', selection: { planId: id } });
const tap = new TextEncoder().encode('TAP version 13\n1..1\nok 1 - runs\n');
const passing: ExecutionPort = { execute: async r => ({ executable: process.execPath, exitCode: 0, signal: null, stdout: tap, stderr: new Uint8Array() }) };
async function prepared(f: Awaited<ReturnType<typeof setup>>) {
  f.send({ id: 'p', method: 'prepare', params: initiation(f) });
  const r = await f.reply(1);
  assert.equal(r.result.ok, true, JSON.stringify(r));
  if (!r.result.ok) throw new Error('prepare');
  const v = r.result.value as { requestId: string; criteria: { id: string }[] };
  return { requestId: v.requestId, criterionIds: [v.criteria[0].id] };
}
const testParams = (p: { requestId: string; criterionIds: string[] }) => ({ requestId: p.requestId, criterionIds: p.criterionIds, executable: 'node', args: [], reportFormat: 'node-tap-v13' });
function leaseOf(f: { cwd: string; p: { host: { extensionId: string } } }, requestId: string) { const r = inspectCore(requestId, { checkout: f.cwd, extensionId: f.p.host.extensionId }); return r.ok ? (r.value as { lease: string }).lease : 'unknown'; }
const code = (r: RunnerResponse) => (r.result.ok ? 'ok' : r.result.error.code);

test('framing: closed requests, unknown methods and fields, bad JSON, blank lines, split chunks, duplicate ids', async () => {
  const f = await setup(passing);
  f.input.push('\n');
  f.input.push('not json\n'); assert.equal(code(await f.reply(1)), 'INVALID_REQUEST'); assert.equal(f.out[0].id, null);
  f.send({ id: 1, method: 'nope', params: {} }); assert.equal(code(await f.reply(2)), 'INVALID_REQUEST');
  f.send({ id: 2, method: 'inspect', params: { requestId: 'x' }, extra: true }); assert.equal(code(await f.reply(3)), 'INVALID_REQUEST');
  f.send({ method: 'inspect', params: {} }); assert.equal(code(await f.reply(4)), 'INVALID_REQUEST');
  f.send({ id: 3, method: 'inspect', params: { requestId: 'x', more: 1 } }); assert.equal(code(await f.reply(5)), 'INVALID_REQUEST');
  const whole = JSON.stringify({ id: 'split', method: 'inspect', params: { requestId: 'unknown' } }) + '\n';
  f.input.push(whole.slice(0, 10)); f.input.push(Buffer.from(whole.slice(10)));
  const r = await f.reply(6); assert.equal(r.id, 'split'); assert.equal(code(r), 'STALE_STATE');
  f.input.end(); assert.equal(await f.exit, 0);
});

test('prepare, executeTest forward the closed request under the retained lease; caller receipts and stale state are rejected', async () => {
  let held: string | undefined; let stale = false;
  const f = await setup({ execute: async r => { held = r.checkout; if (stale) fs.writeFileSync(path.join(r.checkout, 'changed.txt'), 'x'); return passing.execute(r); } });
  const p = await prepared(f);
  f.send({ id: 'e1', method: 'executeTest', params: { ...testParams(p), receipt: { forged: true } } });
  assert.equal(code(await f.reply(2)), 'INVALID_EVIDENCE');
  assert.equal(held, undefined);
  f.send({ id: 'e2', method: 'executeTest', params: testParams(p) });
  const ok = await f.reply(3); assert.equal(ok.id, 'e2'); assert.equal(code(ok), 'ok');
  assert.equal(held, f.cwd);
  if (ok.result.ok) assert.match((ok.result.value as { artifact: { path: string } }).artifact.path, /\.json$/);
  f.send({ id: 'i', method: 'inspect', params: { requestId: p.requestId } });
  const insp = await f.reply(4); assert.equal(code(insp), 'ok'); if (insp.result.ok) assert.equal((insp.result.value as { lease: string }).lease, 'held');
  stale = true;
  f.send({ id: 'e3', method: 'executeTest', params: testParams(p) });
  assert.equal(code(await f.reply(5)), 'STALE_STATE');
  f.input.end(); assert.equal(await f.exit, 0);
  assert.equal(leaseOf(f, p.requestId), 'released'); // disconnect released the lease
});

test('permission refusal from the execution port propagates unchanged', async () => {
  const f = await setup({ execute: async () => { throw Object.assign(new Error('sandbox refused'), { code: 'PERMISSION_DENIED' }); } });
  const p = await prepared(f);
  f.send({ id: 'e', method: 'executeTest', params: testParams(p) });
  const r = await f.reply(2); assert.equal(code(r), 'PERMISSION_DENIED');
  f.input.end(); assert.equal(await f.exit, 0);
});

test('cancel during execution stops the worker, overlapping executions are refused, serialized methods stay responsive', async () => {
  let began!: () => void; const started = new Promise<void>(r => began = r);
  const f = await setup({ execute: async r => { began(); await new Promise<void>(res => r.signal!.addEventListener('abort', () => res(), { once: true })); throw new Error('killed'); } });
  const p = await prepared(f);
  f.send({ id: 'e', method: 'executeTest', params: testParams(p) }); await started;
  f.send({ id: 'e-again', method: 'executeTest', params: testParams(p) });
  const locked = await f.reply(2); assert.equal(locked.id, 'e-again'); assert.equal(code(locked), 'LOCKED');
  f.send({ id: 'c', method: 'cancel', params: { requestId: p.requestId } });
  const results = new Map<unknown, RunnerResponse>();
  for (let i = 3; i <= 4; i++) { const r = await f.reply(i); results.set(r.id, r); }
  assert.equal(code(results.get('e')!), 'CANCELLED');
  assert.equal(code(results.get('c')!), 'ok');
  const c = results.get('c')!.result; if (c.ok) assert.equal((c.value as { lease: string }).lease, 'released');
  f.input.end(); assert.equal(await f.exit, 0);
});

test('disconnect mid-execution cancels pending work; a worker that does not stop forces recovery (exit 1, lease retained)', async () => {
  let began!: () => void; const started = new Promise<void>(r => began = r);
  let release!: () => void; const hang = new Promise<void>(r => release = r);
  const f = await setup({ execute: async () => { began(); await hang; throw new Error('late'); } }, { stopTimeoutMs: 50 });
  const p = await prepared(f);
  f.send({ id: 'e', method: 'executeTest', params: testParams(p) }); await started;
  f.input.end();
  assert.equal(await f.exit, 1);
  assert.match(f.diag.join(''), /recovery required/);
  assert.equal(leaseOf(f, p.requestId), 'held');
  release(); await new Promise(r => setTimeout(r, 50));
  releaseStoppedPreparation(p.requestId);
});

test('close cancels, releases and ends the session; later requests are not served', async () => {
  const f = await setup(passing);
  const p = await prepared(f);
  f.send({ id: 'x', method: 'close', params: {} });
  const r = await f.reply(2); assert.equal(code(r), 'ok');
  if (r.result.ok) assert.deepEqual((r.result.value as { cancelled: string[] }).cancelled, [p.requestId]);
  assert.equal(await f.exit, 0, f.diag.join(''));
  assert.equal(leaseOf(f, p.requestId), 'released');
});

test('no persistent channel yields the labeled manual fallback and never another host', () => {
  const manual = selectCodexWorkflowChannel({ host: 'codex', persistentToolChannel: false }, '/skill', '/co');
  assert.equal(manual.channel, 'manual-cli-fallback'); assert.match((manual as { label: string }).label, /^Manual CLI fallback/); assert.equal(manual.substitutedHost, null);
  const live = selectCodexWorkflowChannel({ host: 'codex', persistentToolChannel: true }, '/skill', '/co');
  assert.deepEqual(live, { channel: 'persistent-runner', command: ['node', '/skill/scripts/workflow.mjs', 'serve', '--checkout', '/co'], substitutedHost: null });
  assert.equal(selectCodexWorkflowChannel({ host: 'claude', persistentToolChannel: true }, '/s', '/c').channel, 'refused');
  assert.equal(parseServeArgs(['serve', '--checkout', '/abs']).ok, true);
  for (const bad of [[], ['serve'], ['serve', '--checkout', 'rel'], ['run', '--checkout', '/a'], ['serve', '--checkout', '/a', 'x']]) assert.equal(parseServeArgs(bad).ok, false);
});
