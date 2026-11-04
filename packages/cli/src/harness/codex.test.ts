import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { runInit } from '../commands/init.js';
import { makeRepo } from '../test-repo.js';
import { runValidate } from '../commands/validate.js';
import { CODEX_SKILL } from './codex.js';
import { DEFAULT_CONFIG } from '../config.js';
import { checkSkillDrift } from '../spec/skill-drift.js';
import { runPlan } from '../plan/run.js';
const cli=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','cli.js');
const bunRuntime = Boolean(process.versions.bun);
const env={...process.env,GIT_AUTHOR_NAME:'test',GIT_AUTHOR_EMAIL:'test@example.invalid',GIT_COMMITTER_NAME:'test',GIT_COMMITTER_EMAIL:'test@example.invalid'};
const git=(cwd:string,...args:string[])=>execFileSync('git',args,{cwd,env,encoding:'utf8'}).trim();
const sp=(cwd:string,...args:string[])=>execFileSync(process.execPath,[cli,...args],{cwd,env,encoding:'utf8'});

test('codex init is explicit, idempotent and preserves user-owned settings and instructions',()=>{
 const root=makeRepo({'AGENTS.md':'User instructions.\n','.claude/settings.json':'{"permissions":{"allow":["Bash(ls:*)"]}}\n','.codex/config.toml':'sandbox_mode="read-only"\n'});
 const beforeClaude=fs.readFileSync(path.join(root,'.claude/settings.json'),'utf8');
 const beforeCodex=fs.readFileSync(path.join(root,'.codex/config.toml'),'utf8');
 const first=runInit(root,{harness:'codex'}); assert.ok(first.some(s=>s.includes(`Created ${CODEX_SKILL}`)));
 const skill=fs.readFileSync(path.join(root,CODEX_SKILL),'utf8');assert.match(skill,/experimental development/);assert.match(skill,/final merge/);assert.doesNotMatch(skill,/dangerously-bypass|dangerously-skip/);
 assert.equal(fs.readFileSync(path.join(root,'.claude/settings.json'),'utf8'),beforeClaude);
 assert.equal(fs.readFileSync(path.join(root,'.codex/config.toml'),'utf8'),beforeCodex);
 assert.equal(fs.existsSync(path.join(root,'.claude/skills')),false);
 assert.match(fs.readFileSync(path.join(root,'AGENTS.md'),'utf8'),/^User instructions\./);
 assert.ok(runInit(root,{harness:'codex'}).every(s=>!s.startsWith('Created')&&!s.startsWith('Updated')));
 git(root,'init','-q','-b','main');
 git(root,'add','.specplane/config.yaml');
 git(root,'commit','-qm','fixture baseline');
 assert.equal(runValidate(root).errors.length,0);
});

test('neutral init suppresses Claude auto-detection and all harness writes',()=>{
 const root=makeRepo({'.claude/settings.json':'{"keep":true}\n'});
 const lines=runInit(root,{harness:'none'});
 assert.ok(lines.some(s=>s.includes('explicitly disabled')));
 assert.equal(fs.readFileSync(path.join(root,'.claude/settings.json'),'utf8'),'{"keep":true}\n');
 assert.equal(fs.existsSync(path.join(root,'.claude/skills')),false);
 assert.equal(fs.existsSync(path.join(root,CODEX_SKILL)),false);
 assert.match(fs.readFileSync(path.join(root,'AGENTS.md'),'utf8'),/no slash commands/);
});

test('codex init does not overwrite an existing customized skill',()=>{
 const root=makeRepo({[CODEX_SKILL]:'my custom skill\n'});
 assert.ok(runInit(root,{harness:'codex'}).some(s=>s.includes('existing skill preserved')));
 assert.equal(fs.readFileSync(path.join(root,CODEX_SKILL),'utf8'),'my custom skill\n');
});

test('the conductor needs an extension-supplied adapter and never selects Claude or Codex from installed files',async()=>{
 const root=makeRepo({});runInit(root,{harness:'codex'});
 await assert.rejects(runPlan('2026-11-01-example',structuredClone(DEFAULT_CONFIG),root,{dryRun:true},{} as never),/extension-supplied session adapter/);
});

