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
import { generateWorkingPlansMd } from '../generate/plans-md.js';
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
 put('staged.txt','preserve');git(root,'add','staged.txt');assert.throws(()=>shelveTransition(id,'shelve',config,root,{dryRun:true}),/staged changes/);assert.equal(git(root,'diff','--cached','--name-only'),'staged.txt');git(root,'reset','-q','HEAD','--','staged.txt');fs.rmSync(path.join(root,'staged.txt'));
 put('plans/untracked.txt','preserve');assert.throws(()=>shelveTransition(id,'shelve',config,root,{dryRun:true}),/dirty or untracked/);assert.equal(fs.readFileSync(path.join(root,'plans/untracked.txt'),'utf8'),'preserve');fs.rmSync(path.join(root,'plans/untracked.txt'));
 put('.git/info/exclude','plans/ignored.txt\n');put('plans/ignored.txt','preserve');assert.throws(()=>shelveTransition(id,'shelve',config,root,{dryRun:true}),/dirty or untracked/);assert.equal(fs.readFileSync(path.join(root,'plans/ignored.txt'),'utf8'),'preserve');fs.rmSync(path.join(root,'plans/ignored.txt'));
 const hook=path.join(root,'.git','hooks','pre-commit');fs.writeFileSync(hook,'#!/bin/sh\nexit 1\n',{mode:0o755});assert.throws(()=>shelveTransition(id,'shelve',config,root));assert.equal(git(root,'rev-parse','HEAD'),head);assert.equal(git(root,'status','--porcelain'),'');assert.equal(fs.readFileSync(path.join(root,file),'utf8'),text);fs.rmSync(hook);
 // A hook may modify owned files after commit; retain the commit and edits for inspection.
 const post=path.join(root,'.git','hooks','post-commit');fs.writeFileSync(post,`#!/bin/sh\nprintf '\nexternal edit\n' >> '${file}'\n`,{mode:0o755});
 assert.throws(()=>shelveTransition(id,'shelve',config,root),/retained.*inspect/i);const retainedHook=git(root,'rev-parse','HEAD');assert.notEqual(retainedHook,head);assert.match(fs.readFileSync(path.join(root,file),'utf8'),/external edit/);fs.rmSync(post);
 // This disposable fixture deliberately discards the hook-induced transition for subsequent cases.
 git(root,'reset','--hard',head);git(root,'clean','-fd');
 // A terminal plan tip arriving in a post-commit hook must prevent success.
 const planHead=git(wt,'rev-parse','HEAD');fs.writeFileSync(path.join(wt,file),fs.readFileSync(path.join(wt,file),'utf8').replace('status: ready','status: done'));git(wt,'commit','-am','terminal');const terminal=git(wt,'rev-parse','HEAD');git(wt,'reset','--hard',planHead);
 git(wt,'reset','--hard',terminal);assert.throws(()=>shelveTransition(id,'shelve',config,root,{dryRun:true}),/terminal or shelved/);assert.equal(git(root,'rev-parse','HEAD'),head);git(wt,'reset','--hard',planHead);
 fs.writeFileSync(post,`#!/bin/sh\ngit update-ref 'refs/heads/plan/${id}' '${terminal}'\n`,{mode:0o755});
 let raceError='';try{shelveTransition(id,'shelve',config,root);}catch(e){raceError=String(e);}const raceCommit=git(root,'rev-parse','HEAD');assert.notEqual(raceCommit,head);assert.match(raceError,new RegExp(`commit ${raceCommit}.*retained`, 'i'));assert.equal(git(root,'rev-parse',`plan/${id}`),terminal);fs.rmSync(post);git(root,'reset','--hard',head);git(wt,'reset','--hard',planHead);
 // Inject an I/O failure at the second write, after the PLAN write completed.
 const moduleUrl=new URL('./shelve.js',import.meta.url).href, configUrl=new URL('../config.js',import.meta.url).href;
 const script=`import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module'; const original=fs.writeFileSync; fs.writeFileSync=function(p,...a){ if(String(p)===process.argv[2]) throw new Error('injected index write failure'); return original.call(this,p,...a); }; syncBuiltinESMExports(); const {shelveTransition}=await import(${JSON.stringify(moduleUrl)}); const {loadConfig}=await import(${JSON.stringify(configUrl)}); try { shelveTransition(${JSON.stringify(id)},'shelve',loadConfig(process.argv[1]).config,process.argv[1]); process.exitCode=2; } catch(e) { if(!String(e).includes('injected index write failure')) { console.error(e); process.exitCode=3; } }`;
 const injected=spawnSync(process.execPath,['--input-type=module','-e',script,root,path.join(root,'plans/PLANS.md')],{encoding:'utf8',timeout:10000});assert.equal(injected.status,0,injected.stderr);assert.equal(git(root,'rev-parse','HEAD'),head);assert.equal(git(root,'status','--porcelain'),'');assert.equal(fs.readFileSync(path.join(root,file),'utf8'),text);assert.equal(fs.existsSync(path.join(root,'plans/PLANS.md')),false);
 const partialScript=script.replace("throw new Error('injected index write failure')", "{ original.call(this,p,'partial'); throw new Error('injected index write failure'); }").replace("if(!String(e).includes('injected index write failure'))", "if(!String(e).includes('ambiguous bytes retained'))");const partial=spawnSync(process.execPath,['--input-type=module','-e',partialScript,root,path.join(root,'plans/PLANS.md')],{encoding:'utf8',timeout:10000});assert.equal(partial.status,0,partial.stderr);assert.equal(fs.readFileSync(path.join(root,file),'utf8'),text);assert.equal(fs.readFileSync(path.join(root,'plans/PLANS.md'),'utf8'),'partial');assert.equal(git(root,'rev-parse','HEAD'),head);fs.rmSync(path.join(root,'plans/PLANS.md'));
 const cli=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','cli.js'); const receipt=spawnSync(process.execPath,[cli,'plan','shelve',id],{cwd:root,encoding:'utf8',timeout:10000}); assert.equal(receipt.status,0,receipt.stderr); assert.match(receipt.stdout,/Shelved/);assert.match(fs.readFileSync(path.join(root,file),'utf8'),/status: shelved\nspecs:.*\nshelved_from: ready/);assert.equal(fs.readFileSync(path.join(wt,'dirty.txt'),'utf8'),'uncommitted');assert.equal(planNext(id,config,root).action,'none');assert.equal(planNext(id,config,root).effectiveStatus,'shelved');assert.throws(()=>shelveTransition(id,'shelve',config,root));
 const resumePreview=shelveTransition(id,'resume',config,root,{dryRun:true});assert.equal(resumePreview.effectiveStatus,'in_progress');assert.equal(resumePreview.next?.number,1);
 const resumed=executeOperation({operation:'plan.resume',arguments:{id}},{extensionId:'test',checkout:root}); assert.equal(resumed.ok,true); assert.match(fs.readFileSync(path.join(root,file),'utf8'),/status: ready/);assert.doesNotMatch(fs.readFileSync(path.join(root,file),'utf8'),/shelved_from/);assert.equal(fs.readFileSync(path.join(wt,'dirty.txt'),'utf8'),'uncommitted');
 // A manually copied done declaration is not integration proof.
 fs.writeFileSync(path.join(root,file),text.replace('ready','done'));git(root,'commit','-am','manual done');assert.throws(()=>cleanupPlan(id,config,root,{force:true}),/unverified/);assert.ok(fs.existsSync(wt));assert.equal(git(root,'rev-parse',`plan/${id}`),git(wt,'rev-parse','HEAD'));
});

