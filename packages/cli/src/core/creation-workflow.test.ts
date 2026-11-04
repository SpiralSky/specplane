import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture,repo} from './workflow-test-fixture.js';
import {prepareWorkflow,captureProposedContribution,validateWorkflowResult,recordWorkflow} from './index.js';
import {assertPreparedIdentity,releaseStoppedPreparation,sha256} from './workflow-preparation.js';
import {prepareCreation} from './creation-plans.js';
import {parseFrontmatter} from '../frontmatter.js';
import {readTrailerEntries} from '../git/commit.js';
import type {CoreContext,ContributionEvent,WorkflowCreation,WorkflowResult} from './contracts.js';

async function setup(workflow:'spec-assist'|'plan-create'|'decision-new'='spec-assist',confirm=true){
 const r=repo(),p=await fixture(workflow);
 r.put('.specplane/config.yaml',fs.readFileSync(path.join(r.cwd,'.specplane/config.yaml'),'utf8')+'specs:\n  feature:\n    llm_role: assist\n');
 r.git('commit','-am','assist policy');r.git('switch','-c','work/creation');
 fs.appendFileSync(path.join(r.cwd,'.git/info/exclude'),'\nprivate-actions/\n');
 const observations=new Map<string,ContributionEvent>();let prompts=0;
 const context:CoreContext={checkout:r.cwd,extensionId:p.host.extensionId,compatibility:{manifest:p.manifest,host:p.host},interaction:{confirm:async challenge=>{prompts++;return {challengeId:challenge.challengeId,decision:confirm?'confirm':'decline',interactionId:'human'};}},contributions:{observe:async({eventId})=>observations.get(eventId)??null}};
 const prepared=await prepareWorkflow({protocol:1,workflow,checkout:r.cwd,extensionId:context.extensionId,mode:'attended',selection:{specIds:['base:feature/test'],input:'Create this finalized content'}},context);
 assert.ok(prepared.ok,JSON.stringify(prepared));if(!prepared.ok)throw Error('prepare');const request=prepared.value;
 const creation:WorkflowCreation=workflow==='spec-assist'?{operation:'spec.new',arguments:{type:'feature',slug:'created',title:'Created'},body:'# Created\n\nHuman-finalized behavior.\n'}:workflow==='plan-create'?{operation:'plan.new',arguments:{id:'2026-11-04-created',title:'Created plan',specs:['base:feature/test']},body:'# Created plan\n\n## Goal\n\nImplement behavior.\n',steps:[{title:'Implement',context:[{spec:'base:feature/test'}],body:'## Goal\n\nImplement behavior.\n\n## Acceptance criteria\n\n- [ ] Works\n'}]}:{operation:'decision.new',arguments:{title:'Described decision'},body:'# Described decision\n\n## Decision\n\nUser-selected approach.\n'};
 const preview=prepareCreation(assertPreparedIdentity(request.requestId,context),creation);
 const result:WorkflowResult={protocol:1,requestId:request.requestId,baseDigest:request.base.digest,outcome:'blocked',summary:'create finalized content',changes:[],criterionEvidence:request.criteria.map(c=>({criterionId:c.id,assessment:'uncertain',rationale:'Semantic acceptance remains uncertain',artifacts:[]})),gaps:[],contextExpansion:[],contributionEvents:[],openIssues:'BLOCKED: semantic acceptance remains unverified',nextKnows:'',creation};
 return {...r,context,request,creation,preview,result,observations,prompts:()=>prompts,close:()=>releaseStoppedPreparation(request.requestId)};
}

test('creation observes absent preimage then confirms, validates and commits exact spec with attribution',async()=>{
 const f=await setup();try{
  const file=f.preview.files[0],eventId=randomUUID(),evidencePath=`private-actions/${eventId}.md`;f.put(evidencePath,f.creation.body);
  const event:ContributionEvent={eventId,requestId:f.request.requestId,spec:f.preview.identity,role:'create',source:'runtime',actor:{kind:'model',provider:'observed',model_id:'A'},action:{kind:'create',evidencePath,evidenceDigest:sha256(f.creation.body)},revision:{beforeDigest:'missing',afterDigest:sha256(file.after)}};
  f.observations.set(eventId,event);
  const capture=await captureProposedContribution(event,{kind:'creation',creation:f.creation},f.context);assert.ok(capture.ok,JSON.stringify(capture));f.result.contributionEvents=[event];
  assert.equal(fs.existsSync(path.join(f.cwd,file.path)),false);assert.equal(f.prompts(),0);
  const proposal=await validateWorkflowResult(f.request,f.result,f.context);assert.ok(proposal.ok,JSON.stringify(proposal));if(!proposal.ok)return;
  const recorded=await recordWorkflow(proposal.value,f.context);assert.ok(recorded.ok,JSON.stringify(recorded));if(!recorded.ok)return;
  assert.equal(f.prompts(),1);assert.ok(recorded.value.commit);assert.ok('validation' in recorded.value&&recorded.value.validation?.valid);
  const spec=parseFrontmatter(fs.readFileSync(path.join(f.cwd,file.path),'utf8'));assert.equal(spec.data.status,'draft');assert.equal(spec.data.author,'mixed');assert.equal(spec.body,f.creation.body);assert.equal((spec.data.contributors as unknown[]).length,1);
  assert.equal(f.git('status','--porcelain'),'');
  const retry=await recordWorkflow(proposal.value,f.context);assert.ok(retry.ok,JSON.stringify(retry));assert.equal(f.prompts(),1);
 }finally{f.close();}
});

