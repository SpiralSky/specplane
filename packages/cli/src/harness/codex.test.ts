import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { runInit } from '../commands/init.js';
import { makeRepo } from '../test-repo.js';
import { CODEX_SKILL } from './codex.js';
import { DEFAULT_CONFIG } from '../legacy-config.js';
import { checkSkillDrift } from '../spec/skill-drift.js';
import { runPlan } from '../legacy-plan/run.js';
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
});

test('neutral init suppresses Claude auto-detection and all harness writes',()=>{
 const root=makeRepo({'.claude/settings.json':'{"keep":true}\n'});
 const lines=runInit(root,{harness:'none'});
 assert.ok(lines.some(s=>s.includes('explicitly disabled')));
 assert.equal(fs.readFileSync(path.join(root,'.claude/settings.json'),'utf8'),'{"keep":true}\n');
 assert.equal(fs.existsSync(path.join(root,'.claude/skills')),false);
 assert.equal(fs.existsSync(path.join(root,CODEX_SKILL)),false);
 assert.match(fs.readFileSync(path.join(root,'AGENTS.md'),'utf8'),/explicitly installed Specplane extension/);
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

test('codex install refuses a skill directory escaping the repository',()=>{
 const root=makeRepo({}), outside=fs.mkdtempSync(path.join(os.tmpdir(),'specplane-skill-outside-'));
 try{
  fs.symlinkSync(outside,path.join(root,'.agents'),'dir');
  assert.ok(runInit(root,{harness:'codex'}).some(s=>s.includes('outside the repository')));
  assert.deepEqual(fs.readdirSync(outside),[]);
 }finally{fs.rmSync(outside,{recursive:true,force:true});}
});

