import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { repo, id } from './workflow-test-fixture.js';
import { recoverWorkflowRecording } from './recording-recovery.js';
import { acquireWriterLease, checkoutIdentity } from './writer-leases.js';
import type { CoreContext } from './contracts.js';

function recorded(remote=false,content=false,creation?:'spec'|'plan'){
 const r=repo();let bare='';
 if(creation==='spec'){r.put('.specplane/config.yaml',fs.readFileSync(path.join(r.cwd,'.specplane/config.yaml'),'utf8')+'specs:\n  feature:\n    llm_role: assist\n');r.git('commit','-am','assist creation policy');}
 if(content){r.put('specs/architecture/test.md','---\nid: architecture/test\ntitle: Test architecture\nstatus: draft\nauthor: user\nimplements: [base:feature/test]\n---\n# Architecture\n');r.git('add','specs/architecture/test.md');r.git('commit','-m','add architecture draft');}
 if(remote){
  bare=fs.mkdtempSync(path.join(os.tmpdir(),'recovery-remote-'));
  execFileSync('git',['init','--bare',bare],{stdio:'ignore'});
  r.git('remote','add','origin',bare);r.git('push','-u','origin',`plan/${id}`);r.git('push','origin','main');
  fs.writeFileSync(path.join(bare,'hooks','pre-receive'),'#!/bin/sh\nexit 1\n',{mode:0o755});
 }
 const script=`import fs from 'node:fs';import path from 'node:path';
 import {fixture,id} from ${JSON.stringify(new URL('./workflow-test-fixture.js',import.meta.url).href)};
 import {prepareWorkflow,validateWorkflowResult,recordWorkflow} from ${JSON.stringify(new URL('./index.js',import.meta.url).href)};
 import {sha256} from ${JSON.stringify(new URL('./workflow-preparation.js',import.meta.url).href)};
 const content=${content},creation=${JSON.stringify(creation)},workflow=creation==='spec'?'spec-assist':creation==='plan'?'plan-create':content?'spec-draft-architecture':'plan-step';
 const cwd=process.argv[1],p=await fixture(workflow),context={checkout:cwd,extensionId:p.host.extensionId,compatibility:{manifest:p.manifest,host:p.host},interaction:{confirm:async challenge=>({challengeId:challenge.challengeId,decision:'confirm',interactionId:'human'})}};
 const prepared=await prepareWorkflow({protocol:1,workflow,checkout:cwd,extensionId:context.extensionId,mode:'attended',selection:creation?{specIds:['base:feature/test'],input:'Create finalized content'}:content?{specIds:['base:architecture/test'],input:'Draft architecture body'}:{planId:id}},context);
 if(!prepared.ok)throw Error(JSON.stringify(prepared));
 const editPath=content?'specs/architecture/test.md':'source.ts',before=fs.readFileSync(path.join(cwd,editPath),'utf8'),after=content?before+'Architecture implementation details.\\n':'implementation';
 if(!creation)fs.writeFileSync(path.join(cwd,editPath),after);
 const newContent=creation==='spec'?{operation:'spec.new',arguments:{type:'feature',slug:'recovered',title:'Recovered'},body:'# Recovered\\n\\nHuman-finalized behavior.\\n'}:creation==='plan'?{operation:'plan.new',arguments:{id:'2026-11-04-recovered',title:'Recovered plan',specs:['base:feature/test']},body:'# Recovered plan\\n\\n## Goal\\n\\nImplement behavior.\\n',steps:[{title:'Implement',context:[{spec:'base:feature/test'}],body:'## Goal\\n\\nImplement behavior.\\n\\n## Acceptance criteria\\n\\n- [ ] Works\\n'}]}:undefined;
 const result={protocol:1,requestId:prepared.value.requestId,baseDigest:prepared.value.base.digest,outcome:'blocked',summary:'record interrupted workflow',changes:creation?[]:[{path:editPath,beforeDigest:sha256(before),afterDigest:sha256(after),purpose:'implementation'}],criterionEvidence:prepared.value.criteria.map(c=>({criterionId:c.id,assessment:'uncertain',rationale:'Acceptance review pending',artifacts:[]})),gaps:[],contextExpansion:[],contributionEvents:[],openIssues:'BLOCKED: acceptance review remains pending',nextKnows:'Preserve limitations',...(newContent?{creation:newContent}:{})};
 const proposal=await validateWorkflowResult(prepared.value,result,context);if(!proposal.ok)throw Error(JSON.stringify(proposal));
 const receipt=await recordWorkflow(proposal.value,context);if(!receipt.ok)throw Error(JSON.stringify(receipt));
 process.stdout.write(JSON.stringify({requestId:prepared.value.requestId,extensionId:context.extensionId,receipt:receipt.value,packageRoot:p.root}));`;
 const child=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script,r.cwd],{encoding:'utf8',env:{...process.env,NODE_TEST_CONTEXT:''}}));
 const runtime=path.join(checkoutIdentity(r.cwd).commonDir,'specplane-runtime'),directory=path.join(runtime,'workflows',child.requestId);
 const context:CoreContext={checkout:r.cwd,extensionId:child.extensionId,lifecycle:{stopWorkflow:async()=>({stopped:true,recoveryRequired:false})}};
 return {...r,...child,bare,runtime,directory,context,cleanup:()=>{fs.rmSync(r.cwd,{recursive:true,force:true});fs.rmSync(child.packageRoot,{recursive:true,force:true});if(bare)fs.rmSync(bare,{recursive:true,force:true});}};
}
function retained(f:ReturnType<typeof recorded>){
 assert.throws(()=>acquireWriterLease({checkouts:[f.cwd],requestId:'racer'}),{code:'RECOVERY_REQUIRED'});
 assert.equal(fs.readdirSync(f.runtime).filter(name=>name.startsWith('host-')).length,1);
}
function thirdProcess(f:ReturnType<typeof recorded>){
 const script=`import {recoverWorkflowRecording} from ${JSON.stringify(new URL('./recording-recovery.js',import.meta.url).href)};
 const result=await recoverWorkflowRecording(process.argv[2],{checkout:process.argv[1],extensionId:process.argv[3]});process.stdout.write(JSON.stringify(result));`;
 return JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script,f.cwd,f.requestId,f.extensionId],{encoding:'utf8',env:{...process.env,NODE_TEST_CONTEXT:''}}));
}

