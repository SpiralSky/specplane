/** Plan result validation and exact-set recording. Prepared state remains authoritative. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { lazyValidator } from '../lazy-validator.js';
import { loadConfig } from '../config.js';
import { run } from '../git/exec.js';
import { stepDone, type StepDoneResult, type GeneratedRecording } from '../plan/step-done.js';
import { validatePlans } from '../plan/validate.js';
import { loadAdrs, validateAdrs } from '../decisions/validate.js';
import { listPlans } from '../plan/resolve.js';
import type { PreparedCreation } from './creation-plans.js';
import type { ContentRecording } from './content-recording.js';
import { planDir } from '../plan/resolve.js';
import { listStepFiles, parseStep } from '../plan/parse.js';
import { parseGaps,parseGapsText } from '../plan/gaps.js';
import { validateRecordingSet, type RecordingSet } from '../plan/recording-set.js';
import { validatedContributions, markContributionsRecorded } from './contribution-capture.js';
import { readContainedFile, withContainedDirectory } from './contained-files.js';
import { resolveSpecId } from '../spec/resolve.js';
import { specValidate } from '../commands/spec.js';
import type { ValidationReport } from '../types.js';
import { createConfirmation } from './confirmation.js';
import { prepareNonPlanRecording } from './non-plan-recording.js';
import type { RecoveryTransaction } from './pending-recovery.js';
import { recordContent } from './content-recording.js';
import { formatMessage } from '../git/commit.js';
import { prepareContributionMetadata } from './contribution-metadata.js';
import { checkoutIdentity } from './writer-leases.js';
import { assertPrepared, canonical, sha256, withPreparedActivity } from './workflow-preparation.js';
import { validateExecutionArtifact, validateStepLevelReceipt, workflowStateDigest } from './workflow-execution.js';
import { computeTier, confirmedLowering, recordLowering, recordVerificationCheck, requirementFor, reviewSatisfied, satisfiedChecks, TIER_RANK, type Tier } from './verification.js';
import { gapEntriesFor, reviewFor } from './verify-review.js';
import { workflowRequestSchema,workflowResultSchema,recordingProposalSchema } from './schemas.js';
import type { CoreContext,RecordingProposal,Result,WorkflowRequest,WorkflowResult,TestReceipt } from './contracts.js';
const requestSchema=lazyValidator(workflowRequestSchema),resultSchema=lazyValidator(workflowResultSchema),proposalSchema=lazyValidator(recordingProposalSchema);
class Refusal extends Error{constructor(readonly code:string,message:string){super(message);}}
function fail(code:string,message:string):never{throw new Refusal(code,message);}
function error(e:unknown):Result<never>{return {protocol:1,ok:false,error:{code:typeof (e as any)?.code==='string'?(e as any).code:'INVALID_EVIDENCE',message:e instanceof Error?e.message:String(e),retryable:(e as any)?.code==='LOCKED',details:(e as any)?.details??null},notices:[]};}
export interface PlanWorkflowRecordingReceipt extends StepDoneResult {publication:'not-required'|'published'|'failed'|'cancelled';publicationError?:string;limitations?:string[]}
export interface ContentWorkflowRecordingReceipt {creation?:{operation:'spec.new'|'plan.new'|'decision.new';identity:string};validation?:ValidationReport;requestId:string;workflow:string;outcome:'done'|'blocked';commit:string|null;publication:'not-required'|'published'|'failed'|'cancelled';publicationError?:string;summary:string;paths:string[];limitations:string[]}
export type WorkflowRecordingReceipt = PlanWorkflowRecordingReceipt | ContentWorkflowRecordingReceipt;
type Prepared=Awaited<ReturnType<typeof assertPrepared>>;
type WorkflowGenerated = {changes:ContentRecording['generated'];trailers:[string,string][];gapLines?:string[]};
interface Validated {state:Prepared;result:WorkflowResult;proposal:RecordingProposal;manifest:RecordingSet;summary:string;generated:WorkflowGenerated;creation?:PreparedCreation;requiresConfirmation:boolean;receipt?:WorkflowRecordingReceipt;recordedState?:string;journalDigest?:string;upstream?:{remote:string;ref:string;url:string}}
const validated=new Map<string,Validated>();
function publicationTarget(cwd:string,branch:string):Validated['upstream']{
 const fields=run('git',['for-each-ref','--format=%(upstream:remotename)%00%(upstream:remoteref)',`refs/heads/${branch}`],{cwd}).trim().split('\0');
 if(!fields[0])return undefined;
 if(fields[0]==='.'||fields[1]!==`refs/heads/${branch}`)fail('POLICY_DENIED','Publication requires the same branch on a remote');
 const urls=run('git',['remote','get-url','--push','--all',fields[0]],{cwd}).trim().split('\n');
 if(urls.length!==1||!urls[0])fail('UNSUPPORTED_CAPABILITY','Publication requires exactly one configured push URL');
 return {remote:fields[0],ref:fields[1],url:urls[0]};
}

const bytes=readContainedFile;
function runtime(state:Prepared,create=true):string{
 let current=checkoutIdentity(state.request.checkout).commonDir;
 for(const part of ['specplane-runtime','workflows',state.request.requestId]){current=path.join(current,part);if(create){try{fs.mkdirSync(current,{mode:0o700});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}}const st=fs.lstatSync(current);if(!st.isDirectory()||st.isSymbolicLink())fail('RECOVERY_REQUIRED','Nonregular workflow runtime directory');}
 return current;
}
function privateWrite(state:Prepared,name:string,value:unknown):string{
 const content=canonical(value);
 withContainedDirectory(checkoutIdentity(state.request.checkout).commonDir,`specplane-runtime/workflows/${state.request.requestId}`,true,dir=>dir.writeExclusive(name,content));
 return sha256(content);
}
function exact(state:Prepared,result:WorkflowResult):RecordingSet{
 if(state.request.workflow!=='plan-step')return prepareNonPlanRecording(state,result).manifest;
 const r=state.request,cwd=r.checkout,config=loadConfig(cwd).config,dir=planDir(r.scope.planId!,config,cwd);
 const inside=(file:string,folder:string)=>{const relative=path.relative(path.resolve(cwd,folder),path.resolve(cwd,file));return relative===''||(!relative.startsWith(`..${path.sep}`)&&relative!=='..'&&!path.isAbsolute(relative));};
 const gapFile=path.relative(cwd,path.join(dir,'spec-gaps.md')).split(path.sep).join('/');
 for(const change of result.changes){
  if(config.spec_roots.some(root=>inside(change.path,root.path))||inside(change.path,config.decisions.dir)||(inside(change.path,config.plans.dir)&&change.path!==gapFile))fail('POLICY_DENIED','Plan recording does not authorize spec, decision, or plan lifecycle edits; use dedicated reviewed operations');
 }
 const generated=[path.relative(cwd,path.join(dir,'HANDOFF.md')),...listStepFiles(dir).map(f=>path.relative(cwd,f))];
 const manifest:RecordingSet={protocol:1,head:r.base.head,branch:r.base.branch,changes:structuredClone(result.changes)};
 validateRecordingSet(manifest,cwd,r.scope.planId!,generated,result.changes.map(c=>`${c.path}:${c.purpose}`),result.outcome);
 return manifest;
}
/** The first schema error as a field and a rule, so a caller can correct it. Values are left out. */
function schemaProblem(errors:typeof resultSchema.errors):string{
 const first=errors?.[0];if(!first)return 'the result does not match the schema';
 const extra=typeof first.params.additionalProperty==='string'?` ("${first.params.additionalProperty}")`:'';
 return `${first.instancePath||'result'} ${first.message??'is invalid'}${extra}`;
}
const lowerRefusal=(requested:string,computed:string)=>`requestedTier ${requested} is below the computed tier ${computed}; a session can raise its minimum but only the user can lower it, through a lower-minimum verificationRequest that the user confirms`;
/**
 * Computes the tier from the result's actual edit set, refuses a done result that lacks the minimum checks for it,
 * and returns the single verification line recorded in HANDOFF. Never reads worker text for policy.
 */
