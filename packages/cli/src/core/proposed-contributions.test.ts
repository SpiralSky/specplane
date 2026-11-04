import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture,repo} from './workflow-test-fixture.js';
import {prepareWorkflow,captureProposedContribution,validateWorkflowResult,recordWorkflow} from './index.js';
import {releaseStoppedPreparation,sha256} from './workflow-preparation.js';
import {setFinalizedAssistAuthor} from './contribution-metadata.js';
import {parseFrontmatter} from '../frontmatter.js';
import {readTrailerEntries} from '../git/commit.js';
import type {CoreContext,ContributionEvent,ContributionProposal,WorkflowResult} from './contracts.js';

async function setup(port=true,confirm=true){
 const r=repo(),p=await fixture('spec-assist');
 r.put('.specplane/config.yaml',fs.readFileSync(path.join(r.cwd,'.specplane/config.yaml'),'utf8')+'specs:\n  feature:\n    llm_role: assist\n');
 r.git('commit','-am','assist policy');r.git('switch','-c','work/proposed');
 fs.appendFileSync(path.join(r.cwd,'.git/info/exclude'),'\nprivate-actions/\n');
 const observations=new Map<string,ContributionEvent>();let prompts=0;
 const context:CoreContext={checkout:r.cwd,extensionId:p.host.extensionId,compatibility:{manifest:p.manifest,host:p.host},interaction:{confirm:async challenge=>{prompts++;return {challengeId:challenge.challengeId,decision:confirm?'confirm':'decline',interactionId:'human'};}},...(port?{contributions:{observe:async({eventId}:{eventId:string})=>observations.get(eventId)??null}}:{})};
 const prepared=await prepareWorkflow({protocol:1,workflow:'spec-assist',checkout:r.cwd,extensionId:context.extensionId,mode:'attended',selection:{specIds:['base:feature/test'],input:'Finalize text'}},context);
 assert.ok(prepared.ok,JSON.stringify(prepared));if(!prepared.ok)throw Error('prepare');
 const request=prepared.value;
 const file='specs/features/test.md',before=fs.readFileSync(path.join(r.cwd,file),'utf8'),body='# Test\n\nFinalized human-reviewed content.\n';
 const header=before.slice(0,before.length-parseFrontmatter(before).body.length),after=setFinalizedAssistAuthor(header+body);
 const proposal:ContributionProposal={kind:'finalized',edit:{spec:'base:feature/test',body}};
 function event(model='A'):ContributionEvent{const eventId=randomUUID(),evidencePath=`private-actions/${eventId}.md`;r.put(evidencePath,body);return {eventId,requestId:request.requestId,spec:'base:feature/test',role:'revise',source:'runtime',actor:{kind:'model',provider:'observed',model_id:model},action:{kind:'edit',evidencePath,evidenceDigest:sha256(body)},revision:{beforeDigest:sha256(before),afterDigest:sha256(after)}};}
 const result:WorkflowResult={protocol:1,requestId:request.requestId,baseDigest:prepared.value.base.digest,outcome:'blocked',summary:'record finalized content',changes:[],criterionEvidence:prepared.value.criteria.map(c=>({criterionId:c.id,assessment:'uncertain',rationale:'Semantic review remains uncertain',artifacts:[]})),gaps:[],contextExpansion:[],contributionEvents:[],openIssues:'BLOCKED: semantic acceptance remains unverified',nextKnows:'',finalizedEdits:[proposal.edit]};
 return {...r,context,prepared:prepared.value,file,before,after,proposal,event,result,observations,prompts:()=>prompts,close:()=>releaseStoppedPreparation(prepared.value.requestId)};
}
test('independently observed proposed authorship commits only with exact human authorization',async()=>{
 const f=await setup();try{
  for(const model of ['A','B']){const event=f.event(model);f.observations.set(event.eventId,structuredClone(event));const captured=await captureProposedContribution(event,f.proposal,f.context);assert.ok(captured.ok,JSON.stringify(captured));f.result.contributionEvents.push(event);}
  assert.equal(f.prompts(),0);assert.equal(fs.readFileSync(path.join(f.cwd,f.file),'utf8'),f.before);
  const proposal=await validateWorkflowResult(f.prepared,f.result,f.context);assert.ok(proposal.ok,JSON.stringify(proposal));if(!proposal.ok)return;
  const recorded=await recordWorkflow(proposal.value,f.context);assert.ok(recorded.ok,JSON.stringify(recorded));if(!recorded.ok)return;
  assert.equal(f.prompts(),1);assert.ok(recorded.value.commit);const parsed=parseFrontmatter(fs.readFileSync(path.join(f.cwd,f.file),'utf8'));
  assert.equal(parsed.body,parseFrontmatter(f.after).body);assert.equal(parsed.data.status,'approved');assert.equal(parsed.data.author,'mixed');assert.equal((parsed.data.contributors as unknown[]).length,2);
  const trailers=readTrailerEntries(recorded.value.commit!,f.cwd).filter(([key])=>key==='Specplane-Contribution').map(([,value])=>JSON.parse(value));assert.equal(trailers.length,2);
  assert.ok('limitations' in recorded.value&&!recorded.value.limitations?.some(line=>line.includes('absent body observations')));
  const retry=await recordWorkflow(proposal.value,f.context);assert.ok(retry.ok);assert.equal(f.prompts(),1);
 }finally{f.close();}
});
test('proposed event declarations cannot replace the preparation-bound host observation',async()=>{
 for(const port of [false,true]){const f=await setup(port);try{const event=f.event();const result=await captureProposedContribution(event,f.proposal,{...f.context,contributions:{observe:async()=>event}});assert.equal(result.ok,false);if(!result.ok)assert.equal(result.error.code,port?'INVALID_EVIDENCE':'UNSUPPORTED_CAPABILITY');assert.equal(fs.readFileSync(path.join(f.cwd,f.file),'utf8'),f.before);}finally{f.close();}}
});
test('changed proposed text or evidence refuses without turning confirmation into attribution',async()=>{
 const f=await setup();try{const event=f.event();f.observations.set(event.eventId,event);assert.ok((await captureProposedContribution(event,f.proposal,f.context)).ok);
  f.result.finalizedEdits=[{spec:event.spec,body:'# Different text\n'}];let result=await validateWorkflowResult(f.prepared,f.result,f.context);assert.equal(result.ok,false);
  f.result.finalizedEdits=f.proposal.kind==='finalized'?[f.proposal.edit]:[];f.result.contributionEvents=[event];f.put(event.action.evidencePath,'changed');result=await validateWorkflowResult(f.prepared,f.result,f.context);assert.equal(result.ok,false);assert.equal(f.prompts(),0);assert.equal(fs.readFileSync(path.join(f.cwd,f.file),'utf8'),f.before);
 }finally{f.close();}
});
test('trusted proposed authorship does not authorize a declined body write',async()=>{
 const f=await setup(true,false);try{const event=f.event();f.observations.set(event.eventId,event);assert.ok((await captureProposedContribution(event,f.proposal,f.context)).ok);f.result.contributionEvents=[event];const proposal=await validateWorkflowResult(f.prepared,f.result,f.context);assert.ok(proposal.ok);if(!proposal.ok)return;const result=await recordWorkflow(proposal.value,f.context);assert.equal(result.ok,false);if(!result.ok)assert.equal(result.error.code,'CONFIRMATION_REQUIRED');assert.equal(f.git('rev-parse','HEAD'),f.prepared.base.head);assert.equal(fs.readFileSync(path.join(f.cwd,f.file),'utf8'),f.before);}finally{f.close();}
});