test('another process recovers the exact completed commit without replaying implementation',async()=>{
 const f=recorded();try{
  let stops=0;f.context.lifecycle={stopWorkflow:async()=>{stops++;return {stopped:true,recoveryRequired:false};}};
  const before=f.git('rev-list','--count','HEAD');
  const result=await recoverWorkflowRecording(f.requestId,f.context);
  assert.ok(result.ok,JSON.stringify(result));if(!result.ok)return;
  assert.equal(result.value.commit,f.receipt.commit);assert.equal(result.value.publication,'not-required');assert.equal(result.value.outcome,'blocked');
  assert.ok(result.value.limitations?.some(text=>text.includes('not revalidated or reconstructed')));
  assert.equal(f.git('rev-list','--count','HEAD'),before);assert.equal(f.git('status','--porcelain'),'');
  assert.equal(fs.readdirSync(f.runtime).filter(name=>name.startsWith('host-')).length,0);
  result.value.commit='caller-mutation';
  const retry=await recoverWorkflowRecording(f.requestId,f.context);assert.ok(retry.ok,JSON.stringify(retry));if(retry.ok)assert.equal(retry.value.commit,f.receipt.commit);
  assert.equal(stops,1);
  const another=thirdProcess(f);assert.ok(another.ok,JSON.stringify(another));assert.equal(another.value.commit,f.receipt.commit);assert.equal(another.value.publication,'not-required');
  const next=acquireWriterLease({checkouts:[f.cwd],requestId:'next'});next.release();
 }finally{f.cleanup();}
});

