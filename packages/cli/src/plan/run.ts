import * as path from 'node:path';
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import { run as git } from '../git/exec.js';
import { defaultBranch } from '../git/repo.js';
import type { Config } from '../types.js';
import { sessionIdFor } from './session-identity.js';
import type { SessionAdapter, SessionCapabilities, SessionLimit, SessionRef, SessionRequest, SessionState } from '../core/contracts.js';
import { randomUUID } from 'node:crypto';
import { listStepFiles, parseStep } from './parse.js';
import { planDir } from './resolve.js';
import { planNext, type PlanNext } from './next.js';
import { acquireRunLock, LockRefused, positiveLimit, runGate, type GateResult } from './gate.js';
import { attentionFor, dispatchAlerts, type Attention } from './alerts.js';
export interface RunOptions {
 until?:string; maxSteps?:number|string; maxParallel?:number|string; maxBudgetUsd?:number|string;
 force?:boolean; reason?:string; step?:number|string; dryRun?:boolean; pollMs?:number; timeoutSeconds?:number|string; signal?:AbortSignal;
}
export interface RunResult { plan:string;ok:boolean;code:number;action:string;reason:string;steps:number;sessionId?:string;checkout?:string;commands?:string[][]; reservedBudgetUsd:number }
export interface RunDependencies {
 next?:()=>PlanNext; halfFinished?:(n:PlanNext)=>boolean;
 stateDir?:string; log?:(s:string)=>void; sleep?:(ms:number)=>Promise<void>; now?:()=>number;
}
/** Detect partial commits from matching plan AND step trailers, never from prose or a different plan. */
export function hasStepCommit(n:PlanNext):boolean {
 if(!n.checkout||!n.step||n.step.status!=='pending') return false;
 const history=git('git',['log','--format=%(trailers:key=Specplane-Plan,valueonly)%x00%(trailers:key=Specplane-Step,valueonly)%x1e'],{cwd:n.checkout});
 return history.split('\x1e').some(row=>{const [p,s]=row.trim().split('\0');return p?.trim()===n.plan&&Number(s?.trim())===n.step!.number;});
}
/** Runtime files live in Git's private directory, not in tracked/untracked worktree content. */
export function runtimeDirectory(root:string):string {
 return path.join(git('git',['rev-parse','--path-format=absolute','--git-common-dir'],{cwd:root}).trim(),'specplane-runtime');
}
interface SessionRecord { orchestrationId:string; step:number; requestId:string; nativeSessionId?:string; pid?:number }
const readRecord=(file:string):SessionRecord|null=>{
 if(!fs.existsSync(file))return null;
 const v=JSON.parse(fs.readFileSync(file,'utf8')) as SessionRecord;
 if(typeof v.orchestrationId!=='string'||!Number.isSafeInteger(v.step)||typeof v.requestId!=='string')throw new Error('Malformed session record; inspect the plan runtime directory instead of launching a duplicate.');
 return v;
};
const refOf=(r:SessionRecord):SessionRef=>({orchestrationId:r.orchestrationId,...(r.nativeSessionId?{nativeSessionId:r.nativeSessionId}:{}),...(r.pid?{pid:r.pid}:{})});
/** The adapter must be supplied explicitly by the calling extension; there is no default, discovery or fallback. */
export type ConductorDependencies=RunDependencies&{adapter:SessionAdapter};
/** Run one plan serially. No code path invokes approve, step-done, finish, merge, push, or cleanup. */
export async function runPlan(id:string,config:Config,root:string,opts:RunOptions={},deps:ConductorDependencies):Promise<RunResult>{
 const adapter=deps.adapter;
 if(!adapter||typeof adapter.name!=='string')throw new Error('An extension-supplied session adapter is required; the conductor never selects a host.');
 const maxSteps=positiveLimit(opts.maxSteps??1,'--max-steps');
 const timeout=positiveLimit(opts.timeoutSeconds??900,'--timeout-seconds',false)*1000;
 const pollMs=positiveLimit(opts.pollMs??500,'poll interval');
 if(opts.until!==undefined&&!['step','finish'].includes(opts.until)) throw new Error('--until must be step or finish.');
 if(opts.force&&!opts.reason?.trim()) throw new Error('--force requires a non-empty --reason.');
 const totalBudget=opts.maxBudgetUsd===undefined?config.execution.max_budget_usd:positiveLimit(opts.maxBudgetUsd,'--max-budget-usd',false);
 const stepBudget=totalBudget===null?null:totalBudget/maxSteps;
 const limits:SessionLimit[]=stepBudget===null?[]:[{kind:'usd',amount:stepBudget}];
 const targetStep=opts.step===undefined?undefined:positiveLimit(opts.step,'--step');
 if(opts.force&&targetStep===undefined)throw new Error('--force requires --step to identify the completed step to rerun.');
 if(opts.reason && /[\r\n]/.test(opts.reason))throw new Error('--reason must be one line.');
 if(targetStep!==undefined&&(!opts.force||!opts.reason?.trim()))throw new Error('--step requires --force and --reason for an explicit rerun.');
 const resolve=deps.next??(()=>planNext(id,config,root));
 const next=()=>{
  const n=resolve(); if(targetStep===undefined||!n.checkout)return n;
  if(deps.next)return n;
  const records=listStepFiles(planDir(id,config,n.checkout)).map(file=>({file,fm:parseStep(file).frontmatter}));
  const target=records.find(r=>r.fm.step===targetStep);
  if(!target)throw new Error('Requested rerun step does not exist.');
  if(!['done','skipped'].includes(target.fm.status))throw new Error('--step rerun only selects a completed step; pending work uses normal ordering.');
  return {...n,step:{number:targetStep,title:target.fm.title,status:target.fm.status,file:path.relative(n.checkout,target.file)},action:'spawn_step' as const};
 };
 const log=deps.log??(()=>{}); const sleep=deps.sleep??(ms=>new Promise(r=>setTimeout(r,ms))); const now=deps.now??Date.now;
 const initial=next();
 let steps=0, reservedBudgetUsd=0, sessionId:string|undefined, recovery:string[][]|undefined;
 let last=initial;
 const result=(g:GateResult):RunResult=>({plan:id,ok:g.code===0,code:g.code,action:g.action,reason:g.reason,steps,reservedBudgetUsd,...(sessionId?{sessionId}:{}),...(recovery?{commands:recovery}:{}),...(last.checkout?{checkout:last.checkout}:{})});
 const deny=(code:number,reason:string,action='ask_human'):GateResult=>({allowed:false,code,action,reason});
 const limit=(reason:string)=>deny(4,reason,'limit');
 const initialGate=runGate({next:initial,backend:config.execution.backend,force:opts.force,reason:opts.reason});
 if(!initial.checkout || config.execution.backend !== "worktree") return result(initialGate);
 if(opts.dryRun && !initialGate.allowed) return result(initialGate);
 if(!deps.next && initialGate.allowed){
  const branch=git('git',['branch','--show-current'],{cwd:initial.checkout!}).trim();
  if(branch!==`plan/${id}`||branch===defaultBranch(initial.checkout!)) return result({allowed:false,code:5,action:'ask_human',reason:'Refusing to launch outside the exact isolated plan branch.'});
 }
 /** Probe again before every launch; a failed or insufficient probe never substitutes a host or skips a check. */
 const probe=async(checkout:string,resuming:boolean):Promise<SessionCapabilities>=>{
  const requirements=['launch','observe',`backend:${config.execution.backend}`,...limits.map(l=>`limit:${l.kind}`),...(resuming?['resume']:[])];
  const caps=await adapter.probe({checkout,requirements,signal:opts.signal});
  if(!caps.launch||!caps.observe)throw new Error(`Adapter ${adapter.name} cannot launch and observe sessions.`);
  if(!caps.backends.includes(config.execution.backend))throw new Error(`Adapter ${adapter.name} does not support the ${config.execution.backend} backend.`);
  const unenforced=limits.find(l=>!caps.limitKinds.includes(l.kind));
  if(unenforced)throw new Error(`Adapter ${adapter.name} cannot enforce the requested ${unenforced.kind} limit.`);
  if(resuming&&!caps.resume)throw new Error('Selected adapter cannot resume the interrupted session; inspect it with its recovery instructions.');
  return caps;
 };
 const key=createHash('sha256').update(id).digest('hex');
 const state=deps.stateDir??runtimeDirectory(root);
 const recordFile=path.join(state,`${key}.session.json`);
 if(opts.dryRun) {
  try {
   await probe(initial.checkout!,false);
   const prior=readRecord(recordFile);
   const unfinished=prior?.step===initial.step!.number;
   const obs=unfinished?await adapter.observe(refOf(prior!)):null;
   if(obs?.state==='unknown')return result(deny(5,'A prior session for this step cannot be observed; refusing to infer absence.'));
   const g=runGate({next:initial,backend:config.execution.backend,live:obs?.state==='running',halfFinished:(deps.halfFinished??hasStepCommit)(initial)||obs?.state==='completed',force:opts.force,reason:opts.reason});
   return result(g.allowed?{...g,action:'dry_run',reason:`${g.reason} Dry run: no spawn, lock, or alert.`}:g);
  } catch(e) { return result(deny(5,`Dry-run capability check failed: ${(e as Error).message}`)); }
 }
 let lock:ReturnType<typeof acquireRunLock>;
 try{lock=acquireRunLock(path.join(state,`${key}.lock`),sessionIdFor(id,initial.step?.number??1));}
 catch(e){if(e instanceof LockRefused)return result({allowed:false,code:3,action:'ask_human',reason:e.message});throw e;}
 const alert=(g:GateResult,n:PlanNext)=>{
  const alerts:Attention[]=attentionFor(n);
  if(!alerts.length&&g.code!==0) alerts.push({kind:g.code===4?'limit':g.code===2?'blocked':'failed',detail:g.reason,command:`specplane plan show ${id}`});
  dispatchAlerts({plan:id,checkout:n.checkout!,sessionId:sessionId??'',alerts,cache:path.join(state,`${key}.alerts.json`),config,log,harness:adapter.notify?.bind(adapter)});
 };
 const writePrivate=(file:string,value:unknown)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value),{mode:0o600});};
 try{
  if(lock.reclaimed)log('Reclaimed lock whose owning PID was proven dead.');
  if(!initialGate.allowed){alert(initialGate,initial);return result(initialGate);}
  const started=now();
  const interrupted=()=>opts.signal?.aborted||now()-started>=timeout;
  const interruptedGate=()=>limit('Observation interrupted or timed out; session is left running. Inspect it before restarting.');
  for(;;){
   last=next();
   if(interrupted()){const g=interruptedGate();alert(g,last);return result(g);}
   // A durable record exists from just before every launch; it is how an uncertain launch stays visible.
   let prior=last.step?readRecord(recordFile):null;
   if(prior&&prior.step!==last.step!.number)prior=null;
   let priorState:SessionState|null=null;
   if(prior){
    sessionId=prior.orchestrationId;
    priorState=await adapter.observe(refOf(prior));
    if(priorState.state==='unknown'){const g=deny(5,'A prior session for this step cannot be observed; unknown is a recovery state, not proof of absence. Inspect it before retrying.');recovery=await recoveryOf(prior);alert(g,last);return result(g);}
   }
   const g=runGate({next:last,backend:config.execution.backend,live:priorState?.state==='running',halfFinished:(deps.halfFinished??hasStepCommit)(last)||priorState?.state==='completed',force:opts.force,reason:opts.reason,steps,maxSteps:opts.until==='step'?Math.min(maxSteps,1):maxSteps});
   if(!g.allowed){if(prior)recovery=await recoveryOf(prior);alert(g,last);return result(g);}
   // Clear resolved considerations while holding the lock, before the next session starts.
   dispatchAlerts({plan:id,checkout:last.checkout!,sessionId:sessionId??'',alerts:[],cache:path.join(state,`${key}.alerts.json`),config,log,harness:adapter.notify?.bind(adapter)});
   const resuming=priorState?.state==='failed';
   await probe(last.checkout!,resuming);
   if(!deps.next){
    const branch=git('git',['branch','--show-current'],{cwd:last.checkout!}).trim();
    if(branch!==`plan/${id}`||branch===defaultBranch(last.checkout!))throw new Error('Plan checkout changed branches; refusing to launch.');
    if(git('git',['status','--porcelain'],{cwd:last.checkout!}).trim())throw new Error('Plan checkout is dirty; refusing to launch.');
   }
   const before=last.step!.number;
   const beforeCommit=targetStep!==undefined&&!deps.next?git('git',['rev-parse','HEAD'],{cwd:last.checkout!}).trim():null;
   const orchestrationId=sessionIdFor(id,before); sessionId=orchestrationId;
   const requestId=randomUUID();
   const requestPath=path.join(state,`${key}.workflow-request.json`);
   writePrivate(requestPath,{protocol:1,requestId,workflow:'plan-step',plan:id,step:before,mode:'unattended',...(targetStep!==undefined?{rerun:{step:targetStep,reason:opts.reason}}:{})});
   const request:SessionRequest={requestId,orchestrationId,plan:id,step:before,checkout:last.checkout!,workflowRequestPath:requestPath,mode:'unattended',...(limits.length?{limits}:{}),...(opts.signal?{signal:opts.signal}:{})};
   steps++; reservedBudgetUsd+=stepBudget??0;
   // Persist before launching: an exception or crash after this point leaves the attempt visible and unrepeatable.
   const record:SessionRecord={orchestrationId,step:before,requestId};
   writePrivate(recordFile,record);
   const started0=resuming?await adapter.resume(refOf(prior!),request):await adapter.launch(request);
   if(started0.orchestrationId!==orchestrationId)throw new Error('Adapter returned an unexpected session identity. Inspect launch outcome before retrying.');
   if(started0.state==='failed'||started0.state==='unknown')throw new Error(`Launch outcome is ${started0.state}; no session success is inferred. Inspect it before retrying.`);
   Object.assign(record,{...(started0.nativeSessionId?{nativeSessionId:started0.nativeSessionId}:{}),...(started0.pid?{pid:started0.pid}:{})});
   writePrivate(recordFile,record);
   recovery=await recoveryOf(record);
   log(`step ${String(before).padStart(2,'0')} ${resuming?'resumed':'started'} (${orchestrationId})`);
   for(let current=started0;;){
    if(current.state==='completed')break;
    if(current.state!=='running')throw new Error(`Session ${current.state}; no completion inferred. Inspect it with the recovery instructions before retrying.`);
    if(interrupted()){const gate=interruptedGate();alert(gate,last);return result(gate);}
    await sleep(pollMs);
    if(interrupted()){const gate=interruptedGate();alert(gate,last);return result(gate);}
    current=await adapter.observe(refOf(record));
    if(current.orchestrationId!==orchestrationId)throw new Error('Adapter observed an unexpected session identity. Inspect before retrying.');
   }
   // Completion is accepted only after core verification of the plan state, never on the adapter's word alone.
   const after=next();
   if(targetStep!==undefined){
    if(!deps.next){
     const current=git('git',['rev-parse','HEAD'],{cwd:last.checkout!}).trim();
     const rec=git('git',['log','-1','--format=%(trailers:key=Specplane-Plan,valueonly)%x00%(trailers:key=Specplane-Step,valueonly)%x00%(trailers:key=Specplane-Force-Reason,valueonly)'],{cwd:last.checkout!}).trim().split('\0');
     if(current===beforeCommit||rec[0]?.trim()!==id||Number(rec[1]?.trim())!==targetStep||rec[2]?.trim()!==opts.reason!.trim())throw new Error('Forced session exited without a new matching audited step commit.');
    }
    fs.rmSync(recordFile,{force:true});
    return result({allowed:false,code:4,action:'step_complete',reason:'Requested forced rerun completed; stopped after one session for review.'});
   }
   if((after.step?.number===before&&after.action==='spawn_step')||after.effectiveStatus==='draft'||after.effectiveStatus==='abandoned')throw new Error('Session exited without advancing the step; inspect the work rather than retrying automatically.');
   fs.rmSync(recordFile,{force:true});
   log(`step ${String(before).padStart(2,'0')} done (step status advanced)`);
  }
 }catch(e){const g={allowed:false,code:5,action:'ask_human',reason:(e as Error).message};alert(g,last);return result(g);}
 finally{try{lock.release();}catch(e){log(`Lock release requires inspection: ${(e as Error).message}`);}}
 async function recoveryOf(r:SessionRecord):Promise<string[][]|undefined>{
  try{const rec=await adapter.recovery(refOf(r));return rec.instructions;}catch{return undefined;}
 }
}
/** Run distinct plans with bounded concurrency; duplicate IDs are rejected before any launch. */
export async function runPlans(ids:string[],config:Config,root:string,opts:RunOptions,adapter:SessionAdapter,dependencies:(id:string)=>RunDependencies=()=>({})):Promise<RunResult[]>{
 if(ids.length===0||new Set(ids).size!==ids.length)throw new Error('Pass distinct plan IDs; duplicate plan execution is refused.');
 const concurrency=positiveLimit(opts.maxParallel??config.execution.max_parallel,'--max-parallel');
 const results:RunResult[]=new Array(ids.length); let cursor=0;
 await Promise.all(Array.from({length:Math.min(concurrency,ids.length)},async()=>{for(;;){const i=cursor++;if(i>=ids.length)return;results[i]=await runPlan(ids[i],config,root,opts,{...dependencies(ids[i]),adapter});}}));
 return results;
}
