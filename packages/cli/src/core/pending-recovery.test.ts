import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { repo, fixture } from './workflow-test-fixture.js';
import { prepareWorkflow, validateWorkflowResult, cancelWorkflow } from './index.js';
import { assertPrepared, canonical, sha256, releaseStoppedPreparation, withPreparedActivity } from './workflow-preparation.js';
import { acquireWriterLease, checkoutIdentity } from './writer-leases.js';
import { recordContent, type ContentRecording } from './content-recording.js';
import { reconcileWorkflowRecording } from './pending-recovery.js';
import type { CoreContext, WorkflowResult } from './contracts.js';

const file = 'specs/architecture/test.md';
const original = '---\nid: architecture/test\ntitle: Test architecture\nstatus: draft\nauthor: user\nimplements: [base:feature/test]\n---\n# Architecture\n';
function repoWithSpec() { const r = repo(); r.put(file, original); r.git('add', file); r.git('commit', '-m', 'add draft'); return r; }
function orphan(stage: 'before' | 'after' | 'scaffold' = 'after') {
  const r = repoWithSpec();
  const script = `import fs from 'node:fs';import path from 'node:path';
  import {fixture} from ${JSON.stringify(new URL('./workflow-test-fixture.js', import.meta.url).href)};
  import {prepareWorkflow,validateWorkflowResult} from ${JSON.stringify(new URL('./index.js', import.meta.url).href)};
  import {assertPrepared,canonical,sha256} from ${JSON.stringify(new URL('./workflow-preparation.js', import.meta.url).href)};
  import {checkoutIdentity} from ${JSON.stringify(new URL('./writer-leases.js', import.meta.url).href)};
  import {recordContent} from ${JSON.stringify(new URL('./content-recording.js', import.meta.url).href)};
  const cwd=process.argv[1],stage=process.argv[2],file=${JSON.stringify(file)},p=await fixture('spec-draft-architecture');
  const context={checkout:cwd,extensionId:p.host.extensionId,compatibility:{manifest:p.manifest,host:p.host}};
  const prepared=await prepareWorkflow({protocol:1,workflow:'spec-draft-architecture',checkout:cwd,extensionId:context.extensionId,mode:'attended',selection:{specIds:['base:architecture/test'],input:'Draft requested body'}},context);if(!prepared.ok)throw Error(JSON.stringify(prepared));
  const state=await assertPrepared(prepared.value.requestId,context),before=fs.readFileSync(path.join(cwd,file),'utf8'),reviewed=before+'Caller body edit.\\n',after=reviewed.replace('author: user','author: mixed');fs.writeFileSync(path.join(cwd,file),reviewed);
  const result={protocol:1,requestId:prepared.value.requestId,baseDigest:prepared.value.base.digest,outcome:'blocked',summary:'pending recording',changes:[{path:file,beforeDigest:sha256(before),afterDigest:sha256(reviewed),purpose:'caller body edit'}],criterionEvidence:prepared.value.criteria.map(c=>({criterionId:c.id,assessment:'uncertain',rationale:'Review pending',artifacts:[]})),gaps:[],contextExpansion:[],contributionEvents:[],openIssues:'BLOCKED: acceptance pending',nextKnows:''};
  const validated=await validateWorkflowResult(prepared.value,result,context);if(!validated.ok)throw Error(JSON.stringify(validated));
  const done=()=>{process.stdout.write(JSON.stringify({requestId:prepared.value.requestId,extensionId:context.extensionId,packageRoot:p.root,head:prepared.value.base.head,reviewed,after}));process.exit(0);};
  const generated=[{path:file,before:reviewed,after}];if(stage==='scaffold')generated.push({path:'new-spec.md',before:null,after:'# Final generated spec\\n'});
  const input={manifest:{protocol:1,head:prepared.value.base.head,branch:prepared.value.base.branch,changes:result.changes},generated,message:'docs: pending recording\\n\\nSpecplane-Workflow: spec\\nSpecplane-Request: '+prepared.value.requestId+'\\n',beforeWrite:commit=>{
   const intent={version:1,request:prepared.value,extensionId:context.extensionId,proposal:validated.value,summary:'pending',commit};
   const content=canonical(intent),dir=path.join(checkoutIdentity(cwd).commonDir,'specplane-runtime/workflows',prepared.value.requestId);fs.mkdirSync(dir,{recursive:true});
   const write=(name,bytes)=>{const fd=fs.openSync(path.join(dir,name),'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
   write('recording-intent.json',content);state.lease.bindRecoveryEvidence(sha256(content));write('recovery-binding.json',canonical(state.lease.recoveryBinding()));if(stage==='before')done();
  },beforeCommit:()=>done(),...(stage==='scaffold'?{creation:{files:[{path:'new-spec.md',scaffold:'# Dedicated creation scaffold\\n'}],apply:()=>{fs.writeFileSync(path.join(cwd,'new-spec.md'),'# Dedicated creation scaffold\\n',{flag:'wx',mode:0o600});done();}}}:{})};
  recordContent(input,cwd,state.lease);throw Error('expected abrupt process exit');`;
  const child = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script, r.cwd, stage], { encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: '' } }));
  const runtime = path.join(checkoutIdentity(r.cwd).commonDir, 'specplane-runtime'), dir = path.join(runtime, 'workflows', child.requestId);
  const context: CoreContext = { checkout: r.cwd, extensionId: child.extensionId, lifecycle: { stopWorkflow: async () => ({ stopped: true, recoveryRequired: false }) } };
  return { ...r, ...child, runtime, dir, context, cleanup: () => { fs.rmSync(r.cwd, { recursive: true, force: true }); fs.rmSync(child.packageRoot, { recursive: true, force: true }); } };
}

