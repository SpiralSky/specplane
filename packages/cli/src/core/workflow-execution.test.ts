import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { fixture,repo,stepFile,id } from './workflow-test-fixture.js';
import { releaseStoppedPreparation, sha256, withPreparedActivity } from './workflow-preparation.js';
import { validateExecutionArtifact } from './workflow-execution.js';
import { prepareWorkflow, executeWorkflowTest } from './index.js';
import { parseTestReport } from './test-reporters.js';
import type { CoreContext, ExecutionPort, WorkflowTestRequest } from './contracts.js';
const realPort:ExecutionPort={execute:async r=>new Promise((resolve,reject)=>{
 assert.equal(r.env.NODE_TEST_CONTEXT,undefined);
 const executable=r.executable==='node'?process.execPath:r.executable;
 const child=spawn(executable,r.args,{cwd:r.checkout,env:r.env,shell:false,signal:r.signal});const stdout:Buffer[]=[],stderr:Buffer[]=[];
 child.stdout.on('data',b=>stdout.push(b));child.stderr.on('data',b=>stderr.push(b));child.on('error',error=>{if(!child.pid)reject(error);});child.on('close',(exitCode,signal)=>resolve({executable,exitCode,signal,stdout:Buffer.concat(stdout),stderr:Buffer.concat(stderr)}));
})};
async function setup(port:ExecutionPort=realPort,format:'node-tap-v13'|'junit-xml'='node-tap-v13',suiteId='workflow-suite'){
 const r=repo();const mapping={schemaVersion:1,workflow:'plan-step',criteria:[{sourcePath:stepFile,sourceDigest:sha256(fs.readFileSync(path.join(r.cwd,stepFile))),criterionIndex:1,evidence:'test',testRequirements:[{suiteId,format}]}]};
 const p=await fixture('plan-step','# Contract\n\n## Procedure\n\n```specplane-test-requirements\n'+JSON.stringify(mapping)+'\n```\n');
 const context:CoreContext={checkout:r.cwd,extensionId:p.host.extensionId,compatibility:{manifest:p.manifest,host:p.host},execution:port};
 const prepared=await prepareWorkflow({protocol:1,workflow:'plan-step',extensionId:context.extensionId,checkout:r.cwd,mode:'attended',selection:{planId:id}},context);
 assert.equal(prepared.ok,true,JSON.stringify(prepared));if(!prepared.ok)throw new Error('prepare failed');
 const request:WorkflowTestRequest={requestId:prepared.value.requestId,criterionIds:[prepared.value.criteria[0].id],executable:'node',args:['--test','--test-reporter=tap','check.cjs'],reportFormat:format};
 r.put('check.cjs',"const {describe,it}=require('node:test');describe('workflow-suite',()=>{it('runs',()=>{});it.skip('skipped',()=>{});});\n");
 return {...r,p,context,prepared:prepared.value,request,close:()=>releaseStoppedPreparation(prepared.value.requestId)};
}
test('real prepare-edit-execute-validate retains lease, parses actual cases and rejects mutations',async()=>{
 const f=await setup();try{
 const a=await executeWorkflowTest(f.request,f.context);assert.equal(a.ok,true,JSON.stringify(a));if(!a.ok)return;
 assert.equal(a.value.artifact.path,`${a.value.executionId}.json`);assert.equal(a.value.assertions[0].executed,1);assert.equal(a.value.assertions[0].skipped,1);
 const originalArtifact=structuredClone(a.value.artifact);a.value.artifact.path='mutated';a.value.assertions[0].executed=999;await validateExecutionArtifact(f.request.requestId,f.request.criterionIds[0],originalArtifact,f.context);a.value.artifact=originalArtifact;
 const receipt=await validateExecutionArtifact(f.request.requestId,f.request.criterionIds[0],a.value.artifact,f.context);assert.equal(receipt.executable,process.execPath);
 await assert.rejects(validateExecutionArtifact('wrong',f.request.criterionIds[0],a.value.artifact,f.context));
 await assert.rejects(validateExecutionArtifact(f.request.requestId,f.request.criterionIds[0],{...a.value.artifact,digest:'0'.repeat(64)},f.context));
 const file=path.join(f.cwd,'.git','specplane-runtime','workflows',f.request.requestId,'evidence',receipt.stdout.path),original=fs.readFileSync(file);fs.appendFileSync(file,'tamper');await assert.rejects(validateExecutionArtifact(f.request.requestId,f.request.criterionIds[0],a.value.artifact,f.context),/output changed/);fs.writeFileSync(file,original);
 const receiptPath=path.join(f.cwd,'.git','specplane-runtime','workflows',f.request.requestId,'evidence',a.value.artifact.path),receiptBytes=fs.readFileSync(receiptPath);fs.appendFileSync(receiptPath,' ');await assert.rejects(validateExecutionArtifact(f.request.requestId,f.request.criterionIds[0],a.value.artifact,f.context),/receipt changed/);fs.writeFileSync(receiptPath,receiptBytes);
 f.put('source.ts','changed after tests');await assert.rejects(validateExecutionArtifact(f.request.requestId,f.request.criterionIds[0],a.value.artifact,f.context),/state changed/);
 }finally{f.close();}
});
test('failure, skipped-only and absent expected suites cannot establish passing criteria',async()=>{
 for(const source of ["require('node:test').describe('workflow-suite',()=>{});", "const {describe,it}=require('node:test');describe('workflow-suite',()=>it('fails',()=>{throw Error('failure')}));", "const {describe,it}=require('node:test');describe('workflow-suite',()=>it.skip('skipped',()=>{}));", "require('node:test').test('other-suite',()=>{});", "console.log('TAP version 13\\n1..0');", "console.log('TAP version 13\\nok 1 - workflow-suite\\n1..1');process.exitCode=2;"]){
 const f=await setup();try{f.put('check.cjs',source);const a=await executeWorkflowTest(f.request,f.context);assert.equal(a.ok,true,JSON.stringify(a));if(a.ok)await assert.rejects(validateExecutionArtifact(f.request.requestId,f.request.criterionIds[0],a.value.artifact,f.context));}finally{f.close();}}
});
test('permission refusal, malformed requests and stale prepared inputs never create passing artifacts',async()=>{
 const f=await setup({execute:async()=>{throw Object.assign(new Error('Permission denied'),{code:'PERMISSION_DENIED'});}});try{
 for(const request of [{...f.request,extra:true},{...f.request,criterionIds:['unknown']},{...f.request,reportFormat:'junit-xml'}])assert.equal((await executeWorkflowTest(request as any,f.context)).ok,false);
 const a=await executeWorkflowTest(f.request,f.context);assert.equal(a.ok,false);if(!a.ok)assert.equal(a.error.code,'PERMISSION_DENIED');
 f.put(stepFile,fs.readFileSync(path.join(f.cwd,stepFile),'utf8')+'changed');assert.equal((await executeWorkflowTest(f.request,f.context)).ok,false);
 }finally{f.close();}
});
test('one execution excludes another phase, release and concurrent execution; changed bytes fail postcheck',async()=>{
 let started!:()=>void,finish!:()=>void;const began=new Promise<void>(r=>started=r),gate=new Promise<void>(r=>finish=r);
 const f=await setup({execute:async r=>{started();await gate;return realPort.execute(r);}});try{
 const pending=executeWorkflowTest(f.request,f.context);await began;
 const second=await executeWorkflowTest(f.request,f.context);assert.equal(second.ok,false);if(!second.ok)assert.equal(second.error.code,'LOCKED');
 await assert.rejects(withPreparedActivity(f.request.requestId,'validation',async()=>{}),/already running/);assert.throws(f.close,/active phase/);
 f.put('source.ts','changed during tests');finish();const a=await pending;assert.equal(a.ok,false);if(!a.ok)assert.equal(a.error.code,'STALE_STATE');
 }finally{finish();f.close();}
});
test('cancellation propagates through host signal and leaves stopped lease release explicit',async()=>{
 let started!:()=>void;const began=new Promise<void>(r=>started=r);const controller=new AbortController();
 const f=await setup({execute:async r=>{started();return new Promise((_,reject)=>{r.signal!.addEventListener('abort',()=>reject(new Error('stopped')),{once:true});});}});
 try{const pending=executeWorkflowTest(f.request,{...f.context,signal:controller.signal});await began;controller.abort();const a=await pending;assert.equal(a.ok,false);if(!a.ok)assert.equal(a.error.code,'CANCELLED');}finally{f.close();}
});
test('JUnit cases ignore dishonest summary totals; malformed XML and duplicate suites stay diagnostic',()=>{
 const parse=(s:string)=>parseTestReport(Buffer.from(s),'junit-xml');
 assert.deepEqual(parse('<testsuites><testsuite name="suite" tests="99" failures="0"><testcase name="a"/><testcase name="b"><failure/></testcase><testcase name="c"><skipped/></testcase></testsuite></testsuites>'),[{suiteId:'suite',executed:2,failed:1,skipped:1}]);
 for(const bad of ['<!DOCTYPE x><testsuite name="suite"/>','<testsuite name="suite"><testcase/></oops>','<testsuites><testsuite name="x"/><testsuite name="x"/></testsuites>', '<testsuite name="x"><testcase><skipped/><failure/></testcase></testsuite>', '<testsuite name="x"><testcase/><failure/></testsuite>'])assert.deepEqual(parse(bad),[]);
});
test('real stdout JUnit receipt and diagnostic output; runtime symlinks refuse',async()=>{
 const f=await setup(realPort,'junit-xml');try{
 f.request.args=['check.cjs'];f.put('check.cjs',`console.log(${JSON.stringify('<testsuites><testsuite name="workflow-suite"><testcase name="runs"/></testsuite></testsuites>')});`);
 const a=await executeWorkflowTest(f.request,f.context);assert.equal(a.ok,true,JSON.stringify(a));if(a.ok){await validateExecutionArtifact(f.request.requestId,f.request.criterionIds[0],a.value.artifact,f.context);const ledgerPath=path.join(f.cwd,'.git','specplane-runtime','workflows',f.request.requestId,`${a.value.executionId}.ledger.json`);fs.appendFileSync(ledgerPath,' ');await assert.rejects(validateExecutionArtifact(f.request.requestId,f.request.criterionIds[0],a.value.artifact,f.context),/ledger changed/);}
 f.put('check.cjs',"console.log('not xml')");const b=await executeWorkflowTest(f.request,f.context);assert.equal(b.ok,true);if(b.ok){assert.equal(b.notices[0].code,'UNCERTAIN_TEST_REPORT');await assert.rejects(validateExecutionArtifact(f.request.requestId,f.request.criterionIds[0],b.value.artifact,f.context));}
 }finally{f.close();}
 const g=await setup();try{fs.symlinkSync(g.p.root,path.join(g.cwd,'.git','specplane-runtime','workflows'));const a=await executeWorkflowTest(g.request,g.context);assert.equal(a.ok,false);if(!a.ok)assert.match(a.error.message,/Nonregular evidence directory/);}finally{g.close();}
});

