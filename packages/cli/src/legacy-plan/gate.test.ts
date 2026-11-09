import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { acquireRunLock, positiveLimit, runGate } from './gate.js';
import type { PlanNext } from './next.js';
const next = (patch: Partial<PlanNext> = {}): PlanNext => ({ plan:'2026-11-01-test', title:'test', effectiveStatus:'in_progress', step:{number:1,title:'one',status:'pending',file:'steps/01.md'},context:[],checkout:'/repo',blocked:[],openGaps:[],warnings:[],attention:[],action:'spawn_step',reason:'ready',...patch });
test('run gate: safety and human gates cannot be forced', () => {
  for (const [i,code] of [
    [{backend:'external'},5],[{next:next({checkout:null})},5],
    [{next:next({attention:[{kind:'dirty',message:'dirty'}]})},5],
    [{live:true},3],[{halfFinished:true},3],
    [{next:next({attention:[{kind:'gap_decision',message:'review'}]})},2],
    [{next:next({effectiveStatus:'draft',action:'none'})},2],
    [{maxSteps:1,steps:1},4],
  ] as const) assert.equal(runGate(Object.assign({next:next(),backend:'worktree',force:true,reason:'test'},i)).code,code);
});
test('run gate: completion, no-step and force semantics', () => {
 assert.equal(runGate({next:next(),backend:'worktree'}).allowed,true);
 assert.equal(runGate({next:next({step:null,action:'finish'}),backend:'worktree'}).action,'finish_ready');
 const done=next({step:{number:1,title:'one',status:'done',file:'one'}});
 assert.equal(runGate({next:done,backend:'worktree'}).code,3);
 assert.equal(runGate({next:done,backend:'worktree',force:true,reason:'rerun'}).allowed,true);
 assert.equal(runGate({next:done,backend:'worktree',force:true,reason:' '}).code,3);
});
test('limits reject invalid and unbounded values',()=> {
 for(const v of [0,-1,NaN,Infinity,'bad','',1.2]) assert.throws(()=>positiveLimit(v,'limit'));
 assert.equal(positiveLimit('2','limit'),2); assert.equal(positiveLimit(.5,'budget',false),.5);
});
test('locks exclude second conductor, preserve unknown locks and release ownership',()=> {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'specplane-lock-')); const file=path.join(dir,'lock');
 const lock=acquireRunLock(file,'session');
 assert.throws(()=>acquireRunLock(file,'session'),/held/); lock.release();
 fs.writeFileSync(file,'{}'); assert.throws(()=>acquireRunLock(file,'session'),/Malformed/);
 fs.unlinkSync(file); fs.writeFileSync(file+'.guard',''); assert.throws(()=>acquireRunLock(file,'s'),/progress/);
});
test('dead PID lock is reclaimed without leaving guard',()=> {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'specplane-lock-')); const file=path.join(dir,'lock');
 fs.writeFileSync(file,JSON.stringify({pid:2147483647,token:'old',sessionId:'s',startedAt:''}));
 const l=acquireRunLock(file,'s'); assert.equal(l.reclaimed,true); l.release(); assert.equal(fs.existsSync(file),false); assert.equal(fs.existsSync(file+'.guard'),false);
});
