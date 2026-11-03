import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import { fixture,repo,stepFile,id } from './workflow-test-fixture.js';
import { prepareWorkflow,executeWorkflowTest,validateWorkflowResult,recordWorkflow,cancelWorkflow,inspectWorkflow,captureContribution } from './index.js';
import { releaseStoppedPreparation,sha256 } from './workflow-preparation.js';
import {validateExecutionArtifact} from './workflow-execution.js';
import type {CoreContext,WorkflowResult} from './contracts.js';
async function setup(remote=false, lifecycle?:CoreContext['lifecycle'], contributions?:CoreContext['contributions'], review=false){
 const r=repo();let bare='';if(remote){bare=fs.mkdtempSync(path.join(tmpdir(),'record-remote-'));execFileSync('git',['init','--bare',bare],{stdio:'ignore'});r.git('remote','add','origin',bare);r.git('push','-u','origin',`plan/${id}`);r.git('push','origin','main');}
 const mapping={schemaVersion:1,workflow:'plan-step',criteria:[{sourcePath:stepFile,sourceDigest:sha256(fs.readFileSync(path.join(r.cwd,stepFile))),criterionIndex:1,evidence:'test',testRequirements:[{suiteId:'check',format:'node-tap-v13'}]}]};
 const p=await fixture('plan-step','# Contract\n\n## Procedure\n\n```specplane-test-requirements\n'+JSON.stringify(mapping)+'\n```\n');
 const context:CoreContext={lifecycle,contributions,checkout:r.cwd,extensionId:p.host.extensionId,compatibility:{manifest:p.manifest,host:p.host},execution:{execute:async args=>{const stdout=execFileSync(process.execPath,args.args,{cwd:args.checkout,env:args.env});return {executable:process.execPath,exitCode:0,signal:null,stdout,stderr:Buffer.alloc(0)};}}};
 const a=await prepareWorkflow({protocol:1,workflow:'plan-step',checkout:r.cwd,extensionId:context.extensionId,mode:'attended',selection:{planId:id}},context);assert.equal(a.ok,true,JSON.stringify(a));if(!a.ok)throw Error('prepare');
 r.put('check.cjs',"require('node:test').test('check',()=>{});");
 if(review)r.put('review.md','Performed review');
 const execution=await executeWorkflowTest({requestId:a.value.requestId,criterionIds:[a.value.criteria[0].id],executable:'node',args:['--test','--test-reporter=tap','check.cjs'],reportFormat:'node-tap-v13'},context);assert.equal(execution.ok,true,JSON.stringify(execution));if(!execution.ok)throw Error('execute');
 const result:WorkflowResult={protocol:1,requestId:a.value.requestId,baseDigest:a.value.base.digest,outcome:'done',summary:'verify implementation',changes:[{path:'check.cjs',beforeDigest:'missing',afterDigest:sha256(fs.readFileSync(path.join(r.cwd,'check.cjs'))),purpose:'prove behavior'}],criterionEvidence:[{criterionId:a.value.criteria[0].id,assessment:'met',rationale:'Actual child test executed successfully',artifacts:[execution.value.artifact]}],gaps:[],contextExpansion:[],contributionEvents:[],openIssues:'',nextKnows:'Continue the next step.'};
 if(review)result.changes.push({path:'review.md',beforeDigest:'missing',afterDigest:sha256('Performed review'),purpose:'review evidence'});
 return {...r,p,bare,context,prepared:a.value,result,execution:execution.value,close:()=>releaseStoppedPreparation(a.value.requestId)};
}
test('real prepare-edit-execute-validate-record preserves durable summary and matching retry',async()=>{
 const f=await setup();try{
 const p=await validateWorkflowResult(f.prepared,f.result,f.context);assert.equal(p.ok,true,JSON.stringify(p));if(!p.ok)return;
 const recorded=await recordWorkflow(p.value,f.context);assert.equal(recorded.ok,true,JSON.stringify(recorded));if(!recorded.ok)return;
 assert.equal(recorded.value.commit,f.git('rev-parse','HEAD'));assert.equal(recorded.value.publication,'not-required');assert.equal(f.git('status','--porcelain'),'');
 const handoff=fs.readFileSync(path.join(f.cwd,recorded.value.handoff),'utf8');for(const text of ['executed 1, failed 0, skipped 0',f.execution.executionId,'receipt SHA-256','tested state','another clone cannot independently verify'])assert.ok(handoff.includes(text),text);
 const retry=await recordWorkflow(p.value,f.context);assert.equal(retry.ok,true,JSON.stringify(retry));if(retry.ok)assert.equal(retry.value.commit,recorded.value.commit);
 const clone=fs.mkdtempSync(path.join(tmpdir(),'record-clone-'));execFileSync('git',['clone',f.cwd,clone],{stdio:'ignore'});assert.ok(fs.readFileSync(path.join(clone,recorded.value.handoff),'utf8').includes(f.execution.executionId));assert.equal(fs.existsSync(path.join(clone,'.git','specplane-runtime')),false);await assert.rejects(validateExecutionArtifact(f.prepared.requestId,f.prepared.criteria[0].id,f.execution.artifact,{...f.context,checkout:clone}));
 f.git('switch','-c','same-head');const wrong=await recordWorkflow(p.value,f.context);assert.equal(wrong.ok,false);f.git('switch',f.prepared.base.branch);
 }finally{f.close();}
});
test('caller modifications, stale edits, incomplete criteria and forged provenance refuse before mutation',async()=>{
 const f=await setup();try{
 for(const result of [{...f.result,criterionEvidence:[]},{...f.result,changes:[]},{...f.result,baseDigest:'0'.repeat(64)},{...f.result,outcome:'cancelled'},{...f.result,criterionEvidence:[{...f.result.criterionEvidence[0],assessment:'uncertain'}]}])assert.equal((await validateWorkflowResult(f.prepared,result as WorkflowResult,f.context)).ok,false);
 const provenance={...f.result,contributionEvents:[{eventId:'fake',requestId:f.prepared.requestId,spec:'base:feature/test',role:'review' as const,source:'runtime' as const,actor:{kind:'model' as const},action:{kind:'review' as const,evidencePath:'source.ts',evidenceDigest:sha256('original')},revision:{reviewedDigest:sha256('original')}}]};
 const refused=await validateWorkflowResult(f.prepared,provenance,f.context);assert.equal(refused.ok,false);if(!refused.ok)assert.equal(refused.error.code,'INVALID_EVIDENCE');
 const p=await validateWorkflowResult(f.prepared,f.result,f.context);assert.equal(p.ok,true);if(!p.ok)return;
 assert.equal((await recordWorkflow({...p.value,paths:[]},f.context)).ok,false);
 const cancelled=await recordWorkflow(p.value,{...f.context,signal:AbortSignal.abort()});assert.equal(cancelled.ok,false);if(!cancelled.ok)assert.equal(cancelled.error.code,'CANCELLED');
 f.put('source.ts','unreviewed');const stale=await recordWorkflow(p.value,f.context);assert.equal(stale.ok,false);assert.equal(f.git('rev-parse','HEAD'),f.prepared.base.head);
 }finally{f.close();}
});
test('blocked uncertain result records limitations without inventing passing evidence',async()=>{
 const f=await setup();try{f.result.outcome='blocked';f.result.openIssues='BLOCKED: semantic review remains uncertain';f.result.criterionEvidence[0].assessment='uncertain';const p=await validateWorkflowResult(f.prepared,f.result,f.context);assert.equal(p.ok,true,JSON.stringify(p));if(p.ok){const r=await recordWorkflow(p.value,f.context);assert.equal(r.ok,true,JSON.stringify(r));if(r.ok)assert.equal(r.value.outcome,'blocked');}}finally{f.close();}
});
test('failed publication retries the existing commit without repeating implementation',async()=>{
 const f=await setup(true);try{
 const p=await validateWorkflowResult(f.prepared,f.result,f.context);assert.equal(p.ok,true,JSON.stringify(p));if(!p.ok)return;
 const hook=path.join(f.bare,'hooks','pre-receive');fs.writeFileSync(hook,'#!/bin/sh\nexit 1\n',{mode:0o755});
 const first=await recordWorkflow(p.value,f.context);assert.equal(first.ok,true,JSON.stringify(first));if(!first.ok)return;assert.equal(first.value.publication,'failed');
 fs.writeFileSync(hook,'#!/bin/sh\nexit 0\n');const second=await recordWorkflow(p.value,f.context);assert.equal(second.ok,true,JSON.stringify(second));if(second.ok){assert.equal(second.value.publication,'published');assert.equal(second.value.commit,first.value.commit);assert.equal(execFileSync('git',['rev-parse',`refs/heads/plan/${id}`],{cwd:f.bare,encoding:'utf8'}).trim(),first.value.commit);}
 }finally{f.close();}
});
test('lost prepared lease refuses recording',async()=>{
 const f=await setup();const p=await validateWorkflowResult(f.prepared,f.result,f.context);assert.equal(p.ok,true);f.close();if(p.ok){const r=await recordWorkflow(p.value,f.context);assert.equal(r.ok,false);assert.equal(f.git('rev-parse','HEAD'),f.prepared.base.head);}
});
test('plan scope cannot create spec/plan/decision records; non-plan mutation remains unsupported',async()=>{
 const f=await setup();try{
 f.put('specs/features/new.md','new feature');const result={...f.result,changes:[...f.result.changes,{path:'specs/features/new.md',beforeDigest:'missing',afterDigest:sha256('new feature'),purpose:'new feature'}]};const denied=await validateWorkflowResult(f.prepared,result,f.context);assert.equal(denied.ok,false);if(!denied.ok)assert.equal(denied.error.code,'POLICY_DENIED');
 }finally{f.close();}
 const r=repo(),p=await fixture('validate'),context={checkout:r.cwd,extensionId:p.host.extensionId,compatibility:{manifest:p.manifest,host:p.host}};
 const prepared=await prepareWorkflow({protocol:1,workflow:'validate',checkout:r.cwd,extensionId:context.extensionId,mode:'attended',selection:{specIds:[],input:'Review'}},context);assert.equal(prepared.ok,true);if(!prepared.ok)return;
 try{const result:WorkflowResult={...f.result,requestId:prepared.value.requestId,baseDigest:prepared.value.base.digest,outcome:'blocked',changes:[],criterionEvidence:prepared.value.criteria.map(c=>({criterionId:c.id,assessment:'uncertain',rationale:'Uncertain',artifacts:[]})),openIssues:'BLOCKED: no mutation operation'};const denied=await validateWorkflowResult(prepared.value,result,context);assert.equal(denied.ok,false);if(!denied.ok)assert.equal(denied.error.code,'UNSUPPORTED_CAPABILITY');}finally{releaseStoppedPreparation(prepared.value.requestId);}
});