test('non-plan content recording recovers the exact spec commit without inventing plan progress',async()=>{
 const f=recorded(false,true);try{
  const count=f.git('rev-list','--count','HEAD');
  const result=await recoverWorkflowRecording(f.requestId,f.context);assert.ok(result.ok,JSON.stringify(result));if(!result.ok)return;
  assert.equal('planId' in result.value,false);assert.equal(result.value.commit,f.receipt.commit);
  if('requestId' in result.value){assert.equal(result.value.workflow,'spec-draft-architecture');assert.deepEqual(result.value.paths,['specs/architecture/test.md']);assert.ok(result.value.limitations.includes('Private receipts remain local to this clone.'));assert.ok(result.value.limitations.some(text=>text.includes('not revalidated or reconstructed')));}
  assert.equal(f.git('rev-list','--count','HEAD'),count);
  const again=thirdProcess(f);assert.ok(again.ok,JSON.stringify(again));assert.equal(again.value.commit,f.receipt.commit);assert.equal('planId' in again.value,false);
 }finally{f.cleanup();}
});

test('completed spec and plan creations recover their exact dedicated absent-path recording scope',async()=>{
 for(const creation of ['spec','plan'] as const){
  const f=recorded(false,false,creation);try{
   const count=f.git('rev-list','--count','HEAD'),intent=JSON.parse(fs.readFileSync(path.join(f.directory,'recording-intent.json'),'utf8'));
   assert.ok(f.receipt.creation);assert.equal(f.receipt.creation.operation,creation==='spec'?'spec.new':'plan.new');
   for(const file of f.receipt.paths){assert.equal(f.git('ls-tree',`${f.receipt.commit}^`,'--',file),'');assert.ok(intent.commit.transaction.generated.some((change:any)=>change.path===file&&change.before===null));}
   const result=await recoverWorkflowRecording(f.requestId,f.context);assert.ok(result.ok,JSON.stringify(result));if(!result.ok)continue;
   assert.equal(result.value.commit,f.receipt.commit);assert.equal('planId' in result.value,false);
   if('creation' in result.value)assert.deepEqual(result.value.creation,f.receipt.creation);
   if('paths' in result.value)assert.deepEqual(result.value.paths,f.receipt.paths);
   assert.equal(f.git('rev-list','--count','HEAD'),count);assert.equal(f.git('status','--porcelain'),'');
   const another=thirdProcess(f);assert.ok(another.ok,JSON.stringify(another));assert.deepEqual(another.value.creation,f.receipt.creation);assert.equal(another.value.commit,f.receipt.commit);
  }finally{f.cleanup();}
 }
});

test('malformed creation workflow or absent-path scope refuses without consulting the host',async()=>{
 const f=recorded(false,false,'spec');try{
  const file=path.join(f.directory,'recording-intent.json'),original=fs.readFileSync(file);let stops=0;
  f.context.lifecycle={stopWorkflow:async()=>{stops++;return {stopped:true,recoveryRequired:false};}};
  for(const scenario of ['workflow','scaffolds','preimage','outside'] as const){
   const intent=JSON.parse(original.toString());
   if(scenario==='workflow')intent.commit.receipt.creation.operation='plan.new';
   if(scenario==='scaffolds')delete intent.commit.transaction.creation;
   if(scenario==='preimage')intent.commit.transaction.generated[0].before='invented preimage';
   if(scenario==='outside'){intent.commit.receipt.paths.push('source.ts');intent.proposal.paths.push('source.ts');}
   fs.writeFileSync(file,JSON.stringify(intent));
   const result=await recoverWorkflowRecording(f.requestId,f.context);assert.equal(result.ok,false,scenario);
   if(!result.ok)assert.match(result.error.message,scenario==='workflow'?/operation differs/:scenario==='outside'?/paths exceed prepared scope/:/Malformed creation recovery scope/);
   assert.equal(stops,0);assert.equal(f.git('rev-parse','HEAD'),f.receipt.commit);retained(f);
  }
  fs.writeFileSync(file,original);assert.ok((await recoverWorkflowRecording(f.requestId,f.context)).ok);
 }finally{f.cleanup();}
});