test('orphan reconciliation handles prewrite after-write and partial-scaffold states without replay', async () => {
  for (const stage of ['before', 'after', 'scaffold'] as const) {
    const f = orphan(stage);
    try {
      const index = fs.readFileSync(path.join(f.cwd, '.git/index'));
      const privateIndexes = fs.readdirSync(path.join(f.cwd, '.git')).filter(name => name.startsWith('specplane-content-'));
      let stops = 0; f.context.lifecycle = { stopWorkflow: async () => { stops++; return { stopped: true, recoveryRequired: false }; } };
      const result = await reconcileWorkflowRecording(f.requestId, f.context);
      assert.ok(result.ok, JSON.stringify(result)); if (!result.ok) continue;
      assert.equal(result.value.state, 'rolled-back'); assert.deepEqual(result.value.preservedPaths, [file]);
      assert.equal(fs.readFileSync(path.join(f.cwd, file), 'utf8'), f.reviewed);
      assert.ok(fs.readFileSync(path.join(f.cwd, '.git/index')).equals(index));
      assert.equal(f.git('rev-parse', 'HEAD'), f.head); assert.equal(fs.existsSync(path.join(f.cwd, '.git/index.lock')), false);
      assert.equal(fs.existsSync(path.join(f.cwd, 'new-spec.md')), false);
      assert.deepEqual(fs.readdirSync(path.join(f.cwd, '.git')).filter(name => name.startsWith('specplane-content-')), privateIndexes);
      assert.equal(fs.existsSync(path.join(f.dir, 'recording-intent.json')), true);
      const again = await reconcileWorkflowRecording(f.requestId, f.context); assert.ok(again.ok, JSON.stringify(again)); assert.equal(stops, 1);
      const next = acquireWriterLease({ checkouts: [f.cwd], requestId: 'next' }); next.release();
    } finally { f.cleanup(); }
  }
});

