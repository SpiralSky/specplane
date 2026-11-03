import { test } from 'node:test';
import nativeFs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fixture,repo,id } from './workflow-test-fixture.js';
import { prepareWorkflow,captureContribution,readContributions } from './index.js';
import { releaseStoppedPreparation,sha256,assertPrepared,withPreparedActivity } from './workflow-preparation.js';
import { assertContributionRecordingAvailable } from './contribution-capture.js';
import type {ContributionEvent,CoreContext} from './contracts.js';
async function setup(withPort=true,policyNone=false){
 const r=repo(),p=await fixture();let calls=0;let completion:undefined|(()=>void);const observations=new Map<string,ContributionEvent>();
 const port={observe:async({eventId}:{eventId:string})=>{calls++;completion?.();return observations.get(eventId)??null;}};
 if(policyNone)r.put('.specplane/config.yaml',fs.readFileSync(path.join(r.cwd,'.specplane/config.yaml'),'utf8')+'specs:\n  feature:\n    llm_role: none\n');
 if(policyNone)r.git('commit','-am','configure policy');
 const context:CoreContext={checkout:r.cwd,extensionId:p.host.extensionId,compatibility:{manifest:p.manifest,host:p.host},...(withPort?{contributions:port}:{})};
 const result=await prepareWorkflow({protocol:1,workflow:'plan-step',checkout:r.cwd,extensionId:context.extensionId,mode:'attended',selection:{planId:id}},context);assert.ok(result.ok,JSON.stringify(result));if(!result.ok)throw Error('prepare');const prepared=result.value;
 function event(model?:string):ContributionEvent {const eventId=randomUUID(),report=`reviews/${eventId}.md`;r.put(report,'Performed review');return {eventId,requestId:prepared.requestId,spec:'base:feature/test',role:'review',source:'runtime',actor:{kind:'model',...(model?{provider:'observed',model_id:model}:{})},action:{kind:'review',evidencePath:report,evidenceDigest:sha256('Performed review')},revision:{reviewedDigest:sha256(fs.readFileSync(path.join(r.cwd,'specs/features/test.md')))}};}
 return {...r,context,prepared,observations,port,event,calls:()=>calls,onCompletion:(fn:()=>void)=>{completion=fn;},close:()=>releaseStoppedPreparation(prepared.requestId)};
}
test('trusted review capture keeps action models and separate unknowns with stable retries',async()=>{
 const f=await setup();try{
  for(const e of [f.event('A'),f.event('B'),f.event(),f.event()]){f.observations.set(e.eventId,structuredClone(e));const result=await captureContribution(e,f.context);assert.ok(result.ok,JSON.stringify(result));if(result.ok)result.value.event.actor.model_id='mutated';assert.ok((await captureContribution(e,f.context)).ok);}
  assert.equal(f.calls(),4);const read=await readContributions({requestId:f.prepared.requestId},f.context);assert.ok(read.ok);if(!read.ok)return;assert.equal(read.value.status,'pending');assert.equal(read.value.captures.length,4);assert.equal(read.value.captures.filter(c=>!c.event.actor.model_id).length,2);assert.ok(read.value.captures.every(c=>!c.recorded));
  const state=await assertPrepared(f.prepared.requestId,f.context);assert.throws(()=>assertContributionRecordingAvailable(state,[]),/atomically/);assert.throws(()=>assertContributionRecordingAvailable(state,[f.event('forged')]),/matching trusted/);
 }finally{f.close();}
});
test('missing or replaced port and unobserved declarations/identities cannot establish capture',async()=>{
 const missing=await setup(false);try{const e=missing.event('A'),result=await captureContribution(e,{...missing.context,contributions:{observe:async()=>e}});assert.equal(result.ok,false);if(!result.ok)assert.equal(result.error.code,'UNSUPPORTED_CAPABILITY');}finally{missing.close();}
 const f=await setup();try{
  for(const source of ['runtime','declared'] as const){const e={...f.event('spoof'),source},result=await captureContribution(e,{...f.context,contributions:{observe:async()=>e}});assert.equal(result.ok,false);if(!result.ok)assert.equal(result.error.code,'INVALID_EVIDENCE');}
  const e=f.event('A');f.observations.set(e.eventId,{...e,actor:{kind:'model',model_id:'B'}});assert.equal((await captureContribution(e,f.context)).ok,false);f.observations.set(e.eventId,e);assert.ok((await captureContribution(e,f.context)).ok);assert.equal((await captureContribution({...e,actor:{kind:'model'}},f.context)).ok,false);
 }finally{f.close();}
});
test('membership, revision, linked evidence and phase overlap refuse; empty inspection is read-only',async()=>{
 const f=await setup();try{
  const e=f.event('A');f.observations.set(e.eventId,e);
  for(const bad of [{...e,spec:'base:feature/other'},{...e,revision:{reviewedDigest:'0'.repeat(64)}},{...e,action:{...e.action,evidencePath:'../escape'}}])assert.equal((await captureContribution(bad,f.context)).ok,false);
  const target=path.join(f.cwd,e.action.evidencePath);fs.rmSync(target);fs.symlinkSync(path.join(f.cwd,'source.ts'),target);assert.equal((await captureContribution(e,f.context)).ok,false);
  const locked=await withPreparedActivity(e.requestId,'execution',()=>captureContribution(e,f.context));assert.equal(locked.ok,false);if(!locked.ok)assert.equal(locked.error.code,'LOCKED');
  const dir=path.join(f.cwd,'.git/specplane-runtime/contributions',e.requestId);assert.equal(fs.existsSync(dir),false);assert.ok((await readContributions({requestId:e.requestId},f.context)).ok);assert.equal(fs.existsSync(dir),false);
 }finally{f.close();}
});
test('host completion rechecks evidence; journal tampering and missing records refuse recovery',async()=>{
 const f=await setup();try{const e=f.event('A');f.observations.set(e.eventId,e);f.onCompletion(()=>f.put(e.action.evidencePath,'changed'));assert.equal((await captureContribution(e,f.context)).ok,false);f.onCompletion(()=>{});f.put(e.action.evidencePath,'Performed review');
  // Replacing the original object method also cannot change preparation's bound port.
  f.port.observe=async()=>null;assert.ok((await captureContribution(e,f.context)).ok);
  const file=path.join(f.cwd,'.git/specplane-runtime/contributions',e.requestId,`${e.eventId}.json`);fs.writeFileSync(file,'{}');const read=await readContributions({requestId:e.requestId},f.context);assert.equal(read.ok,false);if(!read.ok)assert.equal(read.error.code,'RECOVERY_REQUIRED');assert.equal((await captureContribution(e,f.context)).ok,false);fs.rmSync(file);assert.equal((await readContributions({requestId:e.requestId},f.context)).ok,false);
 }finally{f.close();}
});
test('orphan records and records injected while awaiting the host refuse before capture write',async()=>{
 for(const during of [false,true]){const f=await setup();try{const e=f.event('A');f.observations.set(e.eventId,e);const dir=path.join(f.cwd,'.git/specplane-runtime/contributions',e.requestId),inject=()=>{fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'orphan.json'),'{}');};if(during)f.onCompletion(inject);else inject();
  if(!during){const read=await readContributions({requestId:e.requestId},f.context);assert.equal(read.ok,false);if(!read.ok)assert.equal(read.error.code,'RECOVERY_REQUIRED');}
  const result=await captureContribution(e,f.context);assert.equal(result.ok,false);if(!result.ok)assert.equal(result.error.code,'RECOVERY_REQUIRED');assert.deepEqual(fs.readdirSync(dir),['orphan.json']);
 }finally{f.close();}}
});
test('cancellation during awaited observation prevents capture and preserves evidence',async()=>{
 const f=await setup();try{const e=f.event('A');f.observations.set(e.eventId,e);const controller=new AbortController();f.onCompletion(()=>controller.abort());const result=await captureContribution(e,{...f.context,signal:controller.signal});assert.equal(result.ok,false);if(!result.ok)assert.equal(result.error.code,'CANCELLED');assert.equal(fs.existsSync(path.join(f.cwd,'.git/specplane-runtime/contributions',e.requestId)),false);}finally{f.close();}
});


