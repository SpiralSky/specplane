import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { makeRepo } from '../test-repo.js';
import { run } from '../git/exec.js';
import { validateRecordingSet, readRecordingSet, type RecordingSet } from './recording-set.js';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
function fixture() {
 const root=makeRepo({'a.txt':'before\n','b.txt':'other\n'}); const git=(...args:string[])=>run('git',args,{cwd:root}).trim();
 git('init','-q','-b','plan/test');git('add','.');git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','initial');
 const set: RecordingSet={protocol:1,head:git('rev-parse','HEAD'),branch:'plan/test',changes:[]};
 const check=(changed:string[]=set.changes.map(c=>`${c.path}:${c.purpose}`))=>validateRecordingSet(set,root,'test',['HANDOFF.md','step.md'],changed,'done');
 return {root,git,set,check,put:(p:string,s:string)=>fs.writeFileSync(path.join(root,p),s)};
}
test('exact set accepts empty outcomes, reviewed edits/additions/deletions and whole staging',()=>{
 const f=fixture(); assert.deepEqual(f.check(),[]);
 f.put('a.txt','after\n');f.put('new.txt','new');fs.unlinkSync(path.join(f.root,'b.txt'));
 f.set.changes=[{path:'a.txt',beforeDigest:hash('before\n'),afterDigest:hash('after\n'),purpose:'edit'}, {path:'b.txt',beforeDigest:hash('other\n'),afterDigest:'missing',purpose:'delete'}, {path:'new.txt',beforeDigest:'missing',afterDigest:hash('new'),purpose:'add'}];
 assert.deepEqual(f.check(),['a.txt','b.txt','new.txt']);f.git('add','--','a.txt','b.txt','new.txt');assert.deepEqual(f.check(),['a.txt','b.txt','new.txt']);
});
test('unrelated, stale, partially staged and core-owned edits refuse without changing index',()=>{
 const f=fixture();f.put('a.txt','after\n');f.set.changes=[{path:'a.txt',beforeDigest:hash('before\n'),afterDigest:hash('after\n'),purpose:'edit'}];
 f.put('b.txt','unrelated');assert.throws(()=>f.check(),/unreviewed change/);f.put('b.txt','other\n');
 f.git('add','a.txt');f.put('a.txt','later');f.set.changes[0].afterDigest=hash('later');const before=f.git('ls-files','--stage');assert.throws(()=>f.check(),/partial staging/);assert.equal(f.git('ls-files','--stage'),before);
 f.git('reset','-q');f.put('HANDOFF.md','unexpected');assert.throws(()=>f.check(),/progress edit/);
});
test('manifest rejects fabricated purpose, mode-only changes, links and wrong branch',()=>{
 const f=fixture();f.put('a.txt','after\n');f.set.changes=[{path:'a.txt',beforeDigest:hash('before\n'),afterDigest:hash('after\n'),purpose:'edit'}];
 assert.throws(()=>f.check(['a.txt:other']),/purpose/);f.set.branch='main';assert.throws(()=>f.check(),/HEAD\/branch/);f.set.branch='plan/test';
 f.put('a.txt','before\n');fs.chmodSync(path.join(f.root,'a.txt'),0o755);assert.throws(()=>f.check(),/mode-only/);fs.chmodSync(path.join(f.root,'a.txt'),0o644);
 fs.unlinkSync(path.join(f.root,'a.txt'));fs.symlinkSync('missing',path.join(f.root,'a.txt'));assert.throws(()=>f.check(),/links/);
});
test('missing/outside manifest requirement produces actionable refusal',()=>{
 const f=fixture(); assert.throws(()=>readRecordingSet(undefined,f.root),/--recording-set/);f.put('manifest.json',JSON.stringify(f.set));assert.throws(()=>readRecordingSet(path.join(f.root,'manifest.json'),f.root),/outside/);
});
test('hidden tracked modifications cannot bypass the exact set through index flags',()=>{
 const f=fixture();f.git('update-index','--assume-unchanged','a.txt');f.put('a.txt','hidden');assert.throws(()=>f.check(),/assume-unchanged/);
 f.git('update-index','--no-assume-unchanged','a.txt');f.git('update-index','--skip-worktree','a.txt');assert.throws(()=>f.check(),/skip-worktree/);
});