test('publication destination changes after validation refuse before commit',async()=>{
 const f=await setup(true);try{const p=await validateWorkflowResult(f.prepared,f.result,f.context);assert.equal(p.ok,true);if(!p.ok)return;f.git('remote','set-url','--push','origin',f.cwd);const r=await recordWorkflow(p.value,f.context);assert.equal(r.ok,false);if(!r.ok)assert.equal(r.error.code,'STALE_STATE');assert.equal(f.git('rev-parse','HEAD'),f.prepared.base.head);}finally{f.close();}
});

test('cancel after commit reports verified receipt and releases only after trusted stop',async()=>{
 let stops=0;
 const f=await setup(false,{stopWorkflow:async()=>{stops++;return {stopped:true,recoveryRequired:false};}});
 try{
  const proposal=await validateWorkflowResult(f.prepared,f.result,f.context);assert.ok(proposal.ok);if(!proposal.ok)return;
  const recorded=await recordWorkflow(proposal.value,f.context);assert.ok(recorded.ok);if(!recorded.ok)return;
  const inspected=await inspectWorkflow(f.prepared.requestId,f.context);assert.ok(inspected.ok);if(!inspected.ok)return;
  assert.equal(inspected.value.recording?.commit,recorded.value.commit);
  if(inspected.value.recording)inspected.value.recording.commit='caller-mutated';
  const cancelled=await cancelWorkflow(f.prepared.requestId,f.context);assert.ok(cancelled.ok,JSON.stringify(cancelled));if(!cancelled.ok)return;
  assert.equal(cancelled.value.recording?.commit,recorded.value.commit);
  assert.equal(cancelled.value.recording?.publication,'not-required');
  assert.equal(cancelled.value.lease,'released');assert.equal(stops,1);
  const repeated=await cancelWorkflow(f.prepared.requestId,f.context);assert.ok(repeated.ok,JSON.stringify(repeated));assert.equal(stops,1);
  const terminal=await inspectWorkflow(f.prepared.requestId,f.context);assert.ok(terminal.ok,JSON.stringify(terminal));if(terminal.ok)assert.equal(terminal.value.recording?.commit,recorded.value.commit);
  assert.equal(f.git('rev-parse','HEAD'),recorded.value.commit);assert.equal(f.git('status','--porcelain'),'');
  const replay=await recordWorkflow(proposal.value,f.context);assert.equal(replay.ok,false);
 }finally{f.close();}
});
test('cancel after failed publication reports existing commit without retrying push',async()=>{
 const f=await setup(true,{stopWorkflow:async()=>({stopped:true,recoveryRequired:false})});
 try{
  const proposal=await validateWorkflowResult(f.prepared,f.result,f.context);assert.ok(proposal.ok);if(!proposal.ok)return;
  const hook=path.join(f.bare,'hooks','pre-receive');fs.writeFileSync(hook,'#!/bin/sh\nexit 1\n',{mode:0o755});
  const recorded=await recordWorkflow(proposal.value,f.context);assert.ok(recorded.ok);if(!recorded.ok)return;
  assert.equal(recorded.value.publication,'failed');fs.writeFileSync(hook,'#!/bin/sh\nexit 0\n');
  const cancelled=await cancelWorkflow(f.prepared.requestId,f.context);assert.ok(cancelled.ok,JSON.stringify(cancelled));if(!cancelled.ok)return;
  assert.equal(cancelled.value.recording?.commit,recorded.value.commit);assert.equal(cancelled.value.recording?.publication,'cancelled');
  assert.equal(execFileSync('git',['rev-parse',`refs/heads/plan/${id}`],{cwd:f.bare,encoding:'utf8'}).trim(),f.prepared.base.head);
 }finally{f.close();}
});
test('changed recorded state refuses cancellation release and preserves changes',async()=>{
 const f=await setup(false,{stopWorkflow:async()=>({stopped:true,recoveryRequired:false})});
 try{
  const proposal=await validateWorkflowResult(f.prepared,f.result,f.context);assert.ok(proposal.ok);if(!proposal.ok)return;
  const recorded=await recordWorkflow(proposal.value,f.context);assert.ok(recorded.ok);if(!recorded.ok)return;
  f.put('source.ts','unreviewed after commit');
  const cancelled=await cancelWorkflow(f.prepared.requestId,f.context);assert.equal(cancelled.ok,false);if(!cancelled.ok)assert.equal(cancelled.error.code,'RECOVERY_REQUIRED');
  assert.equal(fs.readFileSync(path.join(f.cwd,'source.ts'),'utf8'),'unreviewed after commit');
  assert.equal(f.git('rev-parse','HEAD'),recorded.value.commit);
 }finally{f.close();}
});