test('declined creation leaves no files, commit or scaffolds',async()=>{
 const f=await setup('spec-assist',false);try{const proposal=await validateWorkflowResult(f.request,f.result,f.context);assert.ok(proposal.ok,JSON.stringify(proposal));if(!proposal.ok)return;const recorded=await recordWorkflow(proposal.value,f.context);assert.equal(recorded.ok,false);assert.equal(f.git('rev-parse','HEAD'),f.request.base.head);for(const file of f.preview.files)assert.equal(fs.existsSync(path.join(f.cwd,file.path)),false);}finally{f.close();}
});

test('plan creation records draft plan and pending steps with plan-create identity',async()=>{
 const f=await setup('plan-create');try{const proposal=await validateWorkflowResult(f.request,f.result,f.context);assert.ok(proposal.ok,JSON.stringify(proposal));if(!proposal.ok)return;const recorded=await recordWorkflow(proposal.value,f.context);assert.ok(recorded.ok,JSON.stringify(recorded));if(!recorded.ok)return;assert.ok(recorded.value.commit);assert.equal(f.git('show','-s','--format=%s',recorded.value.commit!),'docs(created): create plan');const trailers=readTrailerEntries(recorded.value.commit!,f.cwd);assert.ok(trailers.some(([key,value])=>key==='Specplane-Agent'&&value==='codex'));assert.ok(trailers.some(([key,value])=>key==='Specplane-Workflow'&&value==='plan-create'));assert.ok(trailers.some(([key,value])=>key==='Specplane-Plan'&&value===f.preview.identity));for(const file of f.preview.files.filter(file=>file.path.endsWith('.md'))){const parsed=parseFrontmatter(fs.readFileSync(path.join(f.cwd,file.path),'utf8'));assert.equal(parsed.data.status,file.path.endsWith('/PLAN.md')?'draft':'pending');}assert.equal(fs.existsSync(path.join(f.cwd,`plans/${f.preview.identity}/HANDOFF.md`)),false);}finally{f.close();}
});

test('ADR recording refuses the missing commit contract before prompting or creating',async()=>{
 const f=await setup('decision-new');try{const proposal=await validateWorkflowResult(f.request,f.result,f.context);assert.equal(proposal.ok,false);if(!proposal.ok)assert.equal(proposal.error.code,'UNSUPPORTED_CAPABILITY');assert.equal(f.prompts(),0);for(const file of f.preview.files)assert.equal(fs.existsSync(path.join(f.cwd,file.path)),false);}finally{f.close();}
});

test('creation capture rejects empty-file digests, wrong identities and changed proposed text',async()=>{
 const f=await setup();try{
  const eventId=randomUUID(),evidencePath=`private-actions/${eventId}.md`;f.put(evidencePath,f.creation.body);
  const event:ContributionEvent={eventId,requestId:f.request.requestId,spec:f.preview.identity,role:'create',source:'runtime',actor:{kind:'model'},action:{kind:'create',evidencePath,evidenceDigest:sha256(f.creation.body)},revision:{beforeDigest:'missing',afterDigest:sha256(f.preview.files[0].after)}};
  f.observations.set(eventId,event);
  for(const invalid of [{...event,revision:{beforeDigest:sha256(''),afterDigest:sha256(f.preview.files[0].after)}},{...event,spec:'base:feature/other'}]){
   const captured=await captureProposedContribution(invalid,{kind:'creation',creation:f.creation},f.context);assert.equal(captured.ok,false);
  }
  assert.ok((await captureProposedContribution(event,{kind:'creation',creation:f.creation},f.context)).ok);
  f.result.contributionEvents=[event];f.result.creation={...f.creation,body:'# Different proposal\n'};
  const proposal=await validateWorkflowResult(f.request,f.result,f.context);assert.equal(proposal.ok,false);assert.equal(f.prompts(),0);assert.equal(fs.existsSync(path.join(f.cwd,f.preview.files[0].path)),false);
 }finally{f.close();}
});