test('uncertain or absent stop proof preserves generated bytes index lock and retained lease', async () => {
  const f = orphan();
  try {
    for (const lifecycle of [undefined, { stopWorkflow: async () => ({ stopped: false, recoveryRequired: true }) }]) {
      const result = await reconcileWorkflowRecording(f.requestId, { ...f.context, lifecycle }); assert.equal(result.ok, false);
      assert.equal(fs.readFileSync(path.join(f.cwd, file), 'utf8'), f.after);
      assert.equal(fs.existsSync(path.join(f.cwd, '.git/index.lock')), true);
      assert.throws(() => acquireWriterLease({ checkouts: [f.cwd], requestId: 'racer' }), { code: 'RECOVERY_REQUIRED' });
    }
    assert.ok((await reconcileWorkflowRecording(f.requestId, f.context)).ok);
  } finally { f.cleanup(); }
});

test('unknown file bytes foreign locks changed index HEAD and journal refuse without cleanup', async () => {
  for (const scenario of ['bytes', 'lock', 'lock-contents', 'index', 'head', 'journal', 'binding'] as const) {
    const f = orphan();
    try {
      if (scenario === 'bytes') f.put(file, f.after + 'external edit\n');
      if (scenario === 'lock') { fs.renameSync(path.join(f.cwd, '.git/index.lock'), path.join(f.cwd, '.git/original-index.lock')); fs.writeFileSync(path.join(f.cwd, '.git/index.lock'), ''); }
      if (scenario === 'lock-contents') fs.writeFileSync(path.join(f.cwd, '.git/index.lock'), 'foreign contents');
      if (scenario === 'index') fs.appendFileSync(path.join(f.cwd, '.git/index'), 'external');
      if (scenario === 'head') f.git('update-ref', 'HEAD', f.git('rev-parse', 'HEAD^'));
      if (scenario === 'journal') fs.appendFileSync(path.join(f.dir, 'recording-intent.json'), ' ');
      if (scenario === 'binding') { const name = path.join(f.dir, 'recovery-binding.json'), binding = JSON.parse(fs.readFileSync(name, 'utf8')); binding.token += '-changed'; fs.writeFileSync(name, JSON.stringify(binding)); }
      const bytes = fs.readFileSync(path.join(f.cwd, file));
      const result = await reconcileWorkflowRecording(f.requestId, f.context); assert.equal(result.ok, false, scenario);
      assert.ok(fs.readFileSync(path.join(f.cwd, file)).equals(bytes), scenario);
      assert.equal(fs.existsSync(path.join(f.cwd, '.git/index.lock')), true, scenario);
      assert.throws(() => acquireWriterLease({ checkouts: [f.cwd], requestId: 'racer' }), { code: 'RECOVERY_REQUIRED' });
    } finally { f.cleanup(); }
  }
});