for (const format of ['sha1', 'sha256'] as const) test(`${format} publication failure retains its exact commit and retry publishes it`, t => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shelve-push-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const root=path.join(dir,'repo'), bare=path.join(dir,'remote.git'), wt=path.join(dir,'wt');fs.mkdirSync(root);
 const git=(cwd:string,...args:string[])=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:5000}).trim();
 const put=(p:string,s:string)=>{const f=path.join(root,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,s);};
 git(dir,'init',`--object-format=${format}`,'--bare',bare);git(root,'init',`--object-format=${format}`,'-b','main');git(root,'config','user.name','Test');git(root,'config','user.email','test@example.com');
 put('.specplane/config.yaml','plans:\n  status_source: frontmatter\n  archive_done: false\n');put('docs/specifications/.keep','');
 const file=`plans/${id}/PLAN.md`, text=`---\nid: ${id}\ntitle: Pause\nstatus: in_progress\nspecs: [feature/example]\n---\n`;
 put(file,text);git(root,'add','.');git(root,'commit','-m','base');const base=git(root,'rev-parse','HEAD');git(root,'remote','add','origin',bare);git(root,'push','-u','origin','main');
 git(root,'worktree','add','-b',`plan/${id}`,wt);fs.writeFileSync(path.join(wt,file),text.replace('specs: [feature/example]',`specs: [feature/example]\nexecution:\n  target_branch: main\n  start_target_branch: main\n  start_base: ${base}`));git(wt,'commit','-am','binding');
 git(root,'worktree','remove',wt);
 const config=loadConfig(root).config, oidLength=format==='sha1'?40:64;
 // A post-commit hook can move HEAD; the retained identity must still name the created commit.
 const post=path.join(root,'.git','hooks','post-commit');fs.writeFileSync(post,`#!/bin/sh\nprintf '[main ${base}]\n'\ngit update-ref refs/heads/main '${base}'\n`,{mode:0o755});
 let error='';try{shelveTransition(id,'shelve',config,root);}catch(e){error=String(e);}
 const created=new RegExp(`Lifecycle commit ([0-9a-f]{${oidLength}}) was retained`).exec(error)?.[1];assert.ok(created,error);assert.equal(git(root,'rev-parse','HEAD'),base);assert.equal(git(root,'rev-parse',`${created}^{commit}`),created);assert.equal(git(root,'rev-parse',`${created}^`),base);fs.rmSync(post);git(root,'reset','--hard',base);
 const hook=path.join(bare,'hooks','pre-receive');fs.writeFileSync(hook,'#!/bin/sh\nexit 1\n',{mode:0o755});
 let publicationError='';try{shelveTransition(id,'shelve',config,root);}catch(e){publicationError=String(e);}const retained=git(root,'rev-parse','HEAD');assert.match(publicationError,new RegExp(`Publication pending for ${retained}(?:,|:)`));assert.equal(retained.length,oidLength);assert.notEqual(retained,base);assert.equal(git(bare,'rev-parse','refs/heads/main'),base);
 const moved=execFileSync('git',['commit-tree',`${base}^{tree}`,'-p',base,'-m','external'],{cwd:bare,encoding:'utf8',env:{...process.env,GIT_AUTHOR_NAME:'Test',GIT_AUTHOR_EMAIL:'test@example.com',GIT_COMMITTER_NAME:'Test',GIT_COMMITTER_EMAIL:'test@example.com'},timeout:5000}).trim();git(bare,'update-ref','refs/heads/main',moved,base);assert.throws(()=>shelveTransition(id,'shelve',config,root),/needs reconciliation/);assert.equal(git(bare,'rev-parse','refs/heads/main'),moved);git(bare,'update-ref','refs/heads/main',base,moved);
 const beforePreview=git(root,'status','--porcelain');const preview=shelveTransition(id,'shelve',config,root,{dryRun:true});assert.equal(preview.retry,true);assert.equal(preview.commit,retained);assert.equal(git(bare,'rev-parse','refs/heads/main'),base);assert.equal(git(root,'status','--porcelain'),beforePreview);
 fs.rmSync(hook);const retry=shelveTransition(id,'shelve',config,root);assert.equal(retry.retry,true);assert.equal(retry.commit,retained);assert.equal(git(root,'rev-parse','HEAD'),retained);assert.equal(git(bare,'rev-parse','refs/heads/main'),retained);
 const previewResume=shelveTransition(id,'resume',config,root,{dryRun:true});assert.equal(previewResume.effectiveStatus,'in_progress');assert.equal(previewResume.startCommand,`specplane plan start ${id}`);
 const resumed=shelveTransition(id,'resume',config,root);assert.equal(resumed.effectiveStatus,'in_progress');assert.equal(resumed.checkout,null);assert.equal(resumed.startCommand,`specplane plan start ${id}`);assert.match(fs.readFileSync(path.join(root,file),'utf8'),/status: in_progress/);assert.doesNotMatch(fs.readFileSync(path.join(root,file),'utf8'),/shelved_from/);
 git(root,'branch','-D',`plan/${id}`);assert.throws(()=>shelveTransition(id,'shelve',config,root),/existing plan branch is required/);
});


