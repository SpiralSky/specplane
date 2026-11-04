/** Private, preparation-bound observations; the recorder owns atomic commit integration. */
import * as path from 'node:path';
import { prepareCreation } from './creation-plans.js';
import { prepareNonPlanRecording } from './non-plan-recording.js';
import { inspectCommittedContributions } from './contribution-history.js';
import { readContainedFile, withContainedDirectory, type ContainedDirectory } from './contained-files.js';
import { run } from '../git/exec.js';
import { parseFrontmatter } from '../frontmatter.js';
import { lazyValidator } from '../lazy-validator.js';
import { loadConfig } from '../config.js';
import { resolveSpecId } from '../spec/resolve.js';
import { checkoutIdentity } from './writer-leases.js';
import { assertPrepared, assertPreparedIdentity, canonical, sha256, withPreparedActivity, type PreparedState } from './workflow-preparation.js';
import { validateContribution, deduplicateContributions } from './contributions.js';
import { contributionQuerySchema, contributionProposalSchema } from './schemas.js';
import type { ContributionCapture, ContributionEvent, ContributionInspection, ContributionQuery, CoreContext, Result, ContributionProposal, FinalizedSpecEdit, WorkflowCreation } from './contracts.js';
const queryShape = lazyValidator(contributionQuerySchema),proposalShape=lazyValidator(contributionProposalSchema);
const proposals=new WeakMap<PreparedState,Map<string,ContributionProposal>>();
const bodySnapshots=new WeakMap<PreparedState,Map<string,string>>();
const committed=new WeakMap<PreparedState,string>();
const ledger = new WeakMap<PreparedState, Map<string, {event: ContributionEvent; digest: string}>>();
function fail(code: string, message: string): never { throw Object.assign(new Error(message), {code}); }
function refusal(e: unknown): Result<never> { return {protocol:1,ok:false,error:{code:(e as any)?.code ?? 'INVALID_EVIDENCE',message:e instanceof Error?e.message:String(e),retryable:(e as any)?.code==='LOCKED',details:null},notices:[]}; }
const regular = readContainedFile;
function directory<T>(state: PreparedState, create: boolean, action: (dir: ContainedDirectory) => T): T {
 return withContainedDirectory(checkoutIdentity(state.request.checkout).commonDir, `specplane-runtime/contributions/${state.request.requestId}`, create, action);
}
function checkAction(state: PreparedState, event: ContributionEvent, historical=false): void {
 validateContribution(event,()=>true);
 if(event.requestId!==state.request.requestId)fail('STALE_STATE','Contribution request differs from preparation');
 if(event.role==='create')fail('UNSUPPORTED_CAPABILITY','Creation capture requires a dedicated creation operation');
 if(!state.request.scope.specIds.includes(event.spec))fail('POLICY_DENIED','Contribution spec is not a prepared workflow member');
 const config=loadConfig(state.request.checkout).config,resolved=resolveSpecId(event.spec,config,undefined,state.request.checkout);
 if(event.spec!==`${resolved.root}:${resolved.id}`)fail('INVALID_EVIDENCE','Contribution requires an exact root-qualified spec ID');
 const type=resolved.id.startsWith('feature/')?'feature':'architecture';
 if(event.actor.kind==='model'&&config.specs[type].llm_role==='none')fail('POLICY_DENIED','Spec policy forbids model contribution');
 const relative=path.relative(state.request.checkout,resolved.path).split(path.sep).join('/');
 const content=regular(state.request.checkout,relative),current=sha256(content);
 if(event.role==='review'){
  if(!('reviewedDigest' in event.revision)||(!historical&&current!==event.revision.reviewedDigest))fail('INVALID_EVIDENCE','Reviewed spec bytes differ from action observation');
 }else{
  if(!state.request.scope.allowedEditPaths.includes(relative)||!state.mutableInputs.includes(relative))fail('POLICY_DENIED','Body contribution is not authorized by this preparation');
  if(!('beforeDigest' in event.revision))fail('INVALID_EVIDENCE','Body contribution requires before/after revisions');
  if(!historical){
   const previous=[...(ledger.get(state)?.values()??[])].map(r=>r.event).filter(e=>e.spec===event.spec&&e.role==='revise'&&e.eventId!==event.eventId);
   const known=new Set([state.request.base.inputDigests[relative],...previous.map(e=>'afterDigest' in e.revision?e.revision.afterDigest:'')]);
   if(!known.has(event.revision.beforeDigest)||current!==event.revision.afterDigest)fail('INVALID_EVIDENCE','Body contribution differs from prepared and observed revisions');
   const oldBody=bodySnapshots.get(state)?.get(event.revision.beforeDigest)??(event.revision.beforeDigest===state.request.base.inputDigests[relative]?sha256(parseFrontmatter(run('git',['show',`${state.request.base.head}:${relative}`],{cwd:state.request.checkout})).body):undefined);
   if(!oldBody||oldBody===sha256(parseFrontmatter(content.toString()).body))fail('INVALID_EVIDENCE','Body contribution must change body bytes');
  }
 }
 if(sha256(regular(state.request.checkout,event.action.evidencePath))!==event.action.evidenceDigest)fail('INVALID_EVIDENCE','Contribution action evidence changed');
}
function entries(state: PreparedState): ContributionEvent[] {
 const map=ledger.get(state)??new Map();
 try {
  try {
   directory(state,false,dir=>{
    for(const [id,record] of map)if(sha256(dir.read(`${id}.json`))!==record.digest)fail('RECOVERY_REQUIRED','Contribution journal changed or unavailable');
    const files=dir.list(),expected=[...map.keys()].map(id=>`${id}.json`).sort();
    if(canonical(files)!==canonical(expected))fail('RECOVERY_REQUIRED','Unrecognized contribution journal records require reconciliation');
   });
  } catch(e) {
   if((e as NodeJS.ErrnoException).code==='ENOENT'&&!map.size)return [];
   throw e;
  }
  return [...map.values()].map(r=>structuredClone(r.event)).sort((a,b)=>a.eventId<b.eventId?-1:a.eventId>b.eventId?1:0);
 } catch(e) { fail('RECOVERY_REQUIRED',`Contribution capture requires reconciliation: ${e instanceof Error?e.message:String(e)}`); }
}
function checkProposal(state:PreparedState,event:ContributionEvent,proposal:ContributionProposal):void {
 if(event.requestId!==state.request.requestId||!('beforeDigest' in event.revision))fail('INVALID_EVIDENCE','Proposed contribution must identify this prepared body action');
 if(proposal.kind==='creation'){
  if(proposal.creation.operation!=='spec.new'||event.role!=='create')fail('INVALID_EVIDENCE','Creation provenance requires a dedicated spec creation');
  const creation=prepareCreation(state,proposal.creation);
  if(event.spec!==creation.identity||creation.files.length!==1||event.revision.beforeDigest!=='missing'||event.revision.afterDigest!==sha256(creation.files[0].after))fail('INVALID_EVIDENCE','Creation observation differs from exact absent preimage and proposed file');
 }else{
  if(event.spec!==proposal.edit.spec||event.role!=='revise')fail('INVALID_EVIDENCE','Proposed contribution must identify this finalized body revision');
  const result={protocol:1 as const,requestId:state.request.requestId,baseDigest:state.request.base.digest,outcome:'blocked' as const,summary:'capture proposed content',changes:[],criterionEvidence:[],gaps:[],contextExpansion:[],contributionEvents:[],openIssues:'BLOCKED: text awaits exact confirmation',nextKnows:'',finalizedEdits:[proposal.edit]};
  const generated=prepareNonPlanRecording(state,result).generated;
  if(generated.length!==1||generated[0].before===null||sha256(generated[0].before)!==event.revision.beforeDigest||sha256(generated[0].after)!==event.revision.afterDigest)fail('INVALID_EVIDENCE','Proposed contribution revision differs from exact finalized bytes');
 }
 if(sha256(regular(state.request.checkout,event.action.evidencePath))!==event.action.evidenceDigest)fail('INVALID_EVIDENCE','Proposed action evidence changed');
}
/** Captures the independently observed authoring action; confirmation remains a separate gate. */
export async function captureProposedContribution(event:ContributionEvent,proposal:ContributionProposal,context:CoreContext):Promise<Result<ContributionCapture>>{
 if(!proposalShape(proposal))return refusal(Object.assign(new Error('Invalid proposed contribution payload'),{code:'INVALID_EVIDENCE'}));
 return captureObserved(event,context,structuredClone(proposal));
}
export async function captureContribution(event:ContributionEvent,context:CoreContext):Promise<Result<ContributionCapture>>{
 return captureObserved(event,context);
}
async function captureObserved(event:ContributionEvent,context:CoreContext,proposal?:ContributionProposal):Promise<Result<ContributionCapture>>{
 try {
  validateContribution(event,()=>true);event=structuredClone(event);context={...context};
  return await withPreparedActivity(event.requestId,'validation',async()=>{
   const state=await assertPrepared(event.requestId,context);const check=(candidate:ContributionEvent)=>proposal?checkProposal(state,candidate,proposal):checkAction(state,candidate);check(event);
   if(!state.captureObservation)fail('UNSUPPORTED_CAPABILITY','Preparation has no trusted per-action contribution capture port');
   const existing=entries(state).find(e=>e.eventId===event.eventId);
   if(existing){if(canonical(existing)!==canonical(event)||canonical(proposals.get(state)?.get(event.eventId)??null)!==canonical(proposal??null))fail('INVALID_EVIDENCE','Conflicting contribution event ID');return {protocol:1,ok:true,value:{event:existing,status:'pending',recorded:false},notices:[]};}
   const {requestId,eventId,spec,action,revision}=event;
   const observed=await state.captureObservation(structuredClone({requestId,eventId,spec,action,revision}));
   // Copy before any await: the host observation cannot be changed after return.
   const captured=observed===null?null:structuredClone(observed);
   if(!captured||canonical(captured)!==canonical(event))fail('INVALID_EVIDENCE','No matching immutable host action observation');
   await assertPrepared(event.requestId,context);check(captured);entries(state);
   const content=canonical(captured);
   try { directory(state,true,dir=>dir.writeExclusive(`${captured.eventId}.json`,content)); }
   catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')fail('RECOVERY_REQUIRED','Unowned existing contribution record requires reconciliation');throw e;}
   const map=ledger.get(state)??new Map();map.set(captured.eventId,{event:structuredClone(captured),digest:sha256(content)});ledger.set(state,map);
   if(proposal){const stored=proposals.get(state)??new Map<string,ContributionProposal>();stored.set(captured.eventId,structuredClone(proposal));proposals.set(state,stored);}
   if(!proposal&&'afterDigest' in captured.revision){const resolved=resolveSpecId(captured.spec,loadConfig(state.request.checkout).config,undefined,state.request.checkout);const bodies=bodySnapshots.get(state)??new Map<string,string>();bodies.set(captured.revision.afterDigest,sha256(parseFrontmatter(regular(state.request.checkout,path.relative(state.request.checkout,resolved.path).split(path.sep).join('/')).toString()).body));bodySnapshots.set(state,bodies);}
   return {protocol:1,ok:true,value:{event:structuredClone(captured),status:'pending',recorded:false},notices:[]};
  });
 }catch(e){return refusal(e);}
}
/** Local capture inspection; committed history uses a separate read-only path. */
export async function readContributions(query: ContributionQuery, context: CoreContext): Promise<Result<ContributionInspection>> {
 try {
  if(!queryShape(query))fail('INVALID_EVIDENCE','Invalid contribution query');
  if(!query.requestId){
   if(!context.checkout)fail('INVALID_EVIDENCE','Committed contribution inspection requires a checkout');
   const history=inspectCommittedContributions(context.checkout,query);
   return {protocol:1,ok:true,value:{requestId:null,observedHead:history.head,captures:[],history:history.events,status:history.events.length?'recorded':'unrecorded',limitations:history.limitations},notices:[]};
  }
  const state=assertPreparedIdentity(query.requestId,context);
  const commit=committed.get(state);
  const events=entries(state).filter(e=>!query.spec||e.spec===query.spec);
  return {protocol:1,ok:true,value:{requestId:query.requestId,captures:events.map(event=>commit?{event,status:'recorded' as const,recorded:true as const,commit}:{event,status:'pending' as const,recorded:false as const}),status:events.length?(commit?'recorded':'pending'):'unrecorded',limitations:['Local capture inspection only; private action evidence is not published with event trailers.','Inspection verifies journal integrity, not current action/spec bytes; pending capture does not establish committable evidence.']},notices:[]};
 }catch(e){return refusal(e);}
}
/** Never silently discard pending observations when a result omits them. */
export function assertContributionRecordingAvailable(state: PreparedState, events: readonly ContributionEvent[]): void {
 validatedContributions(state,events);
}