async function sameProcess() {
  const r = repoWithSpec(), p = await fixture('spec-draft-architecture'); let stops = 0;
  const context: CoreContext = { checkout: r.cwd, extensionId: p.host.extensionId, compatibility: { manifest: p.manifest, host: p.host }, lifecycle: { stopWorkflow: async () => { stops++; return { stopped: true, recoveryRequired: false }; } } };
  const prepared = await prepareWorkflow({ protocol: 1, workflow: 'spec-draft-architecture', checkout: r.cwd, extensionId: context.extensionId, mode: 'attended', selection: { specIds: ['base:architecture/test'], input: 'Draft body' } }, context);
  assert.ok(prepared.ok, JSON.stringify(prepared)); if (!prepared.ok) throw new Error('prepare');
  const state = await assertPrepared(prepared.value.requestId, context), reviewed = original + 'Caller edit.\n', after = reviewed.replace('author: user', 'author: mixed'); r.put(file, reviewed);
  const result: WorkflowResult = { protocol: 1, requestId: state.request.requestId, baseDigest: state.request.base.digest, outcome: 'blocked', summary: 'pending content', changes: [{ path: file, beforeDigest: sha256(original), afterDigest: sha256(reviewed), purpose: 'caller body' }], criterionEvidence: state.request.criteria.map(c => ({ criterionId: c.id, assessment: 'uncertain', rationale: 'Review pending', artifacts: [] })), gaps: [], contextExpansion: [], contributionEvents: [], openIssues: 'BLOCKED: review pending', nextKnows: '' };
  const proposal = await validateWorkflowResult(state.request, result, context); assert.ok(proposal.ok, JSON.stringify(proposal)); if (!proposal.ok) throw new Error('validate');
  const input: ContentRecording = { manifest: { protocol: 1, head: state.request.base.head, branch: state.request.base.branch, changes: result.changes }, generated: [{ path: file, before: reviewed, after }], message: 'docs: pending content\n', beforeWrite: commit => {
    const intent = { version: 1, request: state.request, extensionId: context.extensionId, proposal: proposal.value, summary: 'pending', commit }, content = canonical(intent);
    const dir = path.join(checkoutIdentity(r.cwd).commonDir, 'specplane-runtime/workflows', state.request.requestId); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'recording-intent.json'), content, { flag: 'wx' }); state.lease.bindRecoveryEvidence(sha256(content)); fs.writeFileSync(path.join(dir, 'recovery-binding.json'), canonical(state.lease.recoveryBinding()), { flag: 'wx' });
  }, beforeCommit: () => { throw new Error('interrupted before commit'); } };
  assert.throws(() => recordContent(input, r.cwd, state.lease), /interrupted before commit/);
  r.put(file, after);
  return { ...r, context, state, reviewed, after, stops: () => stops, close: () => releaseStoppedPreparation(state.request.requestId) };
}

test('same-process reconciliation uses the preparation-bound stop port once and rejects active phases', async () => {
  const f = await sameProcess();
  try {
    const requestId = f.state.request.requestId;
    for (const phase of ['execution', 'validation', 'recording'] as const) {
      const busy = await withPreparedActivity(requestId, phase, () => reconcileWorkflowRecording(requestId, f.context));
      assert.equal(busy.ok, false); if (!busy.ok) assert.equal(busy.error.code, 'LOCKED'); assert.equal(f.stops(), 0);
    }
    let replacement = 0;
    const context = { ...f.context, lifecycle: { stopWorkflow: async () => { replacement++; return { stopped: true, recoveryRequired: false }; } } };
    const result = await reconcileWorkflowRecording(requestId, context); assert.ok(result.ok, JSON.stringify(result));
    assert.equal(f.stops(), 1); assert.equal(replacement, 0); assert.equal(f.state.leaseReleased, true);
    assert.equal(fs.readFileSync(path.join(f.cwd, file), 'utf8'), f.reviewed);
    assert.ok((await reconcileWorkflowRecording(requestId, context)).ok); assert.equal(f.stops(), 1);
  } finally { f.close(); }
});

test('same-process reconciliation reserves cancellation while awaiting its trusted stop port', async () => {
  const f = await sameProcess();
  let finish!: (value: { stopped: boolean; recoveryRequired: boolean }) => void;
  const gate = new Promise<{ stopped: boolean; recoveryRequired: boolean }>(resolve => { finish = resolve; });
  let stops = 0;
  f.state.stopWorker = async () => { stops++; return gate; };
  const requestId = f.state.request.requestId, pending = reconcileWorkflowRecording(requestId, f.context);
  try {
    assert.equal(f.state.cancellationPending, true);
    const repeated = await reconcileWorkflowRecording(requestId, f.context);
    assert.equal(repeated.ok, false); if (!repeated.ok) assert.equal(repeated.error.code, 'LOCKED');
    const cancelled = await cancelWorkflow(requestId, f.context);
    assert.equal(cancelled.ok, false); if (!cancelled.ok) assert.equal(cancelled.error.code, 'LOCKED');
    await assert.rejects(withPreparedActivity(requestId, 'execution', async () => undefined), { code: 'CANCELLED' });
    assert.equal(stops, 1); assert.equal(f.state.leaseReleased, false);
    assert.equal(fs.readFileSync(path.join(f.cwd, file), 'utf8'), f.after);
    finish({ stopped: true, recoveryRequired: false });
    assert.ok((await pending).ok);
    assert.equal(f.state.cancellationPending, false); assert.equal(f.state.leaseReleased, true);
    assert.equal(fs.readFileSync(path.join(f.cwd, file), 'utf8'), f.reviewed);
  } finally { finish({ stopped: true, recoveryRequired: false }); await pending; f.close(); }
});

