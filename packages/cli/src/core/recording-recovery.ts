/** Recovery verifies a completed commit; it never reconstructs execution authority. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { lazyValidator } from '../lazy-validator.js';
import { loadConfig } from '../config.js';
import { run } from '../git/exec.js';
import { readTrailerEntries } from '../git/commit.js';
import { planDir } from '../plan/resolve.js';
import { resolveSpecId } from '../spec/resolve.js';
import { listStepFiles, parseStep } from '../plan/parse.js';
import type { StepDoneResult } from '../plan/step-done.js';
import { readContainedFile } from './contained-files.js';
import { checkoutIdentity, recoverHostLease, verifyCompletedHostLease, inspectHostLeaseRecovery, type HostLeaseBinding, type WriterLease } from './writer-leases.js';
import { canonical, sha256 } from './workflow-preparation.js';
import { workflowRequestSchema, recordingProposalSchema } from './schemas.js';
import type { CoreContext, RecordingProposal, Result, WorkflowRequest } from './contracts.js';
import type { RecoveryTransaction } from './pending-recovery.js';
import type { WorkflowRecordingReceipt, ContentWorkflowRecordingReceipt } from './workflow-recording.js';

interface Intent {
 version:1;request:WorkflowRequest;extensionId:string;proposal:RecordingProposal;summary:string;
 upstream?:{remote:string;ref:string;url:string};
 commit:{transaction?:RecoveryTransaction;tree:string;message:string;head:string;branch:string;receipt:Omit<StepDoneResult,'commit'>|Omit<ContentWorkflowRecordingReceipt,'commit'|'publication'|'publicationError'>};
}
interface Recovered {intent:Intent;intentDigest:string;binding:HostLeaseBinding;lease?:WriterLease;receipt:WorkflowRecordingReceipt;released:boolean}
const requests=new Map<string,Recovered>();
const validRequest=lazyValidator(workflowRequestSchema),validProposal=lazyValidator(recordingProposalSchema);
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const objectId=/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
function fail(message:string,code='RECOVERY_REQUIRED'):never{throw Object.assign(new Error(message),{code});}
function error(e:unknown):Result<never>{const code=['LOCKED','RECOVERY_REQUIRED','CANCELLED','INVALID_EVIDENCE','STALE_STATE','UNSUPPORTED_CAPABILITY'].includes((e as any)?.code)?(e as any).code:'RECOVERY_REQUIRED';return {protocol:1,ok:false,error:{code,message:e instanceof Error?e.message:String(e),retryable:code==='LOCKED',details:null},notices:[]};}
function read(cwd:string,requestId:string){
 const identity=checkoutIdentity(cwd),prefix=`specplane-runtime/workflows/${requestId}/`;
 const bytes=readContainedFile(identity.commonDir,`${prefix}recording-intent.json`);
 const binding=JSON.parse(readContainedFile(identity.commonDir,`${prefix}recovery-binding.json`).toString()) as HostLeaseBinding;
 const intent=JSON.parse(bytes.toString()) as Intent;
 if(!intent||intent.version!==1||!validRequest(intent.request)||!validProposal(intent.proposal)||typeof intent.summary!=='string'||!intent.summary||
    intent.request.requestId!==requestId||intent.proposal.requestId!==requestId||
    intent.request.checkout!==cwd||intent.request.extensionId!==intent.extensionId||intent.commit?.head!==intent.request.base.head||
    intent.commit.branch!==intent.request.base.branch||!objectId.test(intent.commit.tree)||typeof intent.commit.message!=='string'||
    !intent.commit.receipt)fail('Malformed or mismatched recording intent.');
 validateReceipt(intent);
 if(!binding||binding.requestId!==requestId||binding.commonDir!==identity.commonDir||!Array.isArray(binding.keys)||
    !binding.keys.some(k=>k.kind==='checkout'&&k.identity===identity.gitDir)||binding.evidenceDigest!==sha256(bytes))fail('Recording intent lacks its retained lease evidence binding.');
 if(intent.upstream&&(!intent.upstream.remote||!intent.upstream.url||intent.upstream.remote==='.'||intent.upstream.ref!==`refs/heads/${intent.request.base.branch}`))fail('Invalid pinned publication destination.');
 return {intent,binding,intentDigest:sha256(bytes)};
}
function validateReceipt(intent:Intent):void{
 const receipt=intent.commit.receipt,request=intent.request;
 if(request.workflow==='plan-step'){
  if(intent.proposal.operation!=='plan.step-done'||!('planId' in receipt)||receipt.planId!==request.scope.planId||receipt.step!==request.scope.step||!['done','blocked','skipped'].includes(receipt.outcome)||typeof receipt.handoff!=='string')fail('Malformed plan recording receipt.');
 }else{
  if(intent.proposal.operation!=='workflow.record'||'planId' in receipt||receipt.requestId!==request.requestId||receipt.workflow!==request.workflow||!['done','blocked'].includes(receipt.outcome)||receipt.summary!==intent.summary||!Array.isArray(receipt.paths)||!receipt.paths.length||receipt.paths.some(p=>typeof p!=='string')||!Array.isArray(receipt.limitations)||receipt.limitations.some(l=>typeof l!=='string'))fail('Malformed content recording receipt.');
  const config=loadConfig(request.checkout).config;
  const selected=request.scope.specIds.map(id=>path.relative(request.checkout,resolveSpecId(id,config,undefined,request.checkout).path).split(path.sep).join('/'));
  if(receipt.creation&&!(receipt.creation.operation==='plan.new'?request.workflow==='plan-create':request.workflow==='spec-assist'||request.workflow==='spec-draft-architecture'))fail('Creation operation differs from prepared workflow.');
  const created=receipt.creation?intent.commit.transaction?.creation?.files??[]:[];
  if(receipt.creation&&(!['spec.new','plan.new'].includes(receipt.creation.operation)||typeof receipt.creation.identity!=='string'||!receipt.creation.identity.trim()||!created.length||created.some(file=>!receipt.paths.includes(file.path)||!intent.commit.transaction?.generated.some(change=>change.path===file.path&&change.before===null))))fail('Malformed creation recovery scope.');
  if(canonical([...receipt.paths].sort())!==canonical([...intent.proposal.paths].sort())||new Set(receipt.paths).size!==receipt.paths.length||receipt.paths.some(file=>!request.scope.allowedEditPaths.includes(file)&&!selected.includes(file)&&!created.some(entry=>entry.path===file)))fail('Content recording paths exceed prepared scope.');
 }
}
function verifyCommit(intent:Intent):string{
 const cwd=intent.request.checkout,git=(...args:string[])=>run('git',args,{cwd}).trim();
 if(git('branch','--show-current')!==intent.commit.branch)fail('Recorded branch changed; reconcile before recovery.');
 const head=git('rev-parse','HEAD');
 if(head===intent.commit.head)fail('No completed recording commit exists; inspect partial state without replaying recording.');
 if(git('rev-list','--parents','-n','1',head)!==`${head} ${intent.commit.head}`||git('rev-parse',`${head}^{tree}`)!==intent.commit.tree)fail('HEAD is not the exact intended recording commit.');
 const raw=run('git',['cat-file','commit',head],{cwd}),message=raw.slice(raw.indexOf('\n\n')+2);
 if(message!==intent.commit.message)fail('Recorded commit message differs from validated intent.');
 const trailers=readTrailerEntries(head,cwd);
 const expected=[['Specplane-Request',intent.request.requestId],['Specplane-Workflow',intent.request.workflow==='plan-step'?'step':intent.request.workflow==='plan-create'?'plan-create':'spec']];
 if('creation' in intent.commit.receipt&&intent.commit.receipt.creation?.operation==='plan.new')expected.push(['Specplane-Plan',intent.commit.receipt.creation.identity]);
 if('planId' in intent.commit.receipt)expected.push(['Specplane-Plan',intent.commit.receipt.planId],['Specplane-Step',String(intent.commit.receipt.step).padStart(2,'0')]);
 for(const [key,value] of expected){
  const values=trailers.filter(([k])=>k===key).map(([,v])=>v);
  if(values.length!==1||values[0]!==value)fail(`Recorded ${key} identity differs from intent.`);
 }
 if(git('status','--porcelain=v1','--untracked-files=all')||fs.existsSync(path.join(checkoutIdentity(cwd).gitDir,'index.lock')))fail('Recorded index/worktree is incomplete or changed; reconcile before recovery.');
 const receipt=intent.commit.receipt;
 if('planId' in receipt){
 const dir=planDir(receipt.planId,loadConfig(cwd).config,cwd);
 const expectedHandoff=path.relative(cwd,path.join(dir,'HANDOFF.md')).split(path.sep).join('/');
 if(receipt.handoff!==expectedHandoff)fail('Recording HANDOFF path differs from configured plan.');
 const step=listStepFiles(dir).map(parseStep).find(s=>s.frontmatter.step===receipt.step);
 if(step?.frontmatter.status!==receipt.outcome||!readContainedFile(cwd,expectedHandoff).toString().includes(intent.summary))fail('Recorded step status or HANDOFF differs from validated intent.');
 }
 return head;
}
function verifyDurable(entry:Recovered,context:CoreContext):void{
 const current=read(entry.intent.request.checkout,entry.intent.request.requestId);
 if(context.extensionId!==entry.intent.extensionId||current.intentDigest!==entry.intentDigest||canonical(current.binding)!==canonical(entry.binding)||verifyCommit(entry.intent)!==entry.receipt.commit)fail('Recovered recording owner, journal or commit changed.');
 if(entry.released)verifyCompletedHostLease(entry.binding);else entry.lease!.assertOwned();
}
function completed(binding:HostLeaseBinding):boolean{
 try{readContainedFile(binding.commonDir,`specplane-runtime/completed-host-${sha256(binding.generation)}.marker`);}
 catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}
 verifyCompletedHostLease(binding);return true;
}
function observePublication(entry:Recovered):void{
 const upstream=entry.intent.upstream;if(!upstream)return;
 try{
  const cwd=entry.intent.request.checkout;
  if(canonical(publicationTarget(cwd,entry.intent.request.base.branch)??null)!==canonical(upstream))fail('Publication destination changed; read-only recovery cannot republish.');
  const observed=run('git',['ls-remote','--refs',upstream.remote,upstream.ref],{cwd}).trim().split(/\s+/);
  if(observed.length!==2||observed[0]!==entry.receipt.commit||observed[1]!==upstream.ref)fail('Remote no longer points to the recovered commit; read-only recovery cannot republish.');
  entry.receipt.publication='published';delete entry.receipt.publicationError;
 }catch(e){entry.receipt.publication='failed';entry.receipt.publicationError=e instanceof Error?e.message:String(e);}
}
function publicationTarget(cwd:string,branch:string){
 const fields=run('git',['for-each-ref','--format=%(upstream:remotename)%00%(upstream:remoteref)',`refs/heads/${branch}`],{cwd}).trim().split('\0');
 if(!fields[0])return undefined;
 const urls=run('git',['remote','get-url','--push','--all',fields[0]],{cwd}).trim().split('\n');
 if(fields[0]==='.'||fields[1]!==`refs/heads/${branch}`||urls.length!==1||!urls[0])fail('Publication destination is ambiguous or changed.');
 return {remote:fields[0],ref:fields[1],url:urls[0]};
}

function recoveredReceipt(intent:Intent,commit:string):WorkflowRecordingReceipt{
 return {...intent.commit.receipt,commit,publication:intent.upstream?'failed':'not-required',limitations:[
  ...('limitations' in intent.commit.receipt?intent.commit.receipt.limitations:[]),
  'Recovery verified the exact historical recording commit.',
  'Private execution evidence was not revalidated or reconstructed during recovery.',
 ]};
}

/** The trusted lifecycle port must independently identify and stop all prior host
 * work for this durable request. Caller JSON and a dead owner never prove stopping.
 */
