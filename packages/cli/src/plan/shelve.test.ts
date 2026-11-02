import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { executeOperation } from '../core/index.js';
import { loadConfig } from '../config.js';
import { shelveTransition } from './shelve.js';
import { cleanupPlan } from './flows.js';
import { planNext } from './next.js';
import { acquireWriterLease } from '../core/writer-leases.js';
import { PLAN_SCHEMA, validator } from '../schemas.js';
import { runGate } from './gate.js';
const id = '2026-11-02-pause';
test('shelve and resume retain a dirty plan checkout and override its stale status', t => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shelve-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const root=path.join(dir,'repo'), wt=path.join(dir,'plan'); fs.mkdirSync(root);
 const git=(cwd:string,...args:string[])=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:5000}).trim();
 const put=(p:string,s:string)=>{const f=path.join(root,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,s);};
 git(root,'init','-b','main');git(root,'config','user.name','Test');git(root,'config','user.email','test@example.com');
 put('.specplane/config.yaml','plans:\n  archive_done: false\n');put('docs/specifications/.keep','');
 const file=`plans/${id}/PLAN.md`, text=`---\nid: ${id}\ntitle: Pause\nstatus: ready\nspecs: [feature/example]\n---\n`;
 put(file,text); put(`plans/${id}/steps/01-one.md`,`---\nplan: ${id}\nstep: 1\ntitle: One\nstatus: pending\n---\n`);git(root,'add','.');git(root,'commit','-m','base');const base=git(root,'rev-parse','HEAD');
 git(root,'worktree','add','-b',`plan/${id}`,wt);fs.writeFileSync(path.join(wt,file),text.replace('---\n',`---\n` ).replace('specs: [feature/example]',`specs: [feature/example]\nexecution:\n  target_branch: main\n  start_target_branch: main\n  start_base: ${base}`));git(wt,'commit','-am','binding');
 fs.writeFileSync(path.join(wt,'dirty.txt'),'uncommitted'); const config=loadConfig(root).config;
 const lease=acquireWriterLease({repository:true,plans:[id],checkouts:[root,wt],requestId:'worker-test'}); assert.throws(()=>shelveTransition(id,'shelve',config,root),/lease|held/i); lease.release();
 const head=git(root,'rev-parse','HEAD');const preview=shelveTransition(id,'shelve',config,root,{dryRun:true});assert.equal(preview.dryRun,true);assert.equal(preview.commit,null);assert.equal(git(root,'rev-parse','HEAD'),head);assert.equal(git(root,'status','--porcelain'),'');
 const hook=path.join(root,'.git','hooks','pre-commit');fs.writeFileSync(hook,'#!/bin/sh\nexit 1\n',{mode:0o755});assert.throws(()=>shelveTransition(id,'shelve',config,root));assert.equal(git(root,'rev-parse','HEAD'),head);assert.equal(git(root,'status','--porcelain'),'');assert.equal(fs.readFileSync(path.join(root,file),'utf8'),text);fs.rmSync(hook);
 const cli=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','cli.js'); const receipt=spawnSync(process.execPath,[cli,'plan','shelve',id],{cwd:root,encoding:'utf8',timeout:10000}); assert.equal(receipt.status,0,receipt.stderr); assert.match(receipt.stdout,/Shelved/);assert.match(fs.readFileSync(path.join(root,file),'utf8'),/status: shelved\nspecs:.*\nshelved_from: ready/);assert.equal(fs.readFileSync(path.join(wt,'dirty.txt'),'utf8'),'uncommitted');assert.equal(planNext(id,config,root).action,'none');assert.equal(planNext(id,config,root).effectiveStatus,'shelved');assert.throws(()=>shelveTransition(id,'shelve',config,root));
 const resumed=executeOperation({operation:'plan.resume',arguments:{id}},{extensionId:'test',checkout:root}); assert.equal(resumed.ok,true); assert.match(fs.readFileSync(path.join(root,file),'utf8'),/status: ready/);assert.doesNotMatch(fs.readFileSync(path.join(root,file),'utf8'),/shelved_from/);assert.equal(fs.readFileSync(path.join(wt,'dirty.txt'),'utf8'),'uncommitted');
 // A manually copied done declaration is not integration proof.
 fs.writeFileSync(path.join(root,file),text.replace('ready','done'));git(root,'commit','-am','manual done');assert.throws(()=>cleanupPlan(id,config,root,{force:true}),/unverified/);assert.ok(fs.existsSync(wt));assert.equal(git(root,'rev-parse',`plan/${id}`),git(wt,'rev-parse','HEAD'));
});