test('orphan reconciliation refuses a live owner before consulting the host stop port', async () => {
  const f = orphan();
  try {
    const binding = JSON.parse(fs.readFileSync(path.join(f.dir, 'recovery-binding.json'), 'utf8'));
    for (const key of binding.keys) {
      const record = path.join(f.runtime, `${key.kind}-${sha256(key.identity)}.json`), content = JSON.parse(fs.readFileSync(record, 'utf8'));
      content.pid = process.pid; fs.writeFileSync(record, JSON.stringify(content));
    }
    let stops = 0; f.context.lifecycle = { stopWorkflow: async () => { stops++; return { stopped: true, recoveryRequired: false }; } };
    const result = await reconcileWorkflowRecording(f.requestId, f.context);
    assert.equal(result.ok, false); assert.equal(stops, 0);
    assert.equal(fs.readFileSync(path.join(f.cwd, file), 'utf8'), f.after);
    assert.equal(fs.existsSync(path.join(f.cwd, '.git/index.lock')), true);
  } finally { f.cleanup(); }
});

test('journal changes during trusted stopping refuse before restoring any generated bytes', async () => {
  const f = orphan();
  try {
    f.context.lifecycle = { stopWorkflow: async () => { fs.appendFileSync(path.join(f.dir, 'recording-intent.json'), ' '); return { stopped: true, recoveryRequired: false }; } };
    const result = await reconcileWorkflowRecording(f.requestId, f.context);
    assert.equal(result.ok, false);
    assert.equal(fs.readFileSync(path.join(f.cwd, file), 'utf8'), f.after);
    assert.equal(fs.existsSync(path.join(f.cwd, '.git/index.lock')), true);
    assert.throws(() => acquireWriterLease({ checkouts: [f.cwd], requestId: 'racer' }), { code: 'RECOVERY_REQUIRED' });
  } finally { f.cleanup(); }
});

test('missing prewrite intent explicitly refuses pending evidence without stopping or changing files', async () => {
  const f = orphan();
  try {
    fs.unlinkSync(path.join(f.dir, 'recording-intent.json'));
    const evidence = path.join(f.dir, 'pending-capture.json'); fs.writeFileSync(evidence, 'retained private observation');
    const index = fs.readFileSync(path.join(f.cwd, '.git/index')), lock = fs.readFileSync(path.join(f.cwd, '.git/index.lock'));
    let stops = 0; f.context.lifecycle = { stopWorkflow: async () => { stops++; return { stopped: true, recoveryRequired: false }; } };
    const result = await reconcileWorkflowRecording(f.requestId, f.context);
    assert.equal(result.ok, false);
    if (!result.ok) { assert.equal(result.error.code, 'RECOVERY_REQUIRED'); assert.match(result.error.message, /No durable prewrite recording intent/); assert.match(result.error.message, /Pending captures and process-local read-only receipts/); }
    assert.equal(stops, 0); assert.equal(fs.readFileSync(evidence, 'utf8'), 'retained private observation');
    assert.equal(fs.readFileSync(path.join(f.cwd, file), 'utf8'), f.after);
    assert.ok(fs.readFileSync(path.join(f.cwd, '.git/index')).equals(index));
    assert.ok(fs.readFileSync(path.join(f.cwd, '.git/index.lock')).equals(lock));
    assert.throws(() => acquireWriterLease({ checkouts: [f.cwd], requestId: 'racer' }), { code: 'RECOVERY_REQUIRED' });
  } finally { f.cleanup(); }
});