function experimentalWorkflow(implementation = 'export const sum = (a,b) => a+b;\n'): void {
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'specplane-codex-flow-'));const root=path.join(tmp,'repo'),work=path.join(tmp,'work');fs.mkdirSync(root);
 try{
  git(root,'init','-q','-b','fixture-base');sp(root,'init','--harness','codex');
  sp(root,'spec','new','feature','sum','--title','Add two numbers');
  sp(root,'plan','new','--id','2026-11-01-sum','--title','Implement sum','--specs','feature/sum','--depends-on','','--target','fixture-base');
  const plan='plans/2026-11-01-sum/PLAN.md', spec='docs/specifications/features/sum.md';
  const planBefore=fs.readFileSync(path.join(root,plan),'utf8'),specBefore=fs.readFileSync(path.join(root,spec),'utf8');
  git(root,'add','.');git(root,'commit','-qm','fixture draft');const base=git(root,'rev-parse','HEAD');
  git(root,'worktree','add','-q','-b','experiment/sum',work,'HEAD');
  const n=JSON.parse(sp(work,'plan','next','2026-11-01-sum','--json'));assert.equal(n.action,'none');
  // The current user-authorized experimental workflow is manual and explicit; no conductor gate is bypassed.
  fs.writeFileSync(path.join(work,'DECISIONS.md'),'Experimental implementation authorized for this fixture; final review/merge remains human. No plan/spec approval granted.\n');
  fs.writeFileSync(path.join(work,'sum.mjs'),implementation);
  fs.writeFileSync(path.join(work,'sum.test.mjs'),"import assert from 'node:assert/strict'; import {test} from 'node:test'; import {sum} from './sum.mjs'; test('sum positive, zero and negative',()=>{assert.equal(sum(2,3),5);assert.equal(sum(0,0),0);assert.equal(sum(-2,1),-1);});\n");
  // A child test runner must not inherit the outer runner's recursive-test marker.
  const testEnv: NodeJS.ProcessEnv = {...env};
  delete testEnv.NODE_TEST_CONTEXT;
  const childArgs = bunRuntime ? ['test','--timeout=30000','./sum.test.mjs'] : ['--test','--test-reporter=tap','sum.test.mjs'];
  const child = spawnSync(process.execPath,childArgs,{cwd:work,env:testEnv,encoding:'utf8'});
  assert.ifError(child.error);
  assert.equal(child.status,0,`Child implementation tests failed:\n${child.stdout}\n${child.stderr}`);
  // Exit zero alone can mean a nested suite was skipped: require the named
  // assertion case and the active runtime's real test counts.
  if (bunRuntime) {
   const output = `${child.stdout}\n${child.stderr}`;
   assert.match(output,/^\(pass\) sum positive, zero and negative(?: \[[^\n]*\])?$/m);
   assert.match(output,/^\s*1 pass$/m);
   assert.match(output,/^\s*0 fail$/m);
   assert.match(output,/^Ran 1 test across 1 file\./m);
  } else {
   assert.match(child.stdout,/^ok 1 - sum positive, zero and negative$/m);
   assert.match(child.stdout,/^# tests 1$/m);
   assert.match(child.stdout,/^# pass 1$/m);
   assert.match(child.stdout,/^# fail 0$/m);
  }
  assert.doesNotMatch(child.stderr,/skipping running files/);
  const validation=JSON.parse(sp(work,'validate','--json'));assert.equal(validation.errors.length,0);
  git(work,'add','DECISIONS.md','sum.mjs','sum.test.mjs');git(work,'commit','-qm','feat: demonstrate isolated experimental work');
  assert.equal(fs.readFileSync(path.join(work,plan),'utf8'),planBefore);assert.equal(fs.readFileSync(path.join(work,spec),'utf8'),specBefore);
  assert.equal(git(root,'rev-parse','HEAD'),base);assert.equal(fs.existsSync(path.join(root,'sum.mjs')),false);
  assert.equal(git(work,'status','--porcelain'),'');
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
}

test('representative experimental workflow implements/tests in isolated worktree without plan promotion',()=>{
 experimentalWorkflow();
});

test('experimental workflow rejects a broken implementation through its child tests',()=>{
 assert.throws(()=>experimentalWorkflow('export const sum = (a,b) => a-b;\n'),(error: unknown)=>{
  assert.ok(error instanceof assert.AssertionError);
  assert.equal(error.actual,1);
  assert.equal(error.expected,0);
  assert.match(error.message,/Child implementation tests failed:/);
  if (bunRuntime) {
   assert.match(error.message,/^\(fail\) sum positive, zero and negative(?: \[[^\n]*\])?$/m);
   assert.match(error.message,/^\s*0 pass$/m);
   assert.match(error.message,/^\s*1 fail$/m);
   assert.match(error.message,/^Ran 1 test across 1 file\./m);
  } else {
   assert.match(error.message,/^not ok 1 - sum positive, zero and negative$/m);
   assert.match(error.message,/^# tests 1$/m);
   assert.match(error.message,/^# fail 1$/m);
  }
  return true;
 });
});

test('codex install refuses a skill directory escaping the repository',()=>{
 const root=makeRepo({}), outside=fs.mkdtempSync(path.join(os.tmpdir(),'specplane-skill-outside-'));
 try{
  fs.symlinkSync(outside,path.join(root,'.agents'),'dir');
  assert.ok(runInit(root,{harness:'codex'}).some(s=>s.includes('outside the repository')));
  assert.deepEqual(fs.readdirSync(outside),[]);
 }finally{fs.rmSync(outside,{recursive:true,force:true});}
});

test('installed Codex contract is verified against scoped bundled source, never waived',()=>{
 const root=makeRepo({});runInit(root,{harness:'codex'});
 const file=path.join(root,CODEX_SKILL), original=fs.readFileSync(file,'utf8');
 const drift=()=>runValidate(root).warnings.filter(w=>w.type==='skill-drift');
 assert.deepEqual(drift(),[]);
 fs.writeFileSync(file,original.replace(/@([0-9a-f]{7,40})/, '@0000000'));
 assert.ok(drift().some(w=>w.message.includes('differs from pin')));
 fs.writeFileSync(file,original.replace('#workflow-contract@','#missing-heading@'));
 assert.ok(drift().some(w=>w.message.includes('does not match a heading')));
 fs.writeFileSync(file,original);
 const local=path.join(root,'docs/specifications/architecture/codex-integration.md');fs.mkdirSync(path.dirname(local),{recursive:true});
 fs.writeFileSync(local,'---\nid: architecture/codex-integration\ntitle: Local contract\nstatus: draft\n---\n# Different local contract\n');
 assert.ok(drift().some(w=>w.message.includes('does not match a heading')&&!w.message.includes('bundled')));
 const config=structuredClone(DEFAULT_CONFIG);
 config.spec_roots.push({...config.spec_roots[0],name:'other',path:'other-specs'});
 const other=path.join(root,'other-specs/architecture/codex-integration.md');fs.mkdirSync(path.dirname(other),{recursive:true});fs.copyFileSync(local,other);
 assert.ok(checkSkillDrift(config,root).some(w=>w.message.includes('does not resolve')));
});