test('policy-none model reviews and unsupported body-action capture refuse explicitly',async()=>{
 const f=await setup(true,true);try{const e=f.event('A');f.observations.set(e.eventId,e);const result=await captureContribution(e,f.context);assert.equal(result.ok,false);if(!result.ok)assert.equal(result.error.code,'POLICY_DENIED');}finally{f.close();}
 const g=await setup();try{const e=g.event('A'),edit:ContributionEvent={...e,role:'revise',action:{...e.action,kind:'edit'},revision:{beforeDigest:'a'.repeat(64),afterDigest:'b'.repeat(64)}};const result=await captureContribution(edit,g.context);assert.equal(result.ok,false);if(!result.ok)assert.equal(result.error.code,'UNSUPPORTED_CAPABILITY');}finally{g.close();}
});
test('captured journal hardlinks and directory symlinks require recovery',async()=>{
 for(const symlink of [false,true]){const f=await setup();try{const e=f.event('A');f.observations.set(e.eventId,e);assert.ok((await captureContribution(e,f.context)).ok);const dir=path.join(f.cwd,'.git/specplane-runtime/contributions',e.requestId),file=path.join(dir,`${e.eventId}.json`);
  if(symlink){fs.renameSync(dir,dir+'-original');fs.symlinkSync(dir+'-original',dir);}else fs.linkSync(file,path.join(f.cwd,'linked-record'));
  const result=await readContributions({requestId:e.requestId},f.context);assert.equal(result.ok,false);if(!result.ok)assert.equal(result.error.code,'RECOVERY_REQUIRED');
 }finally{f.close();}}
});

test('capture refuses a review parent replaced between traversal and open',async(t)=>{
 const f=await setup();try{
  const e=f.event('A');f.observations.set(e.eventId,e);
  const parent=path.join(f.cwd,'reviews'),replacement=path.join(f.cwd,'replacement');
  fs.mkdirSync(replacement);fs.writeFileSync(path.join(replacement,path.basename(e.action.evidencePath)),'Performed review');
  const open=nativeFs.openSync;let swapped=false;
  const mocked=t.mock.method(nativeFs,'openSync',((file:fs.PathLike,flags:fs.OpenMode,mode?:fs.Mode)=>{
   if(!swapped&&String(file)===path.join(f.cwd,e.action.evidencePath)){
    swapped=true;fs.renameSync(parent,parent+'-original');fs.symlinkSync(replacement,parent,process.platform==='win32'?'junction':'dir');
   }
   return open(file,flags,mode);
  }) as typeof nativeFs.openSync);
  syncBuiltinESMExports();
  try{const result=await captureContribution(e,f.context);assert.ok(swapped);assert.equal(result.ok,false);assert.equal(f.calls(),0);assert.deepEqual(fs.readdirSync(replacement),[path.basename(e.action.evidencePath)]);}
  finally{mocked.mock.restore();syncBuiltinESMExports();}
 }finally{f.close();}
});
