/** Private, preparation-bound capture. Commit integration remains deliberately unavailable. */
import * as path from 'node:path';
import { readContainedFile, withContainedDirectory, type ContainedDirectory } from './contained-files.js';
import { lazyValidator } from '../lazy-validator.js';
import { loadConfig } from '../config.js';
import { resolveSpecId } from '../spec/resolve.js';
import { checkoutIdentity } from './writer-leases.js';
import { assertPrepared, assertPreparedIdentity, canonical, sha256, withPreparedActivity, type PreparedState } from './workflow-preparation.js';
import { validateContribution } from './contributions.js';
import { contributionQuerySchema } from './schemas.js';
import type { ContributionCapture, ContributionEvent, ContributionInspection, ContributionQuery, CoreContext, Result } from './contracts.js';
const queryShape = lazyValidator(contributionQuerySchema);
const ledger = new WeakMap<PreparedState, Map<string, {event: ContributionEvent; digest: string}>>();
function fail(code: string, message: string): never { throw Object.assign(new Error(message), {code}); }
function refusal(e: unknown): Result<never> { return {protocol:1,ok:false,error:{code:(e as any)?.code ?? 'INVALID_EVIDENCE',message:e instanceof Error?e.message:String(e),retryable:(e as any)?.code==='LOCKED',details:null},notices:[]}; }
const regular = readContainedFile;
function directory<T>(state: PreparedState, create: boolean, action: (dir: ContainedDirectory) => T): T {
 return withContainedDirectory(checkoutIdentity(state.request.checkout).commonDir, `specplane-runtime/contributions/${state.request.requestId}`, create, action);
}
function checkAction(state: PreparedState, event: ContributionEvent): void {
 validateContribution(event,()=>true);
 if(event.requestId!==state.request.requestId)fail('STALE_STATE','Contribution request differs from preparation');
 if(event.role!=='review')fail('UNSUPPORTED_CAPABILITY','Contribution capture currently supports performed reviews only; edit/create capture needs body-change authorization');
 if(!state.request.scope.specIds.includes(event.spec))fail('POLICY_DENIED','Contribution spec is not a prepared workflow member');
 const config=loadConfig(state.request.checkout).config,resolved=resolveSpecId(event.spec,config,undefined,state.request.checkout);
 if(event.spec!==`${resolved.root}:${resolved.id}`)fail('INVALID_EVIDENCE','Contribution requires an exact root-qualified spec ID');
 const type=resolved.id.startsWith('feature/')?'feature':'architecture';
 if(event.actor.kind==='model'&&config.specs[type].llm_role==='none')fail('POLICY_DENIED','Spec policy forbids model contribution');
 const relative=path.relative(state.request.checkout,resolved.path).split(path.sep).join('/');
 if(!('reviewedDigest' in event.revision)||sha256(regular(state.request.checkout,relative))!==event.revision.reviewedDigest)fail('INVALID_EVIDENCE','Reviewed spec bytes differ from action observation');
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
  return [...map.values()].map(r=>structuredClone(r.event)).sort((a,b)=>a.eventId.localeCompare(b.eventId));
 } catch(e) { fail('RECOVERY_REQUIRED',`Contribution capture requires reconciliation: ${e instanceof Error?e.message:String(e)}`); }
}
export async function captureContribution(event: ContributionEvent, context: CoreContext): Promise<Result<ContributionCapture>> {
 try {
  validateContribution(event,()=>true);event=structuredClone(event);context={...context};
  return await withPreparedActivity(event.requestId,'validation',async()=>{
   const state=await assertPrepared(event.requestId,context);checkAction(state,event);
   if(!state.captureObservation)fail('UNSUPPORTED_CAPABILITY','Preparation has no trusted per-action contribution capture port');
   const existing=entries(state).find(e=>e.eventId===event.eventId);
   if(existing){if(canonical(existing)!==canonical(event))fail('INVALID_EVIDENCE','Conflicting contribution event ID');return {protocol:1,ok:true,value:{event:existing,status:'pending',recorded:false},notices:[]};}
   const {requestId,eventId,spec,action,revision}=event;
   const observed=await state.captureObservation(structuredClone({requestId,eventId,spec,action,revision}));
   // Copy before any await: the host observation cannot be changed after return.
   const captured=observed===null?null:structuredClone(observed);
   if(!captured||canonical(captured)!==canonical(event))fail('INVALID_EVIDENCE','No matching immutable host action observation');
   await assertPrepared(event.requestId,context);checkAction(state,captured);entries(state);
   const content=canonical(captured);
   try { directory(state,true,dir=>dir.writeExclusive(`${captured.eventId}.json`,content)); }
   catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')fail('RECOVERY_REQUIRED','Unowned existing contribution record requires reconciliation');throw e;}
   const map=ledger.get(state)??new Map();map.set(captured.eventId,{event:structuredClone(captured),digest:sha256(content)});ledger.set(state,map);
   return {protocol:1,ok:true,value:{event:structuredClone(captured),status:'pending',recorded:false},notices:[]};
  });
 }catch(e){return refusal(e);}
}
/** Local pending capture inspection only; no committed-history or cross-process recovery claim. */
export async function readContributions(query: ContributionQuery, context: CoreContext): Promise<Result<ContributionInspection>> {
 try {
  if(!queryShape(query))fail('INVALID_EVIDENCE','Invalid contribution query');
  if(!query.requestId)fail('UNSUPPORTED_CAPABILITY','Pending capture inspection requires a prepared request ID');
  const state=assertPreparedIdentity(query.requestId,context);
  const events=entries(state).filter(e=>!query.spec||e.spec===query.spec);
  return {protocol:1,ok:true,value:{requestId:query.requestId,captures:events.map(event=>({event,status:'pending',recorded:false})),status:events.length?'pending':'unrecorded',limitations:['Local pending observations only; contribution commit integration and cross-process recovery are unavailable.','Inspection verifies journal integrity, not current action/spec bytes; pending capture does not establish committable evidence.']},notices:[]};
 }catch(e){return refusal(e);}
}
/** Never silently discard pending observations when a result omits them. */
export function assertContributionRecordingAvailable(state: PreparedState, events: readonly ContributionEvent[]): void {
 const captured=entries(state);
 for(const event of events){validateContribution(event,()=>true);if(!captured.some(c=>canonical(c)===canonical(event)))fail('INVALID_EVIDENCE','Result contribution lacks matching trusted capture');}
 if(captured.length||events.length)fail('UNSUPPORTED_CAPABILITY','Pending contribution capture cannot record until summaries and event trailers can be committed atomically with the spec');
}