export async function recoverWorkflowRecording(requestId:string,context:CoreContext):Promise<Result<WorkflowRecordingReceipt>>{
 context={...context};
 try{
  if(!uuid.test(requestId)||!context.checkout||!path.isAbsolute(context.checkout)||!context.extensionId)fail('Recovery requires a request UUID, checkout and extension identity.','INVALID_EVIDENCE');
  const cwd=fs.realpathSync(context.checkout),key=`${checkoutIdentity(cwd).gitDir}:${requestId}`;
  let entry=requests.get(key);
  if(!entry){
   const current=read(cwd,requestId);
   if(current.intent.extensionId!==context.extensionId)fail('Recording belongs to another extension.','STALE_STATE');
   if(completed(current.binding)){
    const commit=verifyCommit(current.intent);
    entry={...current,receipt:recoveredReceipt(current.intent,commit),released:true};
    requests.set(key,entry);
   }else{
   inspectHostLeaseRecovery(current.binding);
   const stop=context.lifecycle?.stopWorkflow?.bind(context.lifecycle);
   if(!stop)fail('Recovery needs trusted proof that all prior host workers stopped.','UNSUPPORTED_CAPABILITY');
   if(context.signal?.aborted)fail('Recovery cancelled before host stopping.','CANCELLED');
   const stopped=await stop({requestId,checkout:cwd});
   if(stopped?.stopped!==true||stopped.recoveryRequired!==false)fail('Host worker stop remains unproved; retained leases preserved.');
   let commit='';
   const lease=recoverHostLease(current.binding,()=>{
    const again=read(cwd,requestId);
    if(again.intentDigest!==current.intentDigest||canonical(again.binding)!==canonical(current.binding))fail('Recording journal changed during host stopping.');
    commit=verifyCommit(current.intent);
   });
   entry={...current,lease,receipt:recoveredReceipt(current.intent,commit),released:false};
   requests.set(key,entry);
   }
  }
  verifyDurable(entry,context);
  if(entry.released)observePublication(entry);
  if(!entry.released&&entry.intent.upstream){
   if(context.signal?.aborted){entry.receipt.publication='cancelled';entry.receipt.publicationError='Recording committed; recovery publication was cancelled.';}
   else{
    try{
     if(canonical(publicationTarget(cwd,entry.intent.request.base.branch)??null)!==canonical(entry.intent.upstream))fail('Publication destination changed; restore or reconcile it before retry.');
     verifyDurable(entry,context);
     run('git',['push',entry.intent.upstream.remote,`${entry.receipt.commit}:${entry.intent.upstream.ref}`],{cwd});
     entry.receipt.publication='published';delete entry.receipt.publicationError;
    }catch(e){entry.receipt.publication='failed';entry.receipt.publicationError=e instanceof Error?e.message:String(e);}
   }
  }
  if(!entry.released&&['published','not-required'].includes(entry.receipt.publication)){
   verifyDurable(entry,context);entry.lease!.releaseStoppedHost();entry.released=true;
  }
  return {protocol:1,ok:true,value:structuredClone(entry.receipt),notices:[]};
 }catch(e){return error(e);}
}
