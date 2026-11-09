import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import type { Config, NotificationEvent } from '../types.js';
import type { PlanNext } from './next.js';
export interface Attention { kind: string; detail: string; command: string }
/** Convert resolver attention to a stable, actionable public representation. */
export function attentionFor(next: PlanNext): Attention[] {
 return next.attention.map(a=>({kind:a.kind,detail:a.message,command:a.kind==='finish_ready'?`specplane plan finish ${next.plan}`:a.kind==='restack'?`specplane plan restack ${next.plan}`:`specplane plan show ${next.plan}`}));
}
const eventFor=(kind:string):NotificationEvent=>kind==='blocked'?'blocked':kind==='finish_ready'?'finish_ready':kind==='done'?'done':kind==='failed'?'failed':'consideration';
/**
 * Synchronize the current consideration set. Removed entries are forgotten so a recurrence alerts.
 * Caller holds the plan lock; persistent cache is derived data, never plan progress or approvals.
 */
export function dispatchAlerts(input:{plan:string;checkout:string;sessionId:string;alerts:Attention[];cache:string;config:Config;log:(s:string)=>void;harness?:(s:string)=>void;command?:(cmd:string,env:NodeJS.ProcessEnv)=>void}):void {
 const policy=input.config.execution.notify;
 if(policy.transport==='none') return;
 const entries=input.alerts.filter(a=>policy.on.includes(eventFor(a.kind)));
 const key=(a:Attention)=>createHash('sha256').update(JSON.stringify([input.plan,a.kind,a.detail])).digest('hex');
 let prior:string[]=[];
 try { const raw=JSON.parse(fs.readFileSync(input.cache,'utf8')); if(!Array.isArray(raw)||!raw.every(x=>typeof x==='string'))throw new Error('Invalid alert cache shape'); prior=raw; }
 catch(e) { if((e as NodeJS.ErrnoException).code!=='ENOENT'){input.log('Alert cache unreadable; delivery suppressed until inspected to avoid duplicates.');return;} }
 const delivered=new Set<string>();
 const persist=(keys:string[])=>{
  fs.mkdirSync(path.dirname(input.cache),{recursive:true});
  const tmp=`${input.cache}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp,JSON.stringify(keys),{mode:0o600}); fs.renameSync(tmp,input.cache);
 };
 for(const a of entries){
  const k=key(a); if(policy.dedupe&&(prior.includes(k)||delivered.has(k))){delivered.add(k);continue;}
  const message=`plan ${input.plan}: ${a.detail} Decision/action: ${a.command}`;
  try{
   // Record an attempt before calling a potentially external transport. A crash or nonzero exit
   // cannot prove non-delivery, so do not automatically resend the same consideration.
   if(policy.dedupe){delivered.add(k);persist([...new Set([...prior.filter(x=>entries.some(e=>key(e)===x)),...delivered])]);}
   if(policy.transport==='harness'){
    if(!input.harness) throw new Error('Harness alert transport is unavailable.');
    input.harness(message);
   } else {
    const env={...process.env,SPECPLANE_PLAN:input.plan,SPECPLANE_KIND:a.kind,SPECPLANE_DETAIL:a.detail,SPECPLANE_COMMAND:a.command,SPECPLANE_SESSION:input.sessionId,SPECPLANE_CHECKOUT:input.checkout};
    (input.command??((cmd,env)=>{execFileSync('/bin/sh',['-c',cmd],{cwd:input.checkout,env,timeout:10000,stdio:'ignore'}); }))(policy.command,env);
   }
   delivered.add(k);
  }catch(e){input.log(`Alert delivery failed or uncertain (run continues; no automatic retry): ${(e as Error).message}`);}
 }
 try{persist([...delivered]);
 }catch(e){input.log(`Could not persist alert deduplication: ${(e as Error).message}`);}
}