test('frontmatter publication failure retains its exact commit and retry publishes it', t => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shelve-push-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const root=path.join(dir,'repo'), bare=path.join(dir,'remote.git'), wt=path.join(dir,'wt');fs.mkdirSync(root);
 const git=(cwd:string,...args:string[])=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:5000}).trim();
 const put=(p:string,s:string)=>{const f=path.join(root,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,s);};
 git(dir,'init','--bare',bare);git(root,'init','-b','main');git(root,'config','user.name','Test');git(root,'config','user.email','test@example.com');
 put('.specplane/config.yaml','plans:\n  status_source: frontmatter\n  archive_done: false\n');put('docs/specifications/.keep','');
 const file=`plans/${id}/PLAN.md`, text=`---\nid: ${id}\ntitle: Pause\nstatus: in_progress\nspecs: [feature/example]\n---\n`;
 put(file,text);git(root,'add','.');git(root,'commit','-m','base');const base=git(root,'rev-parse','HEAD');git(root,'remote','add','origin',bare);git(root,'push','-u','origin','main');
 git(root,'worktree','add','-b',`plan/${id}`,wt);fs.writeFileSync(path.join(wt,file),text.replace('specs: [feature/example]',`specs: [feature/example]\nexecution:\n  target_branch: main\n  start_target_branch: main\n  start_base: ${base}`));git(wt,'commit','-am','binding');
 const hook=path.join(bare,'hooks','pre-receive');fs.writeFileSync(hook,'#!/bin/sh\nexit 1\n',{mode:0o755});const config=loadConfig(root).config;
 assert.throws(()=>shelveTransition(id,'shelve',config,root),/Publication pending for [0-9a-f]{40}/);const retained=git(root,'rev-parse','HEAD');assert.notEqual(retained,base);assert.equal(git(bare,'rev-parse','refs/heads/main'),base);
 fs.rmSync(hook);const retry=shelveTransition(id,'shelve',config,root);assert.equal(retry.retry,true);assert.equal(retry.commit,retained);assert.equal(git(root,'rev-parse','HEAD'),retained);assert.equal(git(bare,'rev-parse','refs/heads/main'),retained);
 shelveTransition(id,'resume',config,root);assert.match(fs.readFileSync(path.join(root,file),'utf8'),/status: in_progress/);assert.doesNotMatch(fs.readFileSync(path.join(root,file),'utf8'),/shelved_from/);
});


test('schema and forced conductor gate preserve the shelving invariant', () => {
 const valid=validator(PLAN_SCHEMA);const p={id,title:'Pause',specs:['feature/example']};
 assert.equal(valid({...p,status:'shelved',shelved_from:'ready'}),true);
 assert.equal(valid({...p,status:'shelved'}),false);
 assert.equal(valid({...p,status:'ready',shelved_from:'ready'}),false);
 const n={plan:id,title:'Pause',effectiveStatus:'shelved' as const,step:{number:1,title:'done',status:'done',file:'x'},context:[],checkout:'/tmp',blocked:[],openGaps:[],warnings:[],attention:[],action:'spawn_step' as const,reason:'shelved'};
 assert.equal(runGate({next:n,backend:'worktree',force:true,reason:'rerun'}).allowed,false);
});