test('schema and forced conductor gate preserve the shelving invariant', () => {
 const valid=validator(PLAN_SCHEMA);const p={id,title:'Pause',specs:['feature/example']};
 assert.equal(valid({...p,status:'shelved',shelved_from:'ready'}),true);
 assert.equal(valid({...p,status:'shelved'}),false);
 assert.equal(valid({...p,status:'ready',shelved_from:'ready'}),false);
 const n={plan:id,title:'Pause',effectiveStatus:'shelved' as const,step:{number:1,title:'done',status:'done',file:'x'},context:[],checkout:'/tmp',blocked:[],openGaps:[],warnings:[],attention:[],action:'spawn_step' as const,reason:'shelved'};
 assert.equal(runGate({next:n,backend:'worktree',force:true,reason:'rerun'}).allowed,false);
});

test('recorded non-default target, custom paths and remote-only branch use target state', t => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shelve-target-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const root=path.join(dir,'repo'), target=path.join(dir,'release'), wt=path.join(dir,'plan');fs.mkdirSync(root);
 const git=(cwd:string,...args:string[])=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:5000}).trim();
 const put=(base:string,p:string,s:string)=>{const f=path.join(base,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,s);};
 git(root,'init','-b','main');git(root,'config','user.name','Test');git(root,'config','user.email','test@example.com');
 put(root,'.specplane/config.yaml','plans:\n  dir: roadmap\n  archive_done: false\n');put(root,'docs/specifications/.keep','');
 const rel=`roadmap/${id}/PLAN.md`, dep='2026-11-01-dependency';const text=`---\nid: ${id}\ntitle: Pause\nstatus: ready\nspecs: [feature/example]\ndepends_on: [${dep}]\n---\n`;
 put(root,rel,text);put(root,`roadmap/${dep}/PLAN.md`,`---\nid: ${dep}\ntitle: Dependency\nstatus: ready\nspecs: [feature/example]\n---\n`);git(root,'add','.');git(root,'commit','-m','base');
 git(root,'worktree','add','-b','release',target);put(target,'.specplane/config.yaml','plans:\n  dir: roadmap\n  archive_done: false\n  forge: auto\n');git(target,'commit','-am','target config');const base=git(target,'rev-parse','HEAD');
 git(root,'worktree','add','-b',`plan/${id}`,wt,'release');put(wt,rel,text.replace('depends_on:',`execution:\n  target_branch: release\n  start_target_branch: release\n  start_base: ${base}\ndepends_on:`));git(wt,'commit','-am','binding');const plan=git(wt,'rev-parse','HEAD');git(root,'worktree','remove',wt);git(root,'update-ref',`refs/remotes/origin/plan/${id}`,plan);git(root,'branch','-D',`plan/${id}`);
 const config=loadConfig(root).config, main=git(root,'rev-parse','HEAD');const preview=shelveTransition(id,'shelve',config,root,{dryRun:true});assert.equal(preview.target,'release');assert.equal(preview.checkout,null);assert.equal(git(root,'rev-parse','HEAD'),main);assert.equal(git(target,'rev-parse','HEAD'),base);
 assert.throws(()=>shelveTransition(id,'shelve',{...config,plans:{...config.plans,dir:'different'}},root,{dryRun:true}),/Conflicting plan or specification path interpretation/);assert.equal(git(target,'rev-parse','HEAD'),base);
 shelveTransition(id,'shelve',config,root);assert.equal(git(root,'rev-parse','HEAD'),main);assert.equal(fs.readFileSync(path.join(target,'roadmap/PLANS.md'),'utf8'),generateWorkingPlansMd(loadConfig(target).config,target));
 const resumed=shelveTransition(id,'resume',config,root);assert.equal(resumed.effectiveStatus,'blocked');assert.equal(resumed.startCommand,`specplane plan start ${id}`);assert.equal(git(root,'rev-parse',`refs/remotes/origin/plan/${id}`),plan);
 // Scripted gh supplies matching-base PR evidence; Git transport stays a local bare repo.
 put(target,`roadmap/${dep}/PLAN.md`,`---\nid: ${dep}\ntitle: Dependency\nstatus: done\nspecs: [feature/example]\n---\n`);git(target,'commit','-am','dependency done');
 const bare=path.join(dir,'remote.git'), bin=path.join(dir,'bin'), log=path.join(dir,'gh.log');git(dir,'init','--bare',bare);git(root,'remote','add','origin','https://github.com/example/project');git(root,'config',`url.${bare}.insteadOf`,'https://github.com/example/project');git(target,'push','-u','origin','release');
 fs.mkdirSync(bin);fs.writeFileSync(path.join(bin,'gh'),`#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nif [ "$1" = --version ]; then echo gh; else echo '[{"url":"https://example.test/pr/1"}]'; fi\n`,{mode:0o755});const oldPath=process.env.PATH;process.env.PATH=`${bin}:${oldPath ?? ''}`;
 try { shelveTransition(id,'shelve',config,root);const review=shelveTransition(id,'resume',config,root,{dryRun:true});assert.equal(review.effectiveStatus,'review');assert.match(fs.readFileSync(log,'utf8'),/--base release/);assert.equal(shelveTransition(id,'resume',config,root).effectiveStatus,'review'); } finally { process.env.PATH=oldPath; }
 put(target,rel,text.replace('status: ready','status: shelved\nshelved_from: in_progress'));git(target,'commit','-am','invalid mode');assert.throws(()=>shelveTransition(id,'resume',config,root,{dryRun:true}),/Invalid shelving metadata/);
});
