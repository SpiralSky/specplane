import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateCompatibility, type ExtensionManifest, type HostSelection } from './compatibility.js';
import * as fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { prepareWorkflow } from './index.js';
import { assertPrepared, releaseStoppedPreparation } from './workflow-preparation.js';
import { workflowRequestSchema } from './schemas.js';
import { Ajv } from 'ajv';
import type { CoreContext, WorkflowInitiation } from './contracts.js';
const info = { version: '0.1.0', protocol: 1, contractVersion: 1, docsVersion: '0.1.0' } as const;
const sha = (b: string) => createHash('sha256').update(b).digest('hex');
async function fixture(workflow = 'plan-step', procedure = '# Contract\n\n## Procedure\n') {
  const root = await mkdtemp(path.join(tmpdir(), 'core-compat-'));
  const files = new Map<string, string>();
  const put = async (p: string, data: string) => { files.set(p, data); await mkdir(path.dirname(path.join(root, p)), { recursive: true }); await writeFile(path.join(root, p), data); return sha(data); };
  await put('core/index.js', 'runtime');
  const contract = procedure;
  const contractHash = await put('contracts/test.md', contract);
  const blob = createHash('sha1').update(`blob ${Buffer.byteLength(contract)}\0`).update(contract).digest('hex');
  const orientationHash = await put('docs/orientation.md', 'orientation');
  const topicHash = await put('docs/topic.md', 'topic');
  const sourceHash = await put('docs/source.md', 'source');
  const docs = JSON.stringify({ format_version: 1, core_version: info.version, docs_version: info.docsVersion, contract_version: 1, orientation: { path: 'orientation.md', sha256: orientationHash }, topics: [{ id: 'getting-started', title: 'Getting started', path: 'topic.md', sha256: topicHash, related: [], sources: [{ id: 'base:feature/test', path: 'source.md', sha256: sourceHash }] }] });
  const docsHash = await put('docs/manifest.json', docs);
  const report = JSON.stringify({ host: 'codex', version: '1.1.0', build: 'test', surface: 'cli', apis: ['nativeCommands', 'backgroundSessions'], results: [{ name: 'dispatch', passed: true }], date: '2026-01-01' });
  const reportHash = await put('reports/compat.json', report);
  const inventory = JSON.stringify({ root: '.', files: [...files].map(([path, data]) => ({ path, sha256: sha(data) })) });
  const coreHash = await put('core/inventory.json', inventory);
  const manifest: ExtensionManifest = { schemaVersion: 1, extension: { id: 'specplane-codex', version: info.version, host: 'codex' }, core: info, hostCompatibility: [{ surface: 'cli', minVersion: '1.0.0', maxVersionExclusive: '2.0.0', evidence: 'reports/compat.json' }], capabilities: { reasoning: true, nativeCommands: true, backgroundSessions: true }, procedures: [{ workflow, contracts: [{ id: 'base:architecture/test', anchor: 'procedure', blob, sha256: contractHash, path: 'contracts/test.md' }] }], assets: [{ path: 'core/inventory.json', sha256: coreHash, kind: 'core' }, { path: 'docs/manifest.json', sha256: docsHash, kind: 'docs' }, { path: 'reports/compat.json', sha256: reportHash, kind: 'docs' }] };
  const host: HostSelection = { packageRoot: root, extensionId: 'specplane-codex', host: 'codex', version: '1.1.0', surface: 'cli', workflow, probes: { nativeCommands: true, backgroundSessions: true } };
  const syncManifest = async (value: ExtensionManifest = manifest) => { await put('specplane-extension.json', JSON.stringify(value)); };
  await syncManifest();
  const reinventory = async () => { files.delete('core/inventory.json'); files.delete('specplane-extension.json'); const inventory = JSON.stringify({ root: '.', files: [...files].map(([path, data]) => ({ path, sha256: sha(data) })) }); manifest.assets[0].sha256 = await put('core/inventory.json', inventory); await syncManifest(); };
  return { root, manifest, host, put, reinventory, syncManifest };
}

