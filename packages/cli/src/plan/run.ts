import * as path from 'node:path';
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import { run as git } from '../git/exec.js';
import { defaultBranch } from '../git/repo.js';
import type { Config } from '../types.js';
import { createClaudeSessionAdapter, sessionIdFor, stepPrompt, type SessionAdapter } from '../harness/session.js';
import { listStepFiles, parseStep } from './parse.js';
import { planDir } from './resolve.js';
import { planNext, type PlanNext } from './next.js';
import { acquireRunLock, LockRefused, positiveLimit, runGate, type GateResult } from './gate.js';
import { attentionFor, dispatchAlerts, type Attention } from './alerts.js';
export interface RunOptions {
 harness?:string; until?:string; maxSteps?:number|string; maxParallel?:number|string; maxBudgetUsd?:number|string;
 force?:boolean; reason?:string; step?:number|string; dryRun?:boolean; pollMs?:number; timeoutSeconds?:number|string; signal?:AbortSignal;
}
export interface RunResult { plan:string;ok:boolean;code:number;action:string;reason:string;steps:number;sessionId?:string;checkout?:string;commands?:{attach:string;logs:string;stop:string}; reservedBudgetUsd:number }
export interface RunDependencies {
 next?:()=>PlanNext; adapter?:SessionAdapter; halfFinished?:(n:PlanNext)=>boolean;
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
/** Run one plan serially. No code path invokes approve, step-done, finish, merge, push, or cleanup. */
export async function runPlan(id:string,config:Config,root:string,opts:RunOptions={},deps:RunDependencies={}):Promise<RunResult>{
 const maxSteps=positiveLimit(opts.maxSteps??1,'--max-steps');
 const timeout=positiveLimit(opts.timeoutSeconds??900,'--timeout-seconds',false)*1000;
 const pollMs=positiveLimit(opts.pollMs??500,'poll interval');
 if(opts.until!==undefined&&!['step','finish'].includes(opts.until)) throw new Error('--until must be step or finish.');
 if(opts.force&&!opts.reason?.trim()) throw new Error('--force requires a non-empty --reason.');
 const totalBudget=opts.maxBudgetUsd===undefined?config.execution.max_budget_usd:positiveLimit(opts.maxBudgetUsd,'--max-budget-usd',false);
 const stepBudget=totalBudget===null?null:totalBudget/maxSteps;
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
 const selected=opts.harness??(fs.existsSync(path.join(root,'.agents/skills/specplane/SKILL.md'))?'codex':'claude');
 if(!['claude','codex'].includes(selected))throw new Error('Unknown session harness; expected claude or codex.');
 const unsupported=()=>{throw new Error('Codex/Dot integration supports CLI workflows, not a background session adapter. Run the plan step in your existing isolated session; no agent was launched.');};
 const adapter:SessionAdapter=deps.adapter??(selected==='claude'?createClaudeSessionAdapter({root,backend:config.execution.backend}):{name:'codex',supportsBudget:false,checkCapabilities:unsupported,spawn:unsupported,observe:unsupported,commands:()=>({attach:'Use your existing Codex/Dot session',logs:'Use your existing session history',stop:'Stop in your existing session'})});
 const log=deps.log??(()=>{}); const sleep=deps.sleep??(ms=>new Promise(r=>setTimeout(r,ms))); const now=deps.now??Date.now;
 const initial=next();
 let steps=0, reservedBudgetUsd=0, sessionId:string|undefined;
 let last=initial;
 const result=(g:GateResult):RunResult=>({plan:id,ok:g.code===0,code:g.code,action:g.action,reason:g.reason,steps,reservedBudgetUsd,...(sessionId?{sessionId,commands:adapter.commands(sessionId)}:{}),...(last.checkout?{checkout:last.checkout}:{})});
 const initialGate=runGate({next:initial,backend:config.execution.backend,force:opts.force,reason:opts.reason});
 if(!initial.checkout || config.execution.backend !== "worktree") return result(initialGate);
 if(opts.dryRun && !initialGate.allowed) return result(initialGate);
 if(!deps.next && initialGate.allowed){
  const branch=git('git',['branch','--show-current'],{cwd:initial.checkout!}).trim();
  if(branch!==`plan/${id}`||branch===defaultBranch(initial.checkout!)) return result({allowed:false,code:5,action:'ask_human',reason:'Refusing to launch outside the exact isolated plan branch.'});
 }
 if(opts.dryRun) {
  try {
   adapter.checkCapabilities(stepBudget);
   if(stepBudget!==null&&!adapter.supportsBudget)throw new Error('Selected adapter cannot enforce the requested session budget.');
   const live=adapter.observe(sessionIdFor(id,initial.step!.number))==='running';
   const g=runGate({next:initial,backend:config.execution.backend,live,halfFinished:(deps.halfFinished??hasStepCommit)(initial),force:opts.force,reason:opts.reason});
   return result(g.allowed?{...g,action:'dry_run',reason:`${g.reason} Dry run: no spawn, lock, or alert.`}:g);
  } catch(e) { return result({allowed:false,code:5,action:'ask_human',reason:`Dry-run capability check failed: ${(e as Error).message}`}); }
 }
 const key=createHash('sha256').update(id).digest('hex');
 const state=deps.stateDir??runtimeDirectory(root);
 let lock:ReturnType<typeof acquireRunLock>;
 try{lock=acquireRunLock(path.join(state,`${key}.lock`),sessionIdFor(id,initial.step?.number??1));}
 catch(e){if(e instanceof LockRefused)return result({allowed:false,code:3,action:'ask_human',reason:e.message});throw e;}
 const alert=(g:GateResult,n:PlanNext)=>{
  const alerts:Attention[]=attentionFor(n);
  if(!alerts.length&&g.code!==0) alerts.push({kind:g.code===4?'limit':g.code===2?'blocked':'failed',detail:g.reason,command:`specplane plan show ${id}`});
  dispatchAlerts({plan:id,checkout:n.checkout!,sessionId:sessionId??'',alerts,cache:path.join(state,`${key}.alerts.json`),config,log,harness:adapter.notify});
 };
 try{
  if(lock.reclaimed)log('Reclaimed lock whose owning PID was proven dead.');
  if(!initialGate.allowed){alert(initialGate,initial);return result(initialGate);}
  const started=now();
  for(;;){
   last=next();
   if(opts.signal?.aborted||now()-started>=timeout){const g={allowed:false,code:4,action:'limit',reason:'Observation interrupted or timed out; session is left running. Inspect it before restarting.'};alert(g,last);return result(g);}
   let observed:'running'|'done'|'failed'|'missing'='missing';
   if(last.step){ sessionId=sessionIdFor(id,last.step.number); observed=adapter.observe(sessionId); }
   const g=runGate({next:last,backend:config.execution.backend,live:observed==='running',halfFinished:(deps.halfFinished??hasStepCommit)(last),force:opts.force,reason:opts.reason,steps,maxSteps:opts.until==='step'?Math.min(maxSteps,1):maxSteps});
   if(!g.allowed){alert(g,last);return result(g);}
   // Clear resolved considerations while holding the lock, before the next session starts.
   dispatchAlerts({plan:id,checkout:last.checkout!,sessionId:sessionId!,alerts:[],cache:path.join(state,`${key}.alerts.json`),config,log,harness:adapter.notify});
   adapter.checkCapabilities?.(stepBudget);
   if(stepBudget!==null&&!adapter.supportsBudget) throw new Error('Selected adapter cannot enforce the requested session budget.');
   if(!deps.next){
    const branch=git('git',['branch','--show-current'],{cwd:last.checkout!}).trim();
    if(branch!==`plan/${id}`||branch===defaultBranch(last.checkout!))throw new Error('Plan checkout changed branches; refusing to launch.');
    if(git('git',['status','--porcelain'],{cwd:last.checkout!}).trim())throw new Error('Plan checkout is dirty; refusing to launch.');
   }
   const before=last.step!.number;
   const beforeCommit=targetStep!==undefined&&!deps.next?git('git',['rev-parse','HEAD'],{cwd:last.checkout!}).trim():null;
   steps++; reservedBudgetUsd+=stepBudget??0;
   const handle=adapter.spawn({checkout:last.checkout!,name:`specplane/${id}/${before}`,sessionId:sessionId!,prompt:targetStep===undefined?stepPrompt(id):`${stepPrompt(id)} --step ${targetStep} --force --reason ${JSON.stringify(opts.reason!.trim())}`,budgetUsd:stepBudget,resume:observed!=='missing',env:{SPECPLANE_SESSION_MODE:'unattended',...(opts.force?{SPECPLANE_FORCE_REASON:opts.reason!.trim()}:{})}});
   if(handle.sessionId!==sessionId)throw new Error('Adapter returned an unexpected session identity. Inspect launch outcome before retrying.');
   log(`step ${String(before).padStart(2,'0')} started (${sessionId})`);
   for(;;){
    if(opts.signal?.aborted||now()-started>=timeout){const g={allowed:false,code:4,action:'limit',reason:'Observation interrupted or timed out; session is left running. Inspect before restarting.'};alert(g,last);return result(g);}
    const status=adapter.observe(sessionId!);
    if(status==='running'){await sleep(pollMs);continue;}
    if(status!=='done')throw new Error(`Session ${status}; no completion inferred. Inspect logs before retrying.`);
    break;
   }
   const after=next();
   if(targetStep!==undefined){
    if(!deps.next){
     const current=git('git',['rev-parse','HEAD'],{cwd:last.checkout!}).trim();
     const record=git('git',['log','-1','--format=%(trailers:key=Specplane-Plan,valueonly)%x00%(trailers:key=Specplane-Step,valueonly)%x00%(trailers:key=Specplane-Force-Reason,valueonly)'],{cwd:last.checkout!}).trim().split('\0');
     if(current===beforeCommit||record[0]?.trim()!==id||Number(record[1]?.trim())!==targetStep||record[2]?.trim()!==opts.reason!.trim())throw new Error('Forced session exited without a new matching audited step commit.');
    }
    return result({allowed:false,code:4,action:'step_complete',reason:'Requested forced rerun completed; stopped after one session for review.'});
   }
   if((after.step?.number===before&&after.action==='spawn_step')||after.effectiveStatus==='draft'||after.effectiveStatus==='abandoned')throw new Error('Session exited without advancing the step; inspect the work rather than repeating it automatically.');
   log(`step ${String(before).padStart(2,'0')} done (step status advanced)`);
  }
 }catch(e){const g={allowed:false,code:5,action:'ask_human',reason:(e as Error).message};alert(g,last);return result(g);}
 finally{try{lock.release();}catch(e){log(`Lock release requires inspection: ${(e as Error).message}`);}}
}
/** Run distinct plans with bounded concurrency; duplicate IDs are rejected before any launch. */
export async function runPlans(ids:string[],config:Config,root:string,opts:RunOptions={},dependencies:(id:string)=>RunDependencies=()=>({})):Promise<RunResult[]>{
 if(ids.length===0||new Set(ids).size!==ids.length)throw new Error('Pass distinct plan IDs; duplicate plan execution is refused.');
 const concurrency=positiveLimit(opts.maxParallel??config.execution.max_parallel,'--max-parallel');
 const results:RunResult[]=new Array(ids.length); let cursor=0;
 await Promise.all(Array.from({length:Math.min(concurrency,ids.length)},async()=>{for(;;){const i=cursor++;if(i>=ids.length)return;results[i]=await runPlan(ids[i],config,root,opts,dependencies(ids[i]));}}));
 return results;
}