/** Exact, trusted pending set. Call again immediately before generated metadata writes. */
export function validatedContributions(state: PreparedState, events: readonly ContributionEvent[], finalizedEdits:readonly FinalizedSpecEdit[]=[], creation?:WorkflowCreation): ContributionEvent[] {
 const captured=entries(state);
 const unique=deduplicateContributions(events,()=>true);
 if(unique.length){const history=inspectCommittedContributions(state.request.checkout);const ids=new Set(history.events.map(e=>e.event.event_id).filter(Boolean));if(unique.some(e=>ids.has(e.eventId)))fail('RECOVERY_REQUIRED','Contribution event ID is already committed; inspect its existing record rather than recording again');}
 if(canonical(unique)!==canonical(captured))fail('INVALID_EVIDENCE','Result must include the exact trusted pending contribution set');
 for(const event of unique){
  const proposed=proposals.get(state)?.get(event.eventId);
  if(proposed){
   if(proposed.kind==='finalized'&&!finalizedEdits.some(edit=>canonical(edit)===canonical(proposed.edit)))fail('INVALID_EVIDENCE','Proposed observation is not bound to the result finalized text');
   if(proposed.kind==='creation'&&canonical(creation??null)!==canonical(proposed.creation))fail('INVALID_EVIDENCE','Creation observation is not bound to the result operation');
   checkProposal(state,event,proposed);
  }else{
   if(finalizedEdits.some(edit=>edit.spec===event.spec))fail('INVALID_EVIDENCE','Observations of current spec bytes cannot attest to a different finalized body');
   checkAction(state,event,true);
  }
 }
 const performed=unique.filter(event=>!proposals.get(state)?.has(event.eventId));
 for(const spec of new Set(performed.map(e=>e.spec))){
  const resolved=resolveSpecId(spec,loadConfig(state.request.checkout).config,undefined,state.request.checkout),relative=path.relative(state.request.checkout,resolved.path).split(path.sep).join('/');
  const current=sha256(regular(state.request.checkout,relative)),edits=performed.filter(e=>e.spec===spec&&e.role==='revise');
  let revision=state.request.base.inputDigests[relative];const remaining=new Set(edits);
  while(remaining.size){
   const next=[...remaining].filter(e=>'beforeDigest' in e.revision&&e.revision.beforeDigest===revision);
   if(next.length!==1)fail('INVALID_EVIDENCE','Contribution revision chain is incomplete or ambiguous');
   const event=next[0];revision='afterDigest' in event.revision?event.revision.afterDigest:'';remaining.delete(event);
  }
  if(edits.length&&revision!==current)fail('INVALID_EVIDENCE','Final contributed revision differs from current spec bytes');
  for(const event of performed.filter(e=>e.spec===spec&&e.role==='review'))if(!('reviewedDigest' in event.revision)||event.revision.reviewedDigest!==current)fail('INVALID_EVIDENCE','Review does not describe the final spec bytes');
 }
 return unique;
}

/** Called only after the recorder verified the atomic commit. */
export function markContributionsRecorded(state:PreparedState,commit:string):void{committed.set(state,commit);}