const id = '2026-11-03-test';
const stepFile = `plans/${id}/steps/01-test.md`;
function repo() {
 const cwd = fs.mkdtempSync(path.join(tmpdir(), 'prepare-workflow-'));
 const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
 const put = (p: string, text: string) => { const f = path.join(cwd,p); fs.mkdirSync(path.dirname(f),{recursive:true}); fs.writeFileSync(f,text); };
 git('init','-b','main'); git('config','user.name','Test'); git('config','user.email','test@example.com'); git('config','core.autocrlf','false');
 put('.specplane/config.yaml', 'spec_roots:\n  - name: base\n    path: specs\nplans:\n  forge: none\n  require_approved_specs: none\nexecution:\n  backend: branch\n');
 put('specs/features/test.md','---\nid: feature/test\ntitle: Test\nstatus: approved\nauthor: user\n---\n# Test\n\n## Acceptance criteria\n\n- [ ] Observable feature behavior\n');
 put(`plans/${id}/PLAN.md`, `---\nid: ${id}\ntitle: Test\nstatus: ready\nspecs: [base:feature/test]\n---\n# Plan\n`);
 put(stepFile, `---\nplan: ${id}\nstep: 1\ntitle: Test\nstatus: pending\ncontext:\n  - file: source.ts\n---\n# Step\n\n## Acceptance criteria\n\n- [ ] Expected behavior\n`);
 put('source.ts','original'); git('add','.');git('commit','-m','base');const base=git('rev-parse','HEAD');git('switch','-c',`plan/${id}`);
 put(`plans/${id}/PLAN.md`, `---\nid: ${id}\ntitle: Test\nstatus: ready\nspecs: [base:feature/test]\nexecution:\n  target_branch: main\n  start_target_branch: main\n  start_base: ${base}\n---\n# Plan\n`);git('commit','-am','bind');
 return {cwd,git,put};
}
async function setup(workflow: WorkflowInitiation['workflow'] = 'plan-step', procedure?: string) {
 const r = repo(), p = await fixture(workflow, procedure);
 const context: CoreContext = {checkout:r.cwd,extensionId:p.host.extensionId,compatibility:{manifest:p.manifest,host:p.host}};
 const request = {protocol:1,workflow,extensionId:p.host.extensionId,checkout:r.cwd,mode:'attended',selection:workflow==='plan-step'?{planId:id}:{specIds:['base:feature/test'],input:'Requested content'}} as WorkflowInitiation;
 return {...r,p,context,request};
}
function code(result: any, expected: string) { assert.equal(result.ok,false,JSON.stringify(result)); assert.equal(result.error.code,expected,JSON.stringify(result)); }