test('missing recording directory is read-only recovery and cancellation reports known commit',async()=>{
 const f=await setup(false,{stopWorkflow:async()=>({stopped:true,recoveryRequired:false})});
 try{
  const proposal=await validateWorkflowResult(f.prepared,f.result,f.context);assert.ok(proposal.ok);if(!proposal.ok)return;
  const recorded=await recordWorkflow(proposal.value,f.context);assert.ok(recorded.ok);if(!recorded.ok)return;
  const dir=path.join(f.cwd,'.git','specplane-runtime','workflows',f.prepared.requestId);
  fs.rmSync(dir,{recursive:true});
  for(const result of [await inspectWorkflow(f.prepared.requestId,f.context),await cancelWorkflow(f.prepared.requestId,f.context)]){
   assert.equal(result.ok,false);if(!result.ok){assert.equal(result.error.code,'RECOVERY_REQUIRED');assert.deepEqual(result.error.details,{recording:{commit:recorded.value.commit,publication:'not-required',verified:false}});}
   assert.equal(fs.existsSync(dir),false);
  }
  assert.equal(f.git('rev-parse','HEAD'),recorded.value.commit);
 }finally{f.close();}
});

test('missing stopped-worker port after commit retains lease and reports the commit',async()=>{
 const f=await setup();
 try{
  const proposal=await validateWorkflowResult(f.prepared,f.result,f.context);assert.ok(proposal.ok);if(!proposal.ok)return;
  const recorded=await recordWorkflow(proposal.value,f.context);assert.ok(recorded.ok);if(!recorded.ok)return;
  const cancelled=await cancelWorkflow(f.prepared.requestId,f.context);assert.equal(cancelled.ok,false);
  if(!cancelled.ok){assert.equal(cancelled.error.code,'RECOVERY_REQUIRED');assert.deepEqual(cancelled.error.details,{recording:{commit:recorded.value.commit,publication:'not-required',verified:true}});}
  const inspected=await inspectWorkflow(f.prepared.requestId,f.context);assert.ok(inspected.ok);if(inspected.ok)assert.equal(inspected.value.lease,'held');
 }finally{f.close();}
});