test('a completed marker cannot be omitted or changed to authorize another-process retry',async()=>{
 const f=recorded();try{
  assert.ok((await recoverWorkflowRecording(f.requestId,f.context)).ok);
  const marker=path.join(f.runtime,fs.readdirSync(f.runtime).find(name=>name.startsWith('completed-host-'))!);
  const original=fs.readFileSync(marker),binding=JSON.parse(original.toString());
  fs.writeFileSync(marker,JSON.stringify({...binding,evidenceDigest:'b'.repeat(64)}));
  assert.equal(thirdProcess(f).ok,false);
  fs.unlinkSync(marker);assert.equal(thirdProcess(f).ok,false);
  fs.writeFileSync(marker,original);assert.ok(thirdProcess(f).ok);
  assert.equal(f.git('rev-parse','HEAD'),f.receipt.commit);
 }finally{f.cleanup();}
});

test('missing uncertain or failed host stop proof preserves the completed commit and retained lease',async()=>{
 const f=recorded();try{
  for(const lifecycle of [undefined,{stopWorkflow:async()=>({stopped:false,recoveryRequired:true})},{stopWorkflow:async()=>{throw new Error('host unavailable');}}]){
   const result=await recoverWorkflowRecording(f.requestId,{...f.context,lifecycle});assert.equal(result.ok,false);
   retained(f);assert.equal(f.git('rev-parse','HEAD'),f.receipt.commit);
  }
  const recovered=await recoverWorkflowRecording(f.requestId,f.context);assert.ok(recovered.ok,JSON.stringify(recovered));
 }finally{f.cleanup();}
});

test('a live retained owner refuses recovery before consulting the host stop port',async()=>{
 const f=recorded();try{
  const files=fs.readdirSync(f.runtime).filter(name=>name.endsWith('.json')).map(name=>path.join(f.runtime,name));
  const saved=files.map(file=>fs.readFileSync(file,'utf8'));
  for(const [i,file] of files.entries())fs.writeFileSync(file,JSON.stringify({...JSON.parse(saved[i]),pid:process.pid}));
  let stops=0;const before=files.map(file=>fs.readFileSync(file,'utf8'));
  const result=await recoverWorkflowRecording(f.requestId,{...f.context,lifecycle:{stopWorkflow:async()=>{stops++;return {stopped:true,recoveryRequired:false};}}});
  assert.equal(result.ok,false);if(!result.ok)assert.equal(result.error.code,'RECOVERY_REQUIRED');
  assert.equal(stops,0);assert.deepEqual(files.map(file=>fs.readFileSync(file,'utf8')),before);
  for(const [i,file] of files.entries())fs.writeFileSync(file,saved[i]);
  assert.ok((await recoverWorkflowRecording(f.requestId,f.context)).ok);
 }finally{f.cleanup();}
});

test('changed intent wrong extension and missing durable state never become recovery authority',async()=>{
 const f=recorded();try{
  let stops=0;const context={...f.context,lifecycle:{stopWorkflow:async()=>{stops++;return {stopped:true,recoveryRequired:false};}}};
  for(const [request,owner] of [[f.requestId,'another-extension'],[randomUUID(),f.context.extensionId],['../escape',f.context.extensionId]]){
   assert.equal((await recoverWorkflowRecording(request,{...context,extensionId:owner})).ok,false);
  }
  const file=path.join(f.directory,'recording-intent.json'),original=fs.readFileSync(file);
  const intent=JSON.parse(original.toString());fs.writeFileSync(file,JSON.stringify({...intent,summary:'invented summary'}));
  assert.equal((await recoverWorkflowRecording(f.requestId,context)).ok,false);assert.equal(stops,0);retained(f);
  fs.writeFileSync(file,original);assert.ok((await recoverWorkflowRecording(f.requestId,context)).ok);
 }finally{f.cleanup();}
});