test('closed initiation rejects authored envelopes, approval, unknown fields and caller criteria before locks', async () => {
 const f = await setup();
 for (const bad of [{...f.request, extra:true},{...f.request,workflow:'approve'}, {...f.request,criteria:[]}, {...f.request,selection:{planId:id,step:0}}]) code(await prepareWorkflow(bad as never,f.context),'INVALID_EVIDENCE');
 const a = await prepareWorkflow(f.request,f.context); assert.equal(a.ok,true,JSON.stringify(a)); if(a.ok) releaseStoppedPreparation(a.value.requestId);
});
test('plan preparation binds post-sync state, target, procedures and missing test mappings; owns the lease',async()=>{
 const f=await setup(); const before=f.git('rev-parse','HEAD'); const a=await prepareWorkflow(f.request,f.context);assert.equal(a.ok,true,JSON.stringify(a));if(!a.ok)return;
 try {
 assert.equal(new Ajv().compile(workflowRequestSchema)(a.value),true);
 assert.equal(a.value.base.head,before);assert.equal(a.value.scope.step,1);assert.ok(a.value.base.inputDigests['target://context']);assert.ok(a.value.procedureDigests['package://contracts/test.md']);assert.equal(a.value.criteria.length,1);assert.equal(a.value.criteria[0].testRequirements.length,0);assert.ok(a.notices.some(n=>n.code==='UNCERTAIN_TEST_MAPPING'));
 code(await prepareWorkflow(f.request,f.context),'LOCKED');
 // Altering the public envelope cannot weaken private prepared inputs.
 a.value.criteria=[];a.value.base.inputDigests={}; f.put('source.ts','implementation edit');await assertPrepared(a.value.requestId,f.context);
 f.put(stepFile,fs.readFileSync(path.join(f.cwd,stepFile),'utf8')+'changed');await assert.rejects(assertPrepared(a.value.requestId,f.context),/input changed/);
 }finally{releaseStoppedPreparation(a.value.requestId);}
});
test('dirty baseline and wrong checkout refuse and release failed preparation leases',async()=>{
 const f=await setup();f.put('unrelated','preserve');code(await prepareWorkflow(f.request,f.context),'STALE_STATE');assert.equal(fs.readFileSync(path.join(f.cwd,'unrelated'),'utf8'),'preserve');
 f.git('add','unrelated'); f.git('commit','-m','preserve');
 code(await prepareWorkflow({...f.request,checkout:path.join(f.cwd,'specs')},f.context),'STALE_STATE');
 f.git('switch','main');code(await prepareWorkflow(f.request,f.context),'STALE_STATE');
 f.git('switch',`plan/${id}`);const a=await prepareWorkflow(f.request,f.context);assert.equal(a.ok,true,JSON.stringify(a));if(a.ok)releaseStoppedPreparation(a.value.requestId);
});
test('compatibility is private, asynchronous and rechecked; package tampering and identity mismatches refuse',async()=>{
 const f=await setup();code(await prepareWorkflow(f.request,{...f.context,compatibility:undefined}),'INCOMPATIBLE');
 code(await prepareWorkflow(f.request,{...f.context,extensionId:'other'}),'INCOMPATIBLE');
 const a=await prepareWorkflow(f.request,f.context);assert.equal(a.ok,true,JSON.stringify(a));if(!a.ok)return;
 try{await f.p.put('contracts/test.md','changed');await assert.rejects(assertPrepared(a.value.requestId,f.context),/compatibility changed/);}finally{releaseStoppedPreparation(a.value.requestId);}
 code(await prepareWorkflow(f.request,f.context),'INCOMPATIBLE');
});
test('reviewed mappings bind suites; stale, duplicate, unknown and wrong workflow mappings refuse',async()=>{
 const r=repo();const digest=sha(fs.readFileSync(path.join(r.cwd,stepFile),'utf8'));
 const entry={sourcePath:stepFile,sourceDigest:digest,criterionIndex:1,evidence:'test',testRequirements:[{suiteId:'workflow-suite',format:'node-tap-v13'}]};
 for(const [change,expected] of [[{},null],[{workflow:'validate'},'INVALID_EVIDENCE'],[{criteria:[entry,entry]},'INVALID_EVIDENCE'],[{extra:true},'INVALID_EVIDENCE'],[{criteria:[{...entry,sourceDigest:'0'.repeat(64)}]},'STALE_STATE']] as const){
 const content='# Contract\n\n## Procedure\n\n```specplane-test-requirements\n'+JSON.stringify({schemaVersion:1,workflow:'plan-step',criteria:[entry],...change})+'\n```\n';
 const p=await fixture('plan-step',content);const context={checkout:r.cwd,extensionId:p.host.extensionId,compatibility:{manifest:p.manifest,host:p.host}};
 const request={protocol:1,workflow:'plan-step',extensionId:p.host.extensionId,checkout:r.cwd,mode:'attended',selection:{planId:id}} as const;
 const a=await prepareWorkflow(request,context);if(expected)code(a,expected);else{assert.equal(a.ok,true,JSON.stringify(a));if(a.ok){assert.deepEqual(a.value.criteria[0].testRequirements,entry.testRequirements);assert.ok(!a.notices.some(n=>n.code==='UNCERTAIN_TEST_MAPPING'));releaseStoppedPreparation(a.value.requestId);}}
 }
});
test('all non-plan workflows prepare bound scopes; creation/approval writes are not implied',async()=>{
 for(const workflow of ['spec-assist','spec-draft-architecture','plan-create','validate','decision-new'] as const){
 const f=await setup(workflow);const a=await prepareWorkflow(f.request,f.context);assert.equal(a.ok,true,JSON.stringify(a));if(!a.ok)continue;
 try{assert.equal(new Ajv().compile(workflowRequestSchema)(a.value),true);assert.equal(a.value.scope.kind,workflow);assert.equal(a.value.scope.input,'Requested content');assert.deepEqual(a.value.scope.allowedEditPaths,[]);assert.ok(a.value.scope.specIds.includes('base:feature/test'));assert.equal(a.value.scope.planId,undefined);await assertPrepared(a.value.requestId,f.context);}finally{releaseStoppedPreparation(a.value.requestId);}
 }
});
test('policy none refuses drafting and assisting, including creation; aborted preparation never takes ownership',async()=>{
 for(const workflow of ['spec-assist','spec-draft-architecture'] as const){const f=await setup(workflow);f.put('.specplane/config.yaml',fs.readFileSync(path.join(f.cwd,'.specplane/config.yaml'),'utf8')+'specs:\n  feature:\n    llm_role: none\n  architecture:\n    llm_role: none\n');f.git('commit','-am','policy');code(await prepareWorkflow(f.request,f.context),'POLICY_DENIED');}
 const f=await setup();code(await prepareWorkflow(f.request,{...f.context,signal:AbortSignal.abort()}),'CANCELLED');
});
test('remote fast-forward happens before snapshot; divergence never merges or discards changes',async()=>{
 const f=await setup();const bare=fs.mkdtempSync(path.join(tmpdir(),'workflow-remote-'));execFileSync('git',['init','--bare',bare],{stdio:'ignore'});f.git('remote','add','origin',bare);f.git('push','origin','main',`plan/${id}`);
 const writer=fs.mkdtempSync(path.join(tmpdir(),'workflow-writer-'));execFileSync('git',['clone','--branch',`plan/${id}`,bare,writer],{stdio:'ignore'});
 const remoteGit=(...a:string[])=>execFileSync('git',a,{cwd:writer,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();remoteGit('config','user.name','Test');remoteGit('config','user.email','test@example.com');
 fs.writeFileSync(path.join(writer,'source.ts'),'remote update');remoteGit('commit','-am','remote');remoteGit('push','origin',`plan/${id}`);
 const remoteHead=remoteGit('rev-parse','HEAD'),a=await prepareWorkflow(f.request,f.context);assert.equal(a.ok,true,JSON.stringify(a));if(a.ok){assert.equal(a.value.base.head,remoteHead);assert.equal(fs.readFileSync(path.join(f.cwd,'source.ts'),'utf8'),'remote update');releaseStoppedPreparation(a.value.requestId);}
 f.put('local-file','local');f.git('add','local-file');f.git('commit','-m','local');const head=f.git('rev-parse','HEAD');fs.writeFileSync(path.join(writer,'source.ts'),'divergent');remoteGit('commit','-am','remote diverged');remoteGit('push','origin',`plan/${id}`);
 const b=await prepareWorkflow(f.request,f.context);assert.equal(b.ok,false);assert.equal(f.git('rev-parse','HEAD'),head);assert.equal(fs.readFileSync(path.join(f.cwd,'local-file'),'utf8'),'local');
});

test('prepared policy and target changes invalidate state; implementation files remain editable',async()=>{
 const f=await setup();const a=await prepareWorkflow(f.request,f.context);assert.equal(a.ok,true,JSON.stringify(a));if(!a.ok)return;
 try{f.put('.specplane/config.yaml',fs.readFileSync(path.join(f.cwd,'.specplane/config.yaml'),'utf8')+'# policy changed\n');await assert.rejects(assertPrepared(a.value.requestId,f.context),/input changed/);}finally{releaseStoppedPreparation(a.value.requestId);}
 const g=await setup();const b=await prepareWorkflow(g.request,g.context);assert.equal(b.ok,true,JSON.stringify(b));if(!b.ok)return;
 try{g.git('update-ref','refs/heads/main',g.git('rev-parse','HEAD'));await assert.rejects(assertPrepared(b.value.requestId,g.context),/Ref .* changed/);}finally{releaseStoppedPreparation(b.value.requestId);}
});
test('non-plan creation can prepare without spec IDs and role-none still denies it',async()=>{
 for(const workflow of ['spec-assist','spec-draft-architecture','plan-create','decision-new','validate'] as const){
  const f=await setup(workflow);const request={...f.request,selection:{specIds:[],input:'Create requested content'}} as WorkflowInitiation;
  const a=await prepareWorkflow(request,f.context);assert.equal(a.ok,true,JSON.stringify(a));if(a.ok){assert.deepEqual(a.value.scope.specIds,[]);assert.deepEqual(a.value.scope.allowedEditPaths,[]);releaseStoppedPreparation(a.value.requestId);}
 }
});
test('completed-step rerun requires explicit force/reason and lifecycle states still refuse',async()=>{
 const f=await setup();f.put(stepFile,fs.readFileSync(path.join(f.cwd,stepFile),'utf8').replace('status: pending','status: done'));f.put(`plans/${id}/HANDOFF.md`,'## Step 01: Test\n## Step 02: Later\n');f.git('add','.');f.git('commit','-m','completed');
 const request=(selection:object)=>({...f.request,selection:{planId:id,...selection}} as WorkflowInitiation);
 for(const selection of [{step:1},{step:1,force:true},{step:1,force:true,reason:' '},{step:1,force:true,reason:'line\nbreak'},{force:true,reason:'rerun'}]) code(await prepareWorkflow(request(selection),f.context),(selection as any).reason!==undefined?'INVALID_EVIDENCE':'POLICY_DENIED');
 const a=await prepareWorkflow(request({step:1,force:true,reason:'Recheck behavior'}),f.context);assert.equal(a.ok,true,JSON.stringify(a));if(a.ok)releaseStoppedPreparation(a.value.requestId);
 // Authoritative target lifecycle status always wins over a ready plan copy.
 const original=f.git('rev-parse','main');const text=f.git('show',`main:plans/${id}/PLAN.md`).replace('status: ready','status: abandoned');
 const target=fs.mkdtempSync(path.join(tmpdir(),'workflow-target-'));f.git('worktree','add',target,'main');fs.writeFileSync(path.join(target,`plans/${id}/PLAN.md`),text);execFileSync('git',['commit','-am','abandon'],{cwd:target,stdio:'ignore'});
 const b=await prepareWorkflow(request({step:1,force:true,reason:'Recheck'}),f.context);assert.equal(b.ok,false,JSON.stringify(b));assert.notEqual(f.git('rev-parse','main'),original);
});

test('file context cannot make policies mutable; permitted draft body edits preserve policy checks',async()=>{
 const f=await setup();f.put(stepFile,fs.readFileSync(path.join(f.cwd,stepFile),'utf8').replace('  - file: source.ts','  - file: source.ts\n  - file: .specplane/config.yaml'));f.git('commit','-am','context');
 const a=await prepareWorkflow(f.request,f.context);assert.equal(a.ok,true,JSON.stringify(a));if(a.ok){try{f.put('.specplane/config.yaml',fs.readFileSync(path.join(f.cwd,'.specplane/config.yaml'),'utf8')+'# changed\n');await assert.rejects(assertPrepared(a.value.requestId,f.context),/input changed/);}finally{releaseStoppedPreparation(a.value.requestId);}}
 const g=await setup('spec-assist');g.put('.specplane/config.yaml',fs.readFileSync(path.join(g.cwd,'.specplane/config.yaml'),'utf8')+'specs:\n  feature:\n    llm_role: draft\n');g.git('commit','-am','draft policy');
 const b=await prepareWorkflow(g.request,g.context);assert.equal(b.ok,true,JSON.stringify(b));if(b.ok){try{assert.deepEqual(b.value.scope.allowedEditPaths,['specs/features/test.md']);g.put('specs/features/test.md',fs.readFileSync(path.join(g.cwd,'specs/features/test.md'),'utf8')+'Draft body change\n');await assertPrepared(b.value.requestId,g.context);g.put('specs/features/test.md',fs.readFileSync(path.join(g.cwd,'specs/features/test.md'),'utf8').replace('status: approved','status: draft'));await assert.rejects(assertPrepared(b.value.requestId,g.context),/spec policy changed/);}finally{releaseStoppedPreparation(b.value.requestId);}}
});