test('skipped TAP parent never exposes passing nested suites',()=>{
 const report='TAP version 13\n# Subtest: outer\n    # Subtest: inner\n        # Subtest: case\n        ok 1 - case\n        1..1\n    ok 1 - inner\n    1..1\nok 1 - outer # SKIP disabled\n1..1\n';
 assert.deepEqual(parseTestReport(Buffer.from(report),'node-tap-v13'),[{suiteId:'outer',executed:0,failed:0,skipped:1}]);
});

test('malformed TAP ordinals and missing empty-suite plans cannot prove execution',()=>{
 for(const report of ['TAP version 13\nok 99 - suite\n1..1\n', 'TAP version 13\nok 1 - suite\nok 1 - other\n1..2\n'])assert.deepEqual(parseTestReport(Buffer.from(report),'node-tap-v13'),[]);
 assert.deepEqual(parseTestReport(Buffer.from('TAP version 13\n# Subtest: suite\n    1..0\nok 1 - suite\n1..1\n'),'node-tap-v13'),[{suiteId:'suite',executed:0,failed:0,skipped:0}]);
});
test('real child cancellation waits for close and cannot yield passing receipt',async()=>{
 let started!:()=>void;const began=new Promise<void>(r=>started=r),controller=new AbortController();
 const f=await setup({execute:r=>{const execution=realPort.execute(r);started();return execution;}});
 try{f.put('check.cjs','setInterval(()=>{},1000)');f.request.args=['check.cjs'];const execution=executeWorkflowTest(f.request,{...f.context,signal:controller.signal});await began;controller.abort();const a=await execution;assert.equal(a.ok,false);if(!a.ok)assert.equal(a.error.code,'CANCELLED');}finally{f.close();}
});