test('changed worktree or stale index requires reconciliation before lease adoption',async()=>{
 const f=recorded();try{
  f.put('source.ts','unreviewed');
  const result=await recoverWorkflowRecording(f.requestId,f.context);assert.equal(result.ok,false);retained(f);
  assert.equal(fs.readFileSync(path.join(f.cwd,'source.ts'),'utf8'),'unreviewed');
  f.put('source.ts','implementation');
  f.git('read-tree',`${f.receipt.commit}^`);
  assert.equal((await recoverWorkflowRecording(f.requestId,f.context)).ok,false);retained(f);
  f.git('read-tree','HEAD');assert.ok((await recoverWorkflowRecording(f.requestId,f.context)).ok);
 }finally{f.cleanup();}
});

test('a changed commit with matching tree cannot replace the exact intended recording',async()=>{
 const f=recorded();try{
  const original=f.git('rev-parse','HEAD');f.git('commit','--amend','-m','unrelated replacement');
  const result=await recoverWorkflowRecording(f.requestId,f.context);assert.equal(result.ok,false);retained(f);
  f.git('update-ref','HEAD',original);assert.ok((await recoverWorkflowRecording(f.requestId,f.context)).ok);
 }finally{f.cleanup();}
});

test('an extra trailing message newline cannot replace the exact intended recording',async()=>{
 const f=recorded();try{
  const intent=JSON.parse(fs.readFileSync(path.join(f.directory,'recording-intent.json'),'utf8')),original=f.git('rev-parse','HEAD');
  const replacement=execFileSync('git',['commit-tree',intent.commit.tree,'-p',intent.commit.head],{cwd:f.cwd,input:intent.commit.message+'\n',encoding:'utf8'}).trim();
  f.git('update-ref','HEAD',replacement);
  assert.equal(f.git('rev-parse','HEAD^{tree}'),intent.commit.tree);
  const result=await recoverWorkflowRecording(f.requestId,f.context);assert.equal(result.ok,false);
  if(!result.ok)assert.match(result.error.message,/commit message differs/);
  retained(f);f.git('update-ref','HEAD',original);assert.ok((await recoverWorkflowRecording(f.requestId,f.context)).ok);
 }finally{f.cleanup();}
});

test('failed publication recovery retains ownership and retries only the existing commit',async()=>{
 const f=recorded(true);try{
  const count=f.git('rev-list','--count','HEAD');
  const failed=await recoverWorkflowRecording(f.requestId,f.context);assert.ok(failed.ok,JSON.stringify(failed));if(!failed.ok)return;
  assert.equal(failed.value.publication,'failed');assert.equal(failed.value.commit,f.receipt.commit);
  assert.throws(()=>acquireWriterLease({checkouts:[f.cwd],requestId:'racer'}),{code:'LOCKED'});
  const url=f.git('remote','get-url','--push','origin');f.git('remote','set-url','--push','origin',f.cwd);
  const moved=await recoverWorkflowRecording(f.requestId,f.context);assert.ok(moved.ok);if(moved.ok){assert.equal(moved.value.publication,'failed');assert.match(moved.value.publicationError!,/destination changed/);}
  f.git('remote','set-url','--push','origin',url);fs.writeFileSync(path.join(f.bare,'hooks','pre-receive'),'#!/bin/sh\nexit 0\n');
  const published=await recoverWorkflowRecording(f.requestId,f.context);assert.ok(published.ok,JSON.stringify(published));if(!published.ok)return;
  assert.equal(published.value.publication,'published');assert.equal(published.value.commit,f.receipt.commit);assert.equal(f.git('rev-list','--count','HEAD'),count);
  assert.equal(execFileSync('git',['rev-parse',`refs/heads/plan/${id}`],{cwd:f.bare,encoding:'utf8'}).trim(),f.receipt.commit);
  const observed=thirdProcess(f);assert.ok(observed.ok,JSON.stringify(observed));assert.equal(observed.value.publication,'published');assert.equal(observed.value.commit,f.receipt.commit);
  assert.equal(f.git('rev-list','--count','HEAD'),count);
 }finally{f.cleanup();}
});
