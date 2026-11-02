import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {execFileSync} from 'node:child_process';
import {loadConfig} from '../config.js';
import {planList, planShow} from '../commands/plan.js';
import {planReport} from './activity.js';
const id='2026-11-02-report';
function setup(t: import('node:test').TestContext) {
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'report-')); t.after(()=>fs.rmSync(cwd,{recursive:true,force:true}));
 const git=(...args:string[])=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:5000}).trim();
 const put=(p:string,s:string)=>{const f=path.join(cwd,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,s);};
 git('init','-b','main');git('config','user.name','Test');git('config','user.email','test@example.com');
 put('.specplane/config.yaml','execution:\n  backend: worktree\n');
 put('docs/specifications/.keep','');
 const file=`plans/${id}/PLAN.md`, header=`---\nid: ${id}\ntitle: Report\nstatus: ready\nspecs: [feature/example]\n`;
 put(file,header+'---\nBody preserved.\n');git('add','.');git('commit','-m','base');git('branch','candidate');const base=git('rev-parse','HEAD');git('switch','-c',`plan/${id}`);
 const text=header.replace('ready','done')+`comparison_base: ${base}\nexecution:\n  target_branch: candidate\n  start_target_branch: candidate\n  start_base: ${base}\n---\nBody preserved.\n`;
 put(file,text);git('commit','-am','bind');return {cwd,git,put,file,text,base,config:loadConfig(cwd).config};
}
test('reports recorded target, pending edit and unintegrated done',t=>{const f=setup(t);const edited=f.text.replace('target_branch: candidate','target_branch: other');f.put(f.file,edited);const r=planReport(id,f.config,f.cwd,null);assert.equal(r.target_branch,'candidate');assert.equal(r.start_base,f.base);assert.equal(r.comparison_base,f.base);assert.equal(r.pending_target_branch,'other');assert.equal(r.plan_branch_status,'done');assert.equal(r.target_status,'ready');assert.equal(r.integration_status,'not_integrated');assert.equal(fs.readFileSync(path.join(f.cwd,f.file),'utf8'),edited);assert.match(planShow(id,f.cwd,f.config),/Body preserved\.[\s\S]*Derived plan context:/);});
test('discovers local and remote-only branch missing from checkout',t=>{const f=setup(t);f.git('switch','main');f.git('rm','-r',`plans/${id}`);f.git('commit','-m','remove');assert.equal(planList({live:true,fetch:false},f.cwd,f.config).rows.find(r=>r.id===id)?.target_branch,'candidate');f.git('update-ref',`refs/remotes/origin/plan/${id}`,`refs/heads/plan/${id}`);f.git('branch','-D',`plan/${id}`);assert.equal(planList({live:true,fetch:false},f.cwd,f.config).rows.find(r=>r.id===id)?.target_branch,'candidate');assert.match(planShow(id,f.cwd,f.config),/Body preserved/);});
test('missing, divergent and legacy refs remain unverifiable',t=>{const f=setup(t);f.git('branch','-D','candidate');let r=planReport(id,f.config,f.cwd,null);assert.equal(r.target_branch,'candidate');assert.equal(r.integration_status,'unverifiable');assert.match(r.integration_reasons.join(),/unavailable/);f.git('branch','candidate',f.base);f.git('update-ref','refs/remotes/origin/candidate','HEAD');f.git('switch','candidate');f.git('commit','--allow-empty','-m','diverge');r=planReport(id,f.config,f.cwd,null);assert.equal(r.integration_status,'unverifiable');assert.match(r.integration_reasons.join(),/divergent/);f.git('switch',`plan/${id}`);f.put(f.file,`---\nid: ${id}\ntitle: Report\nstatus: done\nspecs: [feature/example]\n---\n`);f.git('commit','-am','legacy');r=planReport(id,f.config,f.cwd,null);assert.equal(r.target_branch,null);assert.equal(r.start_base,null);assert.match(r.integration_reasons.join(),/Legacy/);});
test('divergent plan branches fail list and show instead of choosing an identity',t=>{const f=setup(t);f.git('update-ref',`refs/remotes/origin/plan/${id}`,'HEAD');f.git('commit','--allow-empty','-m','local');f.git('switch','--detach',f.base);f.git('commit','--allow-empty','-m','remote');f.git('update-ref',`refs/remotes/origin/plan/${id}`,'HEAD');assert.throws(()=>planList({live:true,fetch:false},f.cwd,f.config),/Divergent plan branches/);assert.throws(()=>planShow(id,f.cwd,f.config),/Divergent plan branches/);});
test('merged forge evidence must match exact head and target and be present in target history',t=>{
 const f=setup(t), head=f.git('rev-parse','HEAD'); f.git('switch','candidate');
 f.put(f.file, f.text.replace(/comparison_base:[\s\S]*?---\n/, '---\n')); f.git('commit','-am','target done'); const merge=f.git('rev-parse','HEAD');
 f.git('remote','add','origin','https://github.com/o/r.git'); const bin=path.join(f.cwd,'bin');fs.mkdirSync(bin); const stub=path.join(bin,'gh');
 const make=(h:string,m:string)=>fs.writeFileSync(stub,`#!/bin/sh\nif [ "$1" = "--version" ]; then exit 0; fi\nprintf '%s\\n' '${JSON.stringify([{headRefOid:h,baseRefName:'candidate',mergeCommit:{oid:m}}])}'\n`,{mode:0o755});
 const saved=process.env.PATH;process.env.PATH=bin+path.delimiter+saved;try {make(head,merge);assert.equal(planReport(id,f.config,f.cwd,null).integration_status,'integrated');make('c'.repeat(40),merge);assert.equal(planReport(id,f.config,f.cwd,null).integration_status,'unverifiable');make(head,'d'.repeat(40));assert.equal(planReport(id,f.config,f.cwd,null).integration_status,'unverifiable');}finally{process.env.PATH=saved;}
});