async function verificationLine(state:Prepared,result:WorkflowResult,context:CoreContext,digests:string[],confirmed:boolean):Promise<string>{
 const r=state.request,policy=state.verification,settings=policy.verification,config=loadConfig(r.checkout).config;
 const computed=computeTier(result.changes.map(c=>c.path),settings,config.spec_roots);
 const ask=result.verificationRequest,stateNow=workflowStateDigest(r.checkout);
 if(ask){
  if(r.mode==='unattended')fail('INVALID_EVIDENCE',`A ${ask.kind} needs the user, and this request is unattended; end the step blocked and name the missing check in a BLOCKED: open issue`);
  if(!state.confirmContent)fail('INVALID_EVIDENCE',`A ${ask.kind} needs the user's confirmation and no interaction port is available; end the step blocked and name the missing check in a BLOCKED: open issue`);
  if(!ask.reason.trim()||/[\r\n]/.test(ask.reason))fail('INVALID_EVIDENCE','verificationRequest.reason must be a nonblank single line');
 }
 let lowered:Tier|null=null;
 if(result.requestedTier&&TIER_RANK[result.requestedTier]<TIER_RANK[computed]){
  if(ask?.kind!=='lower-minimum')fail('INVALID_EVIDENCE',lowerRefusal(result.requestedTier,computed));
  lowered=result.requestedTier;
 }
 if(ask?.kind==='lower-minimum'&&!lowered)fail('INVALID_EVIDENCE',`A lower-minimum request needs requestedTier below the computed tier ${computed}`);
 if(lowered&&confirmed&&confirmedLowering(r.requestId,stateNow)!==lowered)fail('INVALID_EVIDENCE','The lowered minimum was not confirmed by the user');
 const tier=lowered??(result.requestedTier&&TIER_RANK[result.requestedTier]>TIER_RANK[computed]?result.requestedTier:computed);
 const need=requirementFor(policy,tier),runs:string[]=[];
 for(const suiteId of need.suites){const run=await validateStepLevelReceipt(r.requestId,suiteId,context);digests.push(run.artifact.digest);runs.push(`${suiteId} (execution ${run.receipt.executionId}, state ${run.receipt.stateDigest})`);}
 const satisfied=new Set(satisfiedChecks(r.requestId,stateNow));
 // The user's confirmation happens at recording; until then the request stands in for it, and recording re-checks without it.
 if(ask?.kind==='human-check'&&!confirmed)satisfied.add('human');
 if(!reviewSatisfied(need.review,satisfied))fail('INVALID_EVIDENCE',`Missing verification check: ${need.review}${policy.humanRequired?' (the verification settings changed after the plan started; only a human-check meets it)':` (the tier is ${tier})`}`);
 const checker=satisfied.has('human')?'human':satisfied.has('separate')?'separate':'self';
 if(checker==='separate'){
  const review=reviewFor(r.checkout,r.requestId,stateNow);
  if(!review||review.verdict!=='pass')fail('INVALID_EVIDENCE','Missing verification check: the separate check has no passing review artifact for this state');
  digests.push(review.artifactDigest);
 }
 const methods=result.criterionEvidence.map(e=>`${e.criterionId} ${e.artifacts.some(a=>a.kind==='test')?'test':'inspection'} by ${checker}`);
 const suites=settings.mode==='manual'?'none required (mode manual)':tier==='text'?'none required (text-only change)':runs.length?runs.join(', '):'none (no tests configured)';
 const lowering=lowered?` (minimum lowered from ${computed} by the user; reason: ${JSON.stringify(ask!.reason)})`:'';
 return `Verification: ${settings.mode==='manual'?'manual mode, no minimum':`tier ${tier}${lowering}`}; criteria: ${methods.join('; ')}; suites: ${suites}; ${checker==='self'?'self-assessed':`checked by ${checker}`}.`;
}
async function verify(state:Prepared,result:WorkflowResult,context:CoreContext,confirmed=false):Promise<{manifest:RecordingSet;summary:string;evidenceDigest:string;generated:WorkflowGenerated;creation?:PreparedCreation;requiresConfirmation:boolean}>{
 const r=state.request;
 if(result.verificationRequest&&!(r.workflow==='plan-step'&&result.outcome==='done'))fail('INVALID_EVIDENCE','A verificationRequest applies to a done plan-step result only');
 if(result.requestId!==r.requestId||result.baseDigest!==r.base.digest)fail('STALE_STATE','Result does not match prepared identity/base');
 if(result.outcome==='cancelled')fail('CANCELLED','Cancelled workflow preserves edits and does not record');
 if(r.workflow==='plan-step'&&(result.finalizedEdits?.length||result.creation))fail('POLICY_DENIED','Plan results cannot authorize finalized spec edits');
 const nonPlan=r.workflow==='plan-step'?undefined:prepareNonPlanRecording(state,result);
 const events=validatedContributions(state,result.contributionEvents,result.finalizedEdits,result.creation);
 const generated:WorkflowGenerated={changes:nonPlan?.generated??[],trailers:[['Specplane-Request',r.requestId],['Specplane-Agent',state.context.compatibility!.host.host]]};
 for(const spec of [...new Set(events.map(e=>e.spec))].sort()){
  const created=nonPlan?.creation?.operation==='spec.new'&&nonPlan.creation.identity===spec?nonPlan.creation.files[0]:undefined;
  const relative=created?.path??path.relative(r.checkout,resolveSpecId(spec,loadConfig(r.checkout).config,undefined,r.checkout).path).split(path.sep).join('/');
  const existing=generated.changes.find(c=>c.path===relative);
  const before=created?null:bytes(r.checkout,relative).toString(),metadata=prepareContributionMetadata(existing?.after??before!,events.filter(e=>e.spec===spec));
  if(existing)existing.after=metadata.text;else if(metadata.text!==before)generated.changes.push({path:relative,before,after:metadata.text});
  generated.trailers.push(...metadata.trailers.map(value=>['Specplane-Contribution',value] as [string,string]));
 }
 generated.trailers.sort((a,b)=>a[0]===b[0]&&a[0]==='Specplane-Contribution'?(JSON.parse(a[1]).event_id<JSON.parse(b[1]).event_id?-1:1):0);
 if(result.contextExpansion.length)fail('STALE_STATE','Context expansion requires reviewed preparation before recording');
 if(!result.summary.trim()||/[\r\n]/.test(result.summary))fail('INVALID_EVIDENCE','A nonempty single-line commit summary is required');
 if(r.workflow==='plan-step'){
  // The summary becomes the commit subject; refusing here keeps the attempt correctable instead of failing at recording.
  const room=72-`chore(${r.scope.planId!.replace(/^\d{4}-\d{2}-\d{2}-/,'')}): `.length;
  if(result.summary.length>room)fail('INVALID_EVIDENCE',`The summary is ${result.summary.length} characters; keep it to ${room} because it becomes the commit subject`);
 }
 if(result.outcome==='blocked'&&!result.openIssues.split('\n').some(l=>l.startsWith('BLOCKED:')))fail('INVALID_EVIDENCE','Blocked result needs a concrete BLOCKED: open issue');
 const ids=result.criterionEvidence.map(e=>e.criterionId);if(new Set(ids).size!==ids.length||ids.length!==r.criteria.length||r.criteria.some(c=>!ids.includes(c.id)))fail('INVALID_EVIDENCE','Criterion evidence must cover the exact prepared criteria once');
 const manifest=exact(state,result),summary:string[]=[],digests:string[]=[];
 for(const evidence of result.criterionEvidence){
  const criterion=r.criteria.find(c=>c.id===evidence.criterionId)!;
  if(!evidence.rationale.trim())fail('INVALID_EVIDENCE','Criterion rationale is required');
  if(result.outcome==='done'&&evidence.assessment!=='met')fail('INVALID_EVIDENCE','Done requires every criterion met');
  const tests:TestReceipt[]=[];
  for(const artifact of evidence.artifacts){
   if(artifact.kind==='test')tests.push(await validateExecutionArtifact(r.requestId,criterion.id,artifact,context,evidence.assessment==='met'));
   else{
    // A file this result creates or finalises does not hold its proposed text yet: its evidence is the digest of that text (the whole file, or the body the caller supplied).
    const proposed=nonPlan?generated.changes.find(c=>c.path===artifact.path):undefined;
    if(proposed){if(artifact.digest!==sha256(proposed.after)&&artifact.digest!==sha256(proposed.after.slice(proposed.after.indexOf('\n---\n',4)+5)))fail('INVALID_EVIDENCE',`File evidence for ${artifact.path} must carry the SHA-256 of the proposed content that the user will confirm`);}
    else{
     let current:Buffer;
     try{current=bytes(r.checkout,artifact.path);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')fail('INVALID_EVIDENCE',`File evidence ${artifact.path} does not exist; only a file this result creates or finalises may be cited before it is written`);throw e;}
     if(sha256(current)!==artifact.digest)fail('INVALID_EVIDENCE','File evidence changed');
    }
   }
   digests.push(artifact.digest);
  }
  if(evidence.assessment==='met'&&criterion.testRequirements.length&&!tests.length)fail('INVALID_EVIDENCE','Met test criterion requires core execution evidence');
  // Content that needs the human's confirmation is shown to them exactly, so that confirmation stands in for file evidence.
  if(evidence.assessment==='met'&&!criterion.testRequirements.length&&!nonPlan?.requiresConfirmation&&!evidence.artifacts.some(a=>a.kind==='file'))fail('INVALID_EVIDENCE','Met inspection criterion requires file evidence');
  summary.push(`Criterion ${criterion.id}: ${evidence.assessment}${state.uncertainCriteria.includes(criterion.id)&&evidence.assessment==='met'?' (self-assessed; no reviewed mapping)':''}. ${evidence.rationale}`);
  for(const receipt of tests){const artifact=evidence.artifacts.find(a=>a.kind==='test'&&a.path===`${receipt.executionId}.json`)!;summary.push(`Local execution evidence ${receipt.executionId}, receipt SHA-256 ${artifact.digest}; command ${JSON.stringify([receipt.executable,...receipt.args])}; tested state ${receipt.stateDigest}; exit ${receipt.exitCode}, signal ${receipt.signal}.`);for(const s of receipt.assertions)summary.push(`Suite ${JSON.stringify(s.suiteId)}: executed ${s.executed}, failed ${s.failed}, skipped ${s.skipped}.`);}
 }
 if(r.workflow==='plan-step'){
 const config=loadConfig(r.checkout).config,dir=planDir(r.scope.planId!,config,r.checkout);
 const gapFile=path.join(dir,'spec-gaps.md'),gapRelative=path.relative(r.checkout,gapFile).split(path.sep).join('/'),gapChange=result.changes.find(c=>c.path===gapRelative);
 if(result.gaps.length||gapChange){
  const parsed=parseGaps(gapFile);if(parsed.problems.length)fail('INVALID_EVIDENCE','Malformed six-field gap record');
  const before=gapChange?.beforeDigest==='missing'?[]:parseGapsText(run('git',['show',`${r.base.head}:${gapRelative}`],{cwd:r.checkout})).entries;
  const added=parsed.entries.filter(e=>!before.some(b=>b.n===e.n)).map(e=>`G${e.n}`).sort();
  const claimed=result.gaps.map(id=>/^G?[1-9][0-9]*$/i.test(id)?`G${Number(id.replace(/^G/i,''))}`:fail('INVALID_EVIDENCE','Invalid gap ID')).sort();
  if(canonical(added)!==canonical(claimed))fail('INVALID_EVIDENCE','Result gaps must exactly name new gap entries');
 }
 // Findings of a separate review of this exact state become numbered gaps, written by core at recording, after the checks.
 let review:ReturnType<typeof reviewFor>=null;
 try{review=reviewFor(r.checkout,r.requestId,workflowStateDigest(r.checkout));}catch(e){if(result.outcome==='done')throw e;}
 if(review?.findings.length){
  const exists=fs.existsSync(gapFile),text=exists?fs.readFileSync(gapFile,'utf8'):null,parsed=exists?parseGaps(gapFile):{entries:[],problems:[]};
  if(parsed.problems.length)fail('INVALID_EVIDENCE','Malformed six-field gap record');
  const first=Math.max(0,...parsed.entries.map(e=>e.n))+1;
  const entries=gapEntriesFor(review.findings,first,r.scope.step!,r.scope.specIds[0]??'',review.verdict);
  generated.changes.push({path:gapRelative,before:text,after:`${text===null?`# Spec gaps — ${r.scope.planId}\n\n`:text.replace(/\s*$/,'\n\n')}${entries.text}`});
  generated.gapLines=entries.lines;
  summary.push(`Separate review (session ${review.reviewerSession}, claimed independent of the worker): ${review.verdict}; findings recorded as ${entries.numbers.map(n=>`G${n}`).join(', ')}.`);
 }

 }
 if(r.workflow==='plan-step'&&result.outcome==='done'){
  summary.unshift(await verificationLine(state,result,context,digests,confirmed));
 }else if(r.workflow==='plan-step'){
  const config=loadConfig(r.checkout).config,computed=computeTier(result.changes.map(c=>c.path),state.verification.verification,config.spec_roots);
  if(result.requestedTier&&TIER_RANK[result.requestedTier]<TIER_RANK[computed])fail('INVALID_EVIDENCE',lowerRefusal(result.requestedTier,computed));
 }
 summary.push('Receipt files are local evidence; another clone cannot independently verify absent private receipts.');
 if(result.openIssues.trim())summary.push(`Limitations/open issues: ${result.openIssues}`);
 if(result.nextKnows.trim())summary.push(`Worker notes: ${result.nextKnows}`);
 return {manifest,summary:summary.join('\n'),evidenceDigest:sha256(canonical({digests,events})),generated,creation:nonPlan?.creation,requiresConfirmation:(nonPlan?.requiresConfirmation??false)||!!result.verificationRequest};
}
export async function validateWorkflowResult(prepared:WorkflowRequest,result:WorkflowResult,context:CoreContext):Promise<Result<RecordingProposal>>{
 if(!requestSchema(prepared))return error(new Refusal('INVALID_EVIDENCE','Invalid workflow request'));
 if(!resultSchema(result))return error(new Refusal('INVALID_EVIDENCE',`Invalid workflow result: ${schemaProblem(resultSchema.errors)}`));
 prepared=structuredClone(prepared);result=structuredClone(result);context={...context};
 try{return await withPreparedActivity(prepared.requestId,'validation',async()=>{
  const existing=validated.get(prepared.requestId);
  if(existing?.receipt){
   assertOwner(existing,context);
   if(canonical(prepared)!==canonical(existing.state.request)||canonical(result)!==canonical(existing.result))fail('STALE_STATE','A recorded result cannot be replaced by new validation');
   inspectRecorded(existing);
   return {protocol:1,ok:true,value:structuredClone(existing.proposal),notices:[]} as Result<RecordingProposal>;
  }
  const state=await assertPrepared(prepared.requestId,context);
  if(canonical(prepared)!==canonical(state.request))fail('STALE_STATE','Caller prepared envelope differs from private state');
  const checked=await verify(state,result,context),currentStateDigest=workflowStateDigest(prepared.checkout);
  await assertPrepared(prepared.requestId,context);
  const plan=state.request.workflow==='plan-step';
  const args={id:prepared.scope.planId!,outcome:result.outcome as 'done'|'blocked',summary:result.summary,changed:result.changes.map(c=>`${c.path}:${c.purpose}`),gap:result.gaps,openIssue:result.openIssues?result.openIssues.split('\n'):[],nextKnows:checked.summary,step:prepared.scope.step!,...(state.initiation.workflow==='plan-step'&&state.initiation.selection.force?{force:true,reason:state.initiation.selection.reason}:{}),recordingSet:path.join(runtime(state),'recording-set.json')};
  const proposal:RecordingProposal={protocol:1,requestId:prepared.requestId,resultDigest:sha256(canonical(result)),currentStateDigest,paths:[...new Set([...result.changes.map(c=>c.path),...checked.generated.changes.map(c=>c.path)])].sort(),evidenceDigest:checked.evidenceDigest,requiresConfirmation:checked.requiresConfirmation,...(plan?{operation:'plan.step-done' as const,arguments:args}:{operation:'workflow.record' as const,arguments:{requestId:prepared.requestId}})};
  validated.set(prepared.requestId,{state,result,proposal:structuredClone(proposal),manifest:checked.manifest,summary:checked.summary,generated:checked.generated,creation:checked.creation,requiresConfirmation:checked.requiresConfirmation,upstream:plan||proposal.paths.length?publicationTarget(prepared.checkout,prepared.base.branch):undefined});
  return {protocol:1,ok:true,value:proposal,notices:[]} as Result<RecordingProposal>;
 });}catch(e){return error(e);}
}
function assertOwner(v:Validated,context:CoreContext):void{
 if(!context.checkout||fs.realpathSync(context.checkout)!==v.state.request.checkout||context.extensionId!==v.state.context.extensionId)fail('STALE_STATE','Recording owner changed');v.state.lease.assertOwned();
}
function inspectRecorded(v:Validated):void{
 const cwd=v.state.request.checkout,receipt=v.receipt!;
 if(run('git',['branch','--show-current'],{cwd}).trim()!==v.state.request.base.branch||run('git',['rev-parse','HEAD'],{cwd}).trim()!==(receipt.commit??v.state.request.base.head)||workflowStateDigest(cwd)!==v.recordedState)fail('RECOVERY_REQUIRED','Recorded HEAD/index/worktree changed; reconcile before retry');
 if('planId' in receipt){
 const body=run('git',['show','-s','--format=%B',receipt.commit],{cwd});
 for(const trailer of [`Specplane-Workflow: step`,`Specplane-Plan: ${receipt.planId}`,`Specplane-Step: ${String(receipt.step).padStart(2,'0')}`])if(!body.split('\n').includes(trailer))fail('RECOVERY_REQUIRED','Recorded commit identity changed');
 const dir=planDir(receipt.planId,loadConfig(cwd).config,cwd),step=listStepFiles(dir).map(parseStep).find(s=>s.frontmatter.step===receipt.step);
 if(step?.frontmatter.status!==receipt.outcome||!fs.readFileSync(path.join(cwd,receipt.handoff),'utf8').includes(v.summary))fail('RECOVERY_REQUIRED','Recorded progress does not match receipt');
 }
 if(sha256(bytes(runtime(v.state,false),'recorded.json'))!==v.journalDigest)fail('RECOVERY_REQUIRED','Recording journal changed');
 const unavailable:string[]=[];
 for(const artifact of v.result.criterionEvidence.flatMap(e=>e.artifacts).filter(a=>a.kind==='test')){
  try{
   const evidenceRoot=runtime(v.state,false),raw=bytes(evidenceRoot,`evidence/${artifact.path}`);
   if(sha256(raw)!==artifact.digest)throw new Error('receipt changed');
   const receipt=JSON.parse(raw.toString()) as TestReceipt;
   for(const output of [receipt.stdout,receipt.stderr])if(sha256(bytes(evidenceRoot,`evidence/${output.path}`))!==output.digest)throw new Error('output changed');
  }catch{unavailable.push(`Private execution evidence ${artifact.path} is unavailable or changed; the recorded commit is historical validation, not fresh execution verification.`);}
 }
 const prior=receipt.limitations??[];
 receipt.limitations=[...prior.filter(text=>!text.startsWith('Private execution evidence ')),...unavailable];
}
/** Internal lifecycle inspection: never publish or trust a caller-supplied receipt. */
export function inspectWorkflowRecording(requestId:string,context:CoreContext):WorkflowRecordingReceipt|null{
 const v=validated.get(requestId);
 if(!v)return null;
 if(v.state.leaseReleased){
  if(!context.checkout||fs.realpathSync(context.checkout)!==v.state.request.checkout||context.extensionId!==v.state.context.extensionId)fail('STALE_STATE','Recording owner changed');
 }else assertOwner(v,context);
 if(!v.receipt){
  const cwd=v.state.request.checkout;
  if(run('git',['rev-parse','HEAD'],{cwd}).trim()!==v.state.request.base.head || run('git',['branch','--show-current'],{cwd}).trim()!==v.state.request.base.branch)fail('RECOVERY_REQUIRED','HEAD or branch changed without a verified recording receipt; reconcile before release');
  return null;
 }
 try{inspectRecorded(v);}catch(e){
  const message=e instanceof Error?e.message:String(e);
  throw Object.assign(new Refusal('RECOVERY_REQUIRED',`Known commit ${v.receipt.commit} requires reconciliation: ${message}`),{details:{recording:{commit:v.receipt.commit,publication:v.receipt.publication,verified:false}}});
 }
 const receipt=structuredClone(v.receipt);
 if(v.state.context.signal?.aborted && (receipt.publication==='failed'||receipt.publication==='cancelled')){
  receipt.publication='cancelled';receipt.publicationError='Recording committed; publication was cancelled.';
 }
 return receipt;
}
function publish(v:Validated,context:CoreContext):WorkflowRecordingReceipt{
 const receipt=v.receipt!,cwd=v.state.request.checkout;
 if(receipt.publication==='published'||receipt.publication==='not-required')return receipt;
 if(context.signal?.aborted||v.state.context.signal?.aborted){receipt.publication='cancelled';receipt.publicationError='Recording committed; publication was cancelled.';return receipt;}
 try{if(canonical(publicationTarget(cwd,v.state.request.base.branch)??null)!==canonical(v.upstream??null))fail('STALE_STATE','Publication remote changed; restore or reconcile it before retry');run('git',['push',v.upstream!.remote,`${receipt.commit!}:${v.upstream!.ref}`],{cwd});receipt.publication='published';delete receipt.publicationError;}catch(e){receipt.publication='failed';receipt.publicationError=e instanceof Error?e.message:String(e);}return receipt;
}
export async function recordWorkflow(proposal:RecordingProposal,context:CoreContext):Promise<Result<WorkflowRecordingReceipt>>{
 if(!proposalSchema(proposal))return error(new Refusal('INVALID_EVIDENCE','Invalid recording proposal'));
 proposal=structuredClone(proposal);context={...context};
 try{return await withPreparedActivity(proposal.requestId,'recording',async()=>{
  const v=validated.get(proposal.requestId);if(!v||canonical(v.proposal)!==canonical(proposal))fail('STALE_STATE','No matching core-validated proposal');assertOwner(v,context);
  if(v.receipt){inspectRecorded(v);return {protocol:1,ok:true,value:structuredClone(publish(v,context)),notices:[]} as Result<WorkflowRecordingReceipt>;}
  await assertPrepared(proposal.requestId,context);
  if(workflowStateDigest(v.state.request.checkout)!==proposal.currentStateDigest)fail('STALE_STATE','Proposal checkout bytes changed');
  const checked=await verify(v.state,v.result,context);if(checked.evidenceDigest!==proposal.evidenceDigest||checked.summary!==v.summary||canonical(checked.generated)!==canonical(v.generated))fail('STALE_STATE','Proposal evidence changed');
  if(checked.requiresConfirmation){
   if(!v.state.confirmContent)fail('CONFIRMATION_REQUIRED','This result requires the preparation-bound direct-human interaction port');
   const ask=v.result.verificationRequest,finalizing=!!(checked.creation||v.result.finalizedEdits?.length);
   let response:import('./contracts.js').ConfirmationResponse|null=null;
   const signal=AbortSignal.any([v.state.context.signal!,...(context.signal?[context.signal]:[])]);
   const service=createConfirmation({checkout:v.state.request.checkout,extensionId:v.state.context.extensionId,operation:'workflow.record',lease:v.state.lease,
    snapshot:()=>({targets:checked.generated.changes.map(c=>c.path),summary:(ask?`The working session asks for your confirmation (${ask.kind}). Its stated reason, which you accept by confirming:\n${ask.reason}\n${ask.kind==='lower-minimum'?`Requested minimum: ${v.result.requestedTier} instead of the computed tier. Confirming skips the checks above that tier for this step.\n`:'Confirming records that you checked this step yourself, which meets the human check.\n'}This does not approve a spec or change a lifecycle status.\n`:'')+(finalizing?(checked.creation?'Confirm this exact content and the listed new files. Lifecycle approval is a separate operation.\n':'Confirm these exact finalized spec edits. This does not approve a spec or change its lifecycle status.\n')+checked.generated.changes.map(c=>`File: ${c.path}\nBefore:\n${c.before}\nAfter:\n${c.after}`).join('\n'):''),state:workflowStateDigest(v.state.request.checkout),payload:{proposal,result:v.result},evidence:ask?{generated:checked.generated,verificationRequest:ask}:checked.generated}),mutate:()=>{
     if(workflowStateDigest(v.state.request.checkout)!==proposal.currentStateDigest)fail('STALE_STATE','Finalized content state changed');
     // The user's acceptance is the only way these reach core's check state.
     if(ask?.kind==='human-check')recordVerificationCheck(proposal.requestId,'human',proposal.currentStateDigest);
     if(ask?.kind==='lower-minimum')recordLowering(proposal.requestId,v.result.requestedTier!,proposal.currentStateDigest);
    }},
    {signal,clock:v.state.context.clock,interaction:{confirm:async challenge=>{const observed=await v.state.confirmContent!(challenge);response=observed?structuredClone(observed):null;return response;}}});
   const challenge=await service.prepare();await assertPrepared(proposal.requestId,context);
   if(!response)fail('CONFIRMATION_REQUIRED','No trusted response');
   service.confirm(challenge,response,{checkout:v.state.request.checkout,extensionId:v.state.context.extensionId});
  }
  if(context.signal?.aborted||v.state.context.signal?.aborted)fail('CANCELLED','Recording cancelled before mutation');
  const cwd=v.state.request.checkout,config=loadConfig(cwd).config,committing=v.state.request.workflow==='plan-step'||proposal.paths.length>0;
  if(committing&&canonical(publicationTarget(cwd,v.state.request.base.branch)??null)!==canonical(v.upstream??null))fail('STALE_STATE','Publication destination changed after validation');
  const upstream=!!v.upstream;
  if(committing&&config.execution.backend==='external'&&!upstream)fail('UNSUPPORTED_CAPABILITY','External publication without an upstream requires explicit setup before recording');
  const manifestFile=path.join(runtime(v.state),'recording-set.json');
  try{privateWrite(v.state,'recording-set.json',checked.manifest);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;if(sha256(bytes(runtime(v.state),'recording-set.json'))!==sha256(canonical(checked.manifest)))fail('RECOVERY_REQUIRED','Existing recording manifest differs');}
  assertOwner(v,context);await assertPrepared(proposal.requestId,context);
  const finalChecked=await verify(v.state,v.result,context,true);
  if(finalChecked.evidenceDigest!==proposal.evidenceDigest||canonical(finalChecked.generated)!==canonical(checked.generated)||finalChecked.summary!==checked.summary)fail('STALE_STATE','Evidence changed before recording');
  const args=proposal.arguments as Extract<RecordingProposal,{operation:'plan.step-done'}>['arguments'];
  if(committing&&canonical(publicationTarget(cwd,v.state.request.base.branch)??null)!==canonical(v.upstream??null))fail('STALE_STATE','Publication destination changed before recording');
  if(workflowStateDigest(cwd)!==proposal.currentStateDigest)fail('STALE_STATE','Proposal state changed immediately before recording');
  if(context.signal?.aborted||v.state.context.signal?.aborted)fail('CANCELLED','Recording cancelled immediately before mutation');
  const persistIntent=(commit:{tree:string;message:string;head:string;branch:string;transaction:RecoveryTransaction;receipt:Omit<StepDoneResult,'commit'>|Omit<ContentWorkflowRecordingReceipt,'commit'|'publication'>})=>{
   const intent={version:1,request:v.state.request,extensionId:v.state.context.extensionId,proposal:v.proposal,summary:v.summary,...(v.upstream?{upstream:v.upstream}:{}),commit};
   const digest=sha256(canonical(intent));
   try{privateWrite(v.state,'recording-intent.json',intent);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST'||sha256(bytes(runtime(v.state,false),'recording-intent.json'))!==digest)throw e;}
   v.state.lease.bindRecoveryEvidence(digest);
   const binding=v.state.lease.recoveryBinding();
   try{privateWrite(v.state,'recovery-binding.json',binding);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST'||sha256(bytes(runtime(v.state,false),'recovery-binding.json'))!==sha256(canonical(binding)))throw e;}
  };
  const generated=checked.generated;
  let recorded:StepDoneResult|ContentWorkflowRecordingReceipt;
  if(v.state.request.workflow==='plan-step'){
   const gapPath=path.relative(cwd,path.join(planDir(v.state.request.scope.planId!,config,cwd),'spec-gaps.md')).split(path.sep).join('/');
   if(generated.changes.some(c=>c.before===null&&c.path!==gapPath))fail('POLICY_DENIED','Plan recording cannot create generated content files');
   const planGenerated:GeneratedRecording={changes:generated.changes,gapLines:generated.gapLines,trailers:generated.trailers,beforeWrite:persistIntent};
   recorded=stepDone(args.id,{...args,recordingSet:manifestFile},config,cwd,v.state.lease,checked.manifest,planGenerated);
  }
  else {
   const paths=[...new Set([...checked.manifest.changes.map(c=>c.path),...generated.changes.map(c=>c.path)])].sort();
   let commit:string|null=null;
   const contentReceipt:Omit<ContentWorkflowRecordingReceipt,'commit'|'publication'>={...(checked.creation?{creation:{operation:checked.creation.operation,identity:checked.creation.identity}}:{}),requestId:proposal.requestId,workflow:v.state.request.workflow,outcome:v.result.outcome as 'done'|'blocked',summary:checked.summary,paths,limitations:['Private receipts remain local to this clone.',...(checked.creation?.operation==='spec.new'&&!v.result.contributionEvents.some(event=>event.spec===checked.creation!.identity&&event.role==='create')?['Creation confirmation does not establish contribution identity; absent body observations remain unrecorded.']:[]),...(v.result.finalizedEdits?.some(edit=>!v.result.contributionEvents.some(event=>event.spec===edit.spec&&event.role==='revise'))?['Finalized text confirmation does not establish contribution identity; absent body observations remain unrecorded.']:[]),...(!paths.length?['Read-only findings; no creation, approval or lifecycle operation was performed.','Read-only recording receipts are process-local; cross-process recovery requires a durable recording intent and is unavailable for these findings.']:[])]};
   if(paths.length){
    const creation=checked.creation,planCreation=creation?.operation==='plan.new';
    const decisionCreation=creation?.operation==='decision.new';
    const message=formatMessage({type:'docs',scope:planCreation?creation.identity.replace(/^\d{4}-\d{2}-\d{2}-/,''):decisionCreation?'decisions':'specs',summary:planCreation?'create plan':decisionCreation?`create ${creation.identity}`:v.result.summary,body:checked.summary,trailers:{'Specplane-Workflow':planCreation?'plan-create':decisionCreation?'decision-new':'spec',...(planCreation?{'Specplane-Plan':creation.identity}:{}),'Specplane-Request':proposal.requestId,'Specplane-Agent':v.state.context.compatibility!.host.host,'Specplane-Contribution':generated.trailers.filter(([key])=>key==='Specplane-Contribution').map(([,value])=>value)}});
    commit=recordContent({manifest:checked.manifest,generated:generated.changes,...(creation?{creation:{files:creation.files.map(({path,scaffold})=>({path,scaffold})),apply:creation.apply}}:{}),message,beforeWrite:intent=>persistIntent({...intent,receipt:contentReceipt}),beforeCommit:()=>{
     if(planCreation)contentReceipt.validation=validatePlans(listPlans(config,cwd),loadAdrs(config,cwd).adrs,config,cwd);
     else if(creation?.operation==='decision.new'){
      const loaded=loadAdrs(config,cwd);
      contentReceipt.validation=validateAdrs(loaded.adrs,config,cwd,loaded.findings);
     }
     else{
      const ids=v.state.request.scope.specIds.filter(id=>paths.includes(path.relative(cwd,resolveSpecId(id,config,undefined,cwd).path).split(path.sep).join('/')));
      if(creation?.operation==='spec.new')ids.push(creation.identity);
      contentReceipt.validation=specValidate(ids,cwd,config);
     }
     if(!contentReceipt.validation.valid)throw Object.assign(new Error('Final content validation failed; inspect the returned findings before recording'),{code:'INVALID_EVIDENCE',details:{validation:contentReceipt.validation}});
    }},cwd,v.state.lease).commit;
   }
   recorded={...contentReceipt,commit,publication:'not-required'};
  }
  if('planId' in recorded)recorded.commit=run('git',['rev-parse','HEAD'],{cwd}).trim();
  if(recorded.commit)markContributionsRecorded(v.state,recorded.commit);
  v.receipt={...recorded,publication:upstream&&recorded.commit?'failed':'not-required'};v.recordedState=workflowStateDigest(cwd);
  try{v.journalDigest=privateWrite(v.state,'recorded.json',{proposalDigest:sha256(canonical(proposal)),receipt:recorded,recordedState:v.recordedState});}catch(e){fail('RECOVERY_REQUIRED',`Commit ${recorded.commit} exists but recording journal failed: ${e instanceof Error?e.message:String(e)}`);}
  return {protocol:1,ok:true,value:structuredClone(publish(v,context)),notices:[]} as Result<WorkflowRecordingReceipt>;
 });}catch(e){return error(e);}
}
