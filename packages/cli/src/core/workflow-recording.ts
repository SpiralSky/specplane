/** Plan result validation and exact-set recording. Prepared state remains authoritative. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Ajv } from 'ajv';
import { loadConfig } from '../config.js';
import { run } from '../git/exec.js';
import { stepDone, type StepDoneResult } from '../plan/step-done.js';
import { planDir } from '../plan/resolve.js';
import { listStepFiles, parseStep } from '../plan/parse.js';
import { parseGaps,parseGapsText } from '../plan/gaps.js';
import { validateRecordingSet, type RecordingSet } from '../plan/recording-set.js';
import { assertContributionRecordingAvailable } from './contribution-capture.js';
import { checkoutIdentity } from './writer-leases.js';
import { assertPrepared, canonical, sha256, withPreparedActivity } from './workflow-preparation.js';
import { validateExecutionArtifact, workflowStateDigest } from './workflow-execution.js';
import { workflowRequestSchema,workflowResultSchema,recordingProposalSchema } from './schemas.js';
import type { CoreContext,RecordingProposal,Result,WorkflowRequest,WorkflowResult,TestReceipt } from './contracts.js';
const ajv=new Ajv(),requestSchema=ajv.compile(workflowRequestSchema),resultSchema=ajv.compile(workflowResultSchema),proposalSchema=ajv.compile(recordingProposalSchema);
class Refusal extends Error{constructor(readonly code:string,message:string){super(message);}}
function fail(code:string,message:string):never{throw new Refusal(code,message);}
function error(e:unknown):Result<never>{return {protocol:1,ok:false,error:{code:typeof (e as any)?.code==='string'?(e as any).code:'INVALID_EVIDENCE',message:e instanceof Error?e.message:String(e),retryable:(e as any)?.code==='LOCKED',details:null},notices:[]};}
export interface WorkflowRecordingReceipt extends StepDoneResult {publication:'not-required'|'published'|'failed'|'cancelled';publicationError?:string}
type Prepared=Awaited<ReturnType<typeof assertPrepared>>;
interface Validated {state:Prepared;result:WorkflowResult;proposal:RecordingProposal;manifest:RecordingSet;summary:string;receipt?:WorkflowRecordingReceipt;recordedState?:string;journalDigest?:string;upstream?:{remote:string;ref:string;url:string}}
const validated=new Map<string,Validated>();
function publicationTarget(cwd:string,branch:string):Validated['upstream']{
 const fields=run('git',['for-each-ref','--format=%(upstream:remotename)%00%(upstream:remoteref)',`refs/heads/${branch}`],{cwd}).trim().split('\0');
 if(!fields[0])return undefined;
 if(fields[0]==='.'||fields[1]!==`refs/heads/${branch}`)fail('POLICY_DENIED','Publication requires the same plan branch on a remote');
 const urls=run('git',['remote','get-url','--push','--all',fields[0]],{cwd}).trim().split('\n');
 if(urls.length!==1||!urls[0])fail('UNSUPPORTED_CAPABILITY','Publication requires exactly one configured push URL');
 return {remote:fields[0],ref:fields[1],url:urls[0]};
}

function bytes(root:string,relative:string):Buffer{
 if(!relative||path.isAbsolute(relative)||relative.includes('\\')||relative.split('/').some(p=>!p||p==='.'||p==='..'||p==='.git'))fail('INVALID_EVIDENCE','Uncontained evidence path');
 let current=root;for(const [i,part]of relative.split('/').entries()){current=path.join(current,part);const st=fs.lstatSync(current);if(st.isSymbolicLink()||(i===relative.split('/').length-1?!st.isFile()||st.nlink!==1:!st.isDirectory()))fail('INVALID_EVIDENCE','Nonregular evidence path');}return fs.readFileSync(current);
}
function runtime(state:Prepared,create=true):string{
 let current=checkoutIdentity(state.request.checkout).commonDir;
 for(const part of ['specplane-runtime','workflows',state.request.requestId]){current=path.join(current,part);if(create){try{fs.mkdirSync(current,{mode:0o700});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}}const st=fs.lstatSync(current);if(!st.isDirectory()||st.isSymbolicLink())fail('RECOVERY_REQUIRED','Nonregular workflow runtime directory');}
 return current;
}
function privateWrite(state:Prepared,name:string,value:unknown):string{
 const dir=runtime(state),file=path.join(dir,name),content=canonical(value);const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,content);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}return sha256(content);
}
function exact(state:Prepared,result:WorkflowResult):RecordingSet{
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
async function verify(state:Prepared,result:WorkflowResult,context:CoreContext):Promise<{manifest:RecordingSet;summary:string;evidenceDigest:string}>{
 const r=state.request;
 if(result.requestId!==r.requestId||result.baseDigest!==r.base.digest)fail('STALE_STATE','Result does not match prepared identity/base');
 if(result.outcome==='cancelled')fail('CANCELLED','Cancelled workflow preserves edits and does not record');
 assertContributionRecordingAvailable(state,result.contributionEvents);
 if(result.contextExpansion.length)fail('STALE_STATE','Context expansion requires reviewed preparation before recording');
 if(!result.summary.trim()||/[\r\n]/.test(result.summary))fail('INVALID_EVIDENCE','A nonempty single-line commit summary is required');
 if(result.outcome==='blocked'&&!result.openIssues.split('\n').some(l=>l.startsWith('BLOCKED:')))fail('INVALID_EVIDENCE','Blocked result needs a concrete BLOCKED: open issue');
 const ids=result.criterionEvidence.map(e=>e.criterionId);if(new Set(ids).size!==ids.length||ids.length!==r.criteria.length||r.criteria.some(c=>!ids.includes(c.id)))fail('INVALID_EVIDENCE','Criterion evidence must cover the exact prepared criteria once');
 const manifest=exact(state,result),summary:string[]=[],digests:string[]=[];
 for(const evidence of result.criterionEvidence){
  const criterion=r.criteria.find(c=>c.id===evidence.criterionId)!;
  if(!evidence.rationale.trim())fail('INVALID_EVIDENCE','Criterion rationale is required');
  if(result.outcome==='done'&&evidence.assessment!=='met')fail('INVALID_EVIDENCE','Done requires every criterion met');
  if(evidence.assessment==='met'&&state.uncertainCriteria.includes(criterion.id))fail('INVALID_EVIDENCE','Missing reviewed mapping leaves criterion uncertain');
  const tests:TestReceipt[]=[];
  for(const artifact of evidence.artifacts){
   if(artifact.kind==='test')tests.push(await validateExecutionArtifact(r.requestId,criterion.id,artifact,context,evidence.assessment==='met'));
   else if(sha256(bytes(r.checkout,artifact.path))!==artifact.digest)fail('INVALID_EVIDENCE','File evidence changed');
   digests.push(artifact.digest);
  }
  if(evidence.assessment==='met'&&criterion.testRequirements.length&&!tests.length)fail('INVALID_EVIDENCE','Met test criterion requires core execution evidence');
  if(evidence.assessment==='met'&&!criterion.testRequirements.length&&!evidence.artifacts.some(a=>a.kind==='file'))fail('INVALID_EVIDENCE','Met inspection criterion requires file evidence');
  summary.push(`Criterion ${criterion.id}: ${evidence.assessment}. ${evidence.rationale}`);
  for(const receipt of tests){const artifact=evidence.artifacts.find(a=>a.kind==='test'&&a.path===`${receipt.executionId}.json`)!;summary.push(`Local execution evidence ${receipt.executionId}, receipt SHA-256 ${artifact.digest}; command ${JSON.stringify([receipt.executable,...receipt.args])}; tested state ${receipt.stateDigest}; exit ${receipt.exitCode}, signal ${receipt.signal}.`);for(const s of receipt.assertions)summary.push(`Suite ${JSON.stringify(s.suiteId)}: executed ${s.executed}, failed ${s.failed}, skipped ${s.skipped}.`);}
 }
 const config=loadConfig(r.checkout).config,dir=planDir(r.scope.planId!,config,r.checkout);
 const gapFile=path.join(dir,'spec-gaps.md'),gapRelative=path.relative(r.checkout,gapFile).split(path.sep).join('/'),gapChange=result.changes.find(c=>c.path===gapRelative);
 if(result.gaps.length||gapChange){
  const parsed=parseGaps(gapFile);if(parsed.problems.length)fail('INVALID_EVIDENCE','Malformed six-field gap record');
  const before=gapChange?.beforeDigest==='missing'?[]:parseGapsText(run('git',['show',`${r.base.head}:${gapRelative}`],{cwd:r.checkout})).entries;
  const added=parsed.entries.filter(e=>!before.some(b=>b.n===e.n)).map(e=>`G${e.n}`).sort();
  const claimed=result.gaps.map(id=>/^G?[1-9][0-9]*$/i.test(id)?`G${Number(id.replace(/^G/i,''))}`:fail('INVALID_EVIDENCE','Invalid gap ID')).sort();
  if(canonical(added)!==canonical(claimed))fail('INVALID_EVIDENCE','Result gaps must exactly name new gap entries');
 }

 summary.push('Receipt files are local evidence; another clone cannot independently verify absent private receipts.');
 if(result.openIssues.trim())summary.push(`Limitations/open issues: ${result.openIssues}`);
 if(result.nextKnows.trim())summary.push(`Worker notes: ${result.nextKnows}`);
 return {manifest,summary:summary.join('\n'),evidenceDigest:sha256(canonical(digests))};
}
export async function validateWorkflowResult(prepared:WorkflowRequest,result:WorkflowResult,context:CoreContext):Promise<Result<RecordingProposal>>{
 if(!requestSchema(prepared)||!resultSchema(result))return error(new Refusal('INVALID_EVIDENCE','Invalid workflow request/result'));
 prepared=structuredClone(prepared);result=structuredClone(result);context={...context};
 try{return await withPreparedActivity(prepared.requestId,'validation',async()=>{
  const state=await assertPrepared(prepared.requestId,context);
  if(canonical(prepared)!==canonical(state.request))fail('STALE_STATE','Caller prepared envelope differs from private state');
  if(state.request.workflow!=='plan-step')fail('UNSUPPORTED_CAPABILITY','Non-plan recording requires its dedicated creation/content operation');
  const checked=await verify(state,result,context),currentStateDigest=workflowStateDigest(prepared.checkout);
  await assertPrepared(prepared.requestId,context);
  const args={id:prepared.scope.planId!,outcome:result.outcome as 'done'|'blocked',summary:result.summary,changed:result.changes.map(c=>`${c.path}:${c.purpose}`),gap:result.gaps,openIssue:result.openIssues?result.openIssues.split('\n'):[],nextKnows:checked.summary,step:prepared.scope.step!,...(state.initiation.workflow==='plan-step'&&state.initiation.selection.force?{force:true,reason:state.initiation.selection.reason}:{}),recordingSet:path.join(runtime(state),'recording-set.json')};
  const proposal:RecordingProposal={protocol:1,requestId:prepared.requestId,resultDigest:sha256(canonical(result)),currentStateDigest,paths:result.changes.map(c=>c.path).sort(),evidenceDigest:checked.evidenceDigest,requiresConfirmation:false,operation:'plan.step-done',arguments:args};
  validated.set(prepared.requestId,{state,result,proposal:structuredClone(proposal),manifest:checked.manifest,summary:checked.summary,upstream:publicationTarget(prepared.checkout,prepared.base.branch)});
  return {protocol:1,ok:true,value:proposal,notices:[]} as Result<RecordingProposal>;
 });}catch(e){return error(e);}
}
function assertOwner(v:Validated,context:CoreContext):void{
 if(!context.checkout||fs.realpathSync(context.checkout)!==v.state.request.checkout||context.extensionId!==v.state.context.extensionId)fail('STALE_STATE','Recording owner changed');v.state.lease.assertOwned();
}
function inspectRecorded(v:Validated):void{
 const cwd=v.state.request.checkout,receipt=v.receipt!;
 if(run('git',['branch','--show-current'],{cwd}).trim()!==v.state.request.base.branch||run('git',['rev-parse','HEAD'],{cwd}).trim()!==receipt.commit||workflowStateDigest(cwd)!==v.recordedState)fail('RECOVERY_REQUIRED','Recorded HEAD/index/worktree changed; reconcile before retry');
 const body=run('git',['show','-s','--format=%B',receipt.commit],{cwd});
 for(const trailer of [`Specplane-Workflow: step`,`Specplane-Plan: ${receipt.planId}`,`Specplane-Step: ${String(receipt.step).padStart(2,'0')}`])if(!body.split('\n').includes(trailer))fail('RECOVERY_REQUIRED','Recorded commit identity changed');
 const dir=planDir(receipt.planId,loadConfig(cwd).config,cwd),step=listStepFiles(dir).map(parseStep).find(s=>s.frontmatter.step===receipt.step);
 if(step?.frontmatter.status!==receipt.outcome||!fs.readFileSync(path.join(cwd,receipt.handoff),'utf8').includes(v.summary))fail('RECOVERY_REQUIRED','Recorded progress does not match receipt');
 if(sha256(bytes(runtime(v.state,false),'recorded.json'))!==v.journalDigest)fail('RECOVERY_REQUIRED','Recording journal changed');
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
 try{if(canonical(publicationTarget(cwd,v.state.request.base.branch)??null)!==canonical(v.upstream??null))fail('STALE_STATE','Publication remote changed; restore or reconcile it before retry');run('git',['push',v.upstream!.remote,`${receipt.commit}:${v.upstream!.ref}`],{cwd});receipt.publication='published';delete receipt.publicationError;}catch(e){receipt.publication='failed';receipt.publicationError=e instanceof Error?e.message:String(e);}return receipt;
}
export async function recordWorkflow(proposal:RecordingProposal,context:CoreContext):Promise<Result<WorkflowRecordingReceipt>>{
 if(!proposalSchema(proposal))return error(new Refusal('INVALID_EVIDENCE','Invalid recording proposal'));
 proposal=structuredClone(proposal);context={...context};
 try{return await withPreparedActivity(proposal.requestId,'recording',async()=>{
  const v=validated.get(proposal.requestId);if(!v||canonical(v.proposal)!==canonical(proposal))fail('STALE_STATE','No matching core-validated proposal');assertOwner(v,context);
  if(v.receipt){inspectRecorded(v);return {protocol:1,ok:true,value:structuredClone(publish(v,context)),notices:[]} as Result<WorkflowRecordingReceipt>;}
  await assertPrepared(proposal.requestId,context);
  if(workflowStateDigest(v.state.request.checkout)!==proposal.currentStateDigest)fail('STALE_STATE','Proposal checkout bytes changed');
  const checked=await verify(v.state,v.result,context);if(checked.evidenceDigest!==proposal.evidenceDigest||checked.summary!==v.summary)fail('STALE_STATE','Proposal evidence changed');
  if(context.signal?.aborted||v.state.context.signal?.aborted)fail('CANCELLED','Recording cancelled before mutation');
  const cwd=v.state.request.checkout,config=loadConfig(cwd).config;
  if(canonical(publicationTarget(cwd,v.state.request.base.branch)??null)!==canonical(v.upstream??null))fail('STALE_STATE','Publication destination changed after validation');
  const upstream=!!v.upstream;
  if(config.execution.backend==='external'&&!upstream)fail('UNSUPPORTED_CAPABILITY','External publication without an upstream requires explicit setup before recording');
  const manifestFile=path.join(runtime(v.state),'recording-set.json');
  try{privateWrite(v.state,'recording-set.json',checked.manifest);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;if(sha256(bytes(runtime(v.state),'recording-set.json'))!==sha256(canonical(checked.manifest)))fail('RECOVERY_REQUIRED','Existing recording manifest differs');}
  assertOwner(v,context);await assertPrepared(proposal.requestId,context);
  const args=proposal.arguments as Extract<RecordingProposal,{operation:'plan.step-done'}>['arguments'];
  if(canonical(publicationTarget(cwd,v.state.request.base.branch)??null)!==canonical(v.upstream??null))fail('STALE_STATE','Publication destination changed before recording');
  if(workflowStateDigest(cwd)!==proposal.currentStateDigest)fail('STALE_STATE','Proposal state changed immediately before recording');
  if(context.signal?.aborted||v.state.context.signal?.aborted)fail('CANCELLED','Recording cancelled immediately before mutation');
  const recorded=stepDone(args.id,{...args,recordingSet:manifestFile},config,cwd,v.state.lease,checked.manifest);
  recorded.commit=run('git',['rev-parse','HEAD'],{cwd}).trim();
  v.receipt={...recorded,publication:upstream?'failed':'not-required'};v.recordedState=workflowStateDigest(cwd);
  try{v.journalDigest=privateWrite(v.state,'recorded.json',{proposalDigest:sha256(canonical(proposal)),receipt:recorded,recordedState:v.recordedState});}catch(e){fail('RECOVERY_REQUIRED',`Commit ${recorded.commit} exists but recording journal failed: ${e instanceof Error?e.message:String(e)}`);}
  return {protocol:1,ok:true,value:structuredClone(publish(v,context)),notices:[]} as Result<WorkflowRecordingReceipt>;
 });}catch(e){return error(e);}
}