test('public validation refuses pending captured contributions even when result omits events',async()=>{
 let observed:import('./contracts.js').ContributionEvent|null=null;
 const f=await setup(false,undefined,{observe:async()=>observed});
 try{
  const report='review.md';f.put(report,'Performed review');
  observed={eventId:crypto.randomUUID(),requestId:f.prepared.requestId,spec:'base:feature/test',role:'review',source:'runtime',actor:{kind:'model',model_id:'observed'},action:{kind:'review',evidencePath:report,evidenceDigest:sha256('Performed review')},revision:{reviewedDigest:sha256(fs.readFileSync(path.join(f.cwd,'specs/features/test.md')))}};
  const captured=await captureContribution(observed,f.context);assert.ok(captured.ok,JSON.stringify(captured));
  const validation=await validateWorkflowResult(f.prepared,f.result,f.context);assert.equal(validation.ok,false);if(!validation.ok)assert.equal(validation.error.code,'UNSUPPORTED_CAPABILITY');assert.equal(f.git('rev-parse','HEAD'),f.prepared.base.head);
 }finally{f.close();}
});

test('recording rechecks trusted captures added after proposal validation',async()=>{
 let observed:import('./contracts.js').ContributionEvent|null=null;
 const f=await setup(false,undefined,{observe:async()=>observed},true);
 try{
  const report='review.md';
  const validation=await validateWorkflowResult(f.prepared,f.result,f.context);assert.ok(validation.ok,JSON.stringify(validation));if(!validation.ok)return;
  observed={eventId:crypto.randomUUID(),requestId:f.prepared.requestId,spec:'base:feature/test',role:'review',source:'runtime',actor:{kind:'model',model_id:'observed'},action:{kind:'review',evidencePath:report,evidenceDigest:sha256('Performed review')},revision:{reviewedDigest:sha256(fs.readFileSync(path.join(f.cwd,'specs/features/test.md')))}};
  assert.ok((await captureContribution(observed,f.context)).ok);
  const recorded=await recordWorkflow(validation.value,f.context);assert.equal(recorded.ok,false);if(!recorded.ok)assert.equal(recorded.error.code,'UNSUPPORTED_CAPABILITY');
  assert.equal(f.git('rev-parse','HEAD'),f.prepared.base.head);
  assert.equal(fs.readFileSync(path.join(f.cwd,report),'utf8'),'Performed review');
 }finally{f.close();}
});
