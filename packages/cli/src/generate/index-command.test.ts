import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { capturePlanSnapshot } from './snapshot.js';
import { generatePlansMd } from './plans-md.js';
import { checkPlansMd } from '../commands/validate.js';
const cli = fileURLToPath(new URL('../cli.js', import.meta.url));
const id = '2026-01-01-alpha';
const plan = (title: string, extra = '') => `---\nid: ${id}\ntitle: "${title}"\nstatus: ready\nspecs: [feature/alpha]\n${extra}---\n`;
function repo() {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'index-test-'));
 const git = (...args: string[]) => execFileSync('git', args, {cwd: root, env:{...process.env}, encoding:'utf8', stdio:['ignore','pipe','pipe']}).trim();
 const put = (file: string, text: string) => { const f=path.join(root,file); fs.mkdirSync(path.dirname(f),{recursive:true}); fs.writeFileSync(f,text); };
 const sp = (...args: string[]) => {
  const options = {cwd:root,env:{...process.env},encoding:'utf8' as const,timeout:20000};
  if (fs.existsSync(path.join(root,'bin','gh'))) {
   // Verify the child's environment reaches the fixture before any live PR
   // lookup. A broken launcher can only invoke an ambient gh --version here.
   const log = path.join(root,'gh.log');
   const before = fs.existsSync(log) ? fs.readFileSync(log,'utf8') : '';
   const probe = spawnSync(process.execPath,['-e',"const {execFileSync}=require('node:child_process');process.stdout.write(execFileSync('gh',['--version'],{env:{...process.env},encoding:'utf8'}));"],options);
   assert.ifError(probe.error);
   assert.equal(probe.status,0,probe.stderr);
   const after = fs.existsSync(log) ? fs.readFileSync(log,'utf8') : '';
   assert.equal(after.slice(before.length),'--version\n','CLI child PATH isolation failed; refusing PR queries');
  }
  return spawnSync(process.execPath,[cli,...args],options);
 };
 git('init','-q','-b','master'); git('config','core.autocrlf','false'); git('config','user.name','Test'); git('config','user.email','test@example.com');
 put(`plans/${id}/PLAN.md`,plan('head')); git('add','-A'); git('commit','-qm','base');
 return {root,git,put,sp};
}
test('source selection, notices, print-only, idempotence and migration', () => {
 const r=repo(); const file=`plans/${id}/PLAN.md`;
 r.put(file,plan('staged')); r.git('add',file); r.put(file,plan('working'));
 const before=r.git('status','--porcelain=v1');
 for (const [source,title] of [['head','head'],['staged','staged'],['working','working']]) {
  const result=r.sp('plan','index','--source',source,'--print'); assert.equal(result.status,0,result.stderr); assert.match(result.stdout,new RegExp(`\\| ${title} \\|`)); assert.match(result.stderr,new RegExp(`source: ${source}`)); assert.ok(result.stdout.startsWith('<!-- GENERATED'));
 }
 assert.match(r.sp('plan','index','--print').stderr,/excluded pending inputs/);
 assert.equal(r.git('status','--porcelain=v1'),before); assert.equal(fs.existsSync(path.join(r.root,'plans/PLANS.md')),false);
 assert.notEqual(r.sp('plan','index','--live').status,0); assert.notEqual(r.sp('plan','index','--source','nonsense').status,0);
 const old=r.sp('generate'); assert.notEqual(old.status,0); assert.match(old.stderr,/specplane plan index/);
 const write=r.sp('plan','index'); assert.equal(write.status,0,write.stderr); const output=path.join(r.root,'plans/PLANS.md'); const md=fs.readFileSync(output,'utf8'); assert.match(md,/\| head \|/); const mtime=fs.statSync(output).mtimeMs;
 const repeat=r.sp('plan','index'); assert.equal(repeat.status,0,repeat.stderr); assert.equal(fs.statSync(output).mtimeMs,mtime); assert.equal(fs.readFileSync(output,'utf8'),md); assert.equal(r.git('diff','--cached','--name-only'),file);
});
test('pure captured render uses target declarations and escapes table text', () => {
 const r=repo(); r.put(`plans/${id}/PLAN.md`,plan('A | B','target_branch: release\n')); r.git('add','-A'); r.git('commit','-qm','target');
 const s=capturePlanSnapshot(r.root,'head'); const first=generatePlansMd(s); fs.rmSync(r.root,{recursive:true,force:true});
 assert.equal(generatePlansMd(s),first); assert.match(first,/A \\\| B/); assert.match(first,/\| release \|/);
});
test('live print resolves execution branch and makes no output writes', () => {
 const r=repo(); const sha=r.git('rev-parse','HEAD'); r.git('checkout','-qb',`plan/${id}`);
 r.put(`plans/${id}/PLAN.md`,plan('branch',`execution:\n  target_branch: release\n  start_target_branch: release\n  start_base: ${sha}\n`)); r.git('commit','-qam','binding'); r.git('checkout','-q','master'); r.git('branch','release');
 const before=r.git('status','--porcelain=v1'); const live=r.sp('plan','index','--print','--live'); assert.equal(live.status,0,live.stderr); assert.match(live.stdout,/\| release \|/); assert.match(live.stdout,/\| in_progress \|/); assert.equal(r.git('status','--porcelain=v1'),before); assert.equal(fs.existsSync(path.join(r.root,'plans/PLANS.md')),false);
});
test('staged recovery permits output conflict and refuses unresolved plan input', () => {
 const r=repo(); const f=`plans/${id}/PLAN.md`; r.put('plans/PLANS.md','base\n'); r.git('add','-A'); r.git('commit','-qm','output');
 r.git('checkout','-qb','side'); r.put(f,plan('side')); r.put('plans/PLANS.md','side\n'); r.git('commit','-qam','side');
 r.git('checkout','-q','master'); r.put(f,plan('main')); r.put('plans/PLANS.md','main\n'); r.git('commit','-qam','main');
 try { r.git('merge','side'); } catch { /* expected conflicts */ }
 const refused=r.sp('plan','index','--source','staged'); assert.notEqual(refused.status,0); assert.match(refused.stderr,/Unresolved plan input/);
 r.put(f,plan('resolved')); r.git('add',f); const before=fs.readFileSync(path.join(r.root,'plans/PLANS.md'),'utf8');
 const head=r.sp('plan','index'); assert.notEqual(head.status,0); assert.match(head.stderr,/--source staged/); assert.equal(fs.readFileSync(path.join(r.root,'plans/PLANS.md'),'utf8'),before);
 const staged=r.sp('plan','index','--source','staged'); assert.equal(staged.status,0,staged.stderr); assert.match(fs.readFileSync(path.join(r.root,'plans/PLANS.md'),'utf8'),/\| resolved \|/); assert.match(r.git('ls-files','-u'),/PLANS\.md/);
});
test('freshness compares each selected output and reports source even when fresh', () => {
 const r=repo(), f=`plans/${id}/PLAN.md`, out='plans/PLANS.md';
 fs.mkdirSync(path.join(r.root,'docs/specifications'),{recursive:true});
 r.put(out,generatePlansMd(capturePlanSnapshot(r.root))); r.git('add',out); r.git('commit','-qm','head index');
 r.put(f,plan('staged')); r.git('add',f); const staged=capturePlanSnapshot(r.root,'staged');
 r.put(out,generatePlansMd(staged)); r.git('add',out); r.put(f,plan('working')); r.put(out,'different working output\n');
 const notes:string[]=[];
 for (const source of ['head','staged'] as const) {
  const snap=capturePlanSnapshot(r.root,source); assert.equal(checkPlansMd(snap.config,r.root,snap,n=>notes.push(n)).warnings.length,0);
  assert.equal(snap.outputMode,'100644');
 }
 const working=capturePlanSnapshot(r.root,'working'); assert.equal(checkPlansMd(working.config,r.root,working).warnings.length,1);
 assert.match(notes.join('\n'),/source: head.*excluded pending inputs/); assert.match(notes.join('\n'),/source: staged.*excluded pending inputs/);
 const result=r.sp('validate','--json'); assert.doesNotThrow(()=>JSON.parse(result.stdout)); assert.match(result.stderr,/freshness source: head/);
 r.put('.specplane/config.yaml','plans: [invalid\n');
 const invalid=r.sp('validate','--json'); assert.doesNotThrow(()=>JSON.parse(invalid.stdout)); assert.match(invalid.stderr,/freshness source: head/);
});
for (const kind of ['merge','rebase','cherry-pick'] as const) test(`${kind} recovery uses resolved staged inputs through continuation`, () => {
 const r=repo(), f=`plans/${id}/PLAN.md`, out='plans/PLANS.md', other='other.txt';
 fs.mkdirSync(path.join(r.root,'docs/specifications'),{recursive:true});
 r.put(out,'base\n'); r.put(other,'base\n'); r.git('add','-A'); r.git('commit','-qm','base outputs');
 r.git('checkout','-qb','side'); r.put(f,plan('side')); r.put(out,'side\n'); r.put(other,'side\n'); r.git('commit','-qam','side'); const side=r.git('rev-parse','HEAD');
 r.git('checkout','-q','master'); r.put(f,plan('main')); r.put(out,'main\n'); r.put(other,'main\n'); r.git('commit','-qam','main');
 if (kind === 'rebase') r.git('checkout','-q','side');
 try { if (kind === 'merge') r.git('merge','side'); else if (kind === 'rebase') r.git('rebase','master'); else r.git('cherry-pick',side); } catch { /* expected conflicts */ }
 const bad=r.sp('plan','index','--source','staged'); assert.notEqual(bad.status,0); assert.match(bad.stderr,/Unresolved plan input/);
 const before=fs.readFileSync(path.join(r.root,out)); const index=r.git('ls-files','-u');
 const validation=r.sp('validate','--json'); assert.match(validation.stdout,/Unresolved plan input/); assert.equal(r.git('ls-files','-u'),index); assert.deepEqual(fs.readFileSync(path.join(r.root,out)),before);
 r.put(f,plan('resolved')); r.git('add',f); const input=fs.readFileSync(path.join(r.root,f));
 const refused=r.sp('plan','index'); assert.notEqual(refused.status,0); assert.match(refused.stderr,/--source staged/);
 const pending=r.git('ls-files','-u'); const notice=r.sp('validate','--json'); assert.match(notice.stderr,/freshness source: staged/); assert.match(notice.stdout,/is conflicted/);
 const rendered=r.sp('plan','index','--source','staged'); assert.equal(rendered.status,0,rendered.stderr); const bytes=fs.readFileSync(path.join(r.root,out)); assert.match(bytes.toString(),/\| resolved \|/);
 assert.deepEqual(fs.readFileSync(path.join(r.root,f)),input); assert.equal(r.git('ls-files','-u'),pending);
 r.put(other,'resolved other\n'); r.git('add',out,other);
 if (kind === 'merge') r.git('-c','core.editor=true','commit','-qm','resolved merge'); else r.git('-c','core.editor=true',kind,'--continue');
 const regeneration=r.sp('plan','index'); assert.equal(regeneration.status,0,regeneration.stderr); assert.deepEqual(fs.readFileSync(path.join(r.root,out)),bytes);
});
test('unborn and detached head behavior is explicit', () => {
 const r=repo(); r.git('checkout','--detach','-q'); assert.equal(r.sp('plan','index','--print').status,0);
 r.git('checkout','--orphan','new'); r.git('rm','-rf','.'); r.put(`plans/${id}/PLAN.md`,plan('new')); r.git('add','-A');
 const head=r.sp('plan','index','--print'); assert.notEqual(head.status,0); assert.match(head.stderr,/Unborn HEAD/);
 const staged=r.sp('plan','index','--source','staged','--print'); assert.equal(staged.status,0,staged.stderr); assert.match(staged.stdout,/\| new \|/);
});
test('live status reads authoritative target and queries PR with its recorded base', () => {
 const r=repo(); const sha=r.git('rev-parse','HEAD'); r.git('branch','release'); r.git('checkout','-qb',`plan/${id}`);
 r.put(`plans/${id}/PLAN.md`,plan('branch',`execution:\n  target_branch: release\n  start_target_branch: release\n  start_base: ${sha}\n`)); r.git('commit','-qam','binding');
 r.git('checkout','-q','release'); r.git('remote','add','origin','https://github.com/example/repo.git');
 const bin=path.join(r.root,'bin'); fs.mkdirSync(bin); const log=path.join(r.root,'gh.log');
 fs.writeFileSync(path.join(bin,'gh'),`#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nif [ "$1" = '--version' ]; then echo 'gh version'; else echo '[{"url":"https://example.test/pr"}]'; fi\n`,{mode:0o755});
 const previous=process.env.PATH; process.env.PATH=`${bin}:${previous}`;
 try {
  const review=r.sp('plan','index','--print','--live'); assert.equal(review.status,0,review.stderr); assert.match(review.stdout,/\| review \| release \|/); assert.match(fs.readFileSync(log,'utf8'),/--base release/);
  r.put(`plans/${id}/PLAN.md`,plan('shelved').replace('status: ready','status: shelved\nshelved_from: ready')); r.git('commit','-qam','shelve'); r.git('checkout','-q',`plan/${id}`);
  const shelved=r.sp('plan','index','--source','head','--print','--live'); assert.equal(shelved.status,0,shelved.stderr); assert.match(shelved.stdout,/\| shelved \| release \|/);
  r.git('checkout','-q','release'); r.put(`plans/${id}/PLAN.md`,plan('abandoned').replace('status: ready','status: abandoned')); r.git('commit','-qam','abandon'); r.git('checkout','-q',`plan/${id}`);
  const abandoned=r.sp('plan','index','--print','--live'); assert.equal(abandoned.status,0,abandoned.stderr); assert.match(abandoned.stdout,/\| abandoned \| release \|/);
 } finally { process.env.PATH=previous; }
});

test('live frontmatter uses execution status and target terminal overrides', () => {
 const r=repo(); const file=`plans/${id}/PLAN.md`;
 r.put('.specplane/config.yaml','plans:\n  status_source: frontmatter\n'); r.git('add','-A'); r.git('commit','-qm','config');
 const sha=r.git('rev-parse','HEAD'); r.git('checkout','-qb',`plan/${id}`);
 const binding=`execution:\n  target_branch: master\n  start_target_branch: master\n  start_base: ${sha}\n`;
 for (const status of ['review','done']) {
  r.put(file,plan('execution',binding).replace('status: ready',`status: ${status}`)); r.git('commit','-qam',status);
  const result=r.sp('plan','index','--print','--live'); assert.equal(result.status,0,result.stderr); assert.match(result.stdout,new RegExp(`\\| ${status} \\| master \\|`));
 }
 r.git('checkout','-q','master');
 for (const [status,extra] of [['shelved','shelved_from: review\n'],['abandoned',''],['done','']]) {
  r.put(file,plan('target',extra).replace('status: ready',`status: ${status}`)); r.git('commit','-qam',status);
  const result=r.sp('plan','index','--print','--live'); assert.equal(result.status,0,result.stderr); assert.match(result.stdout,new RegExp(`\\| ${status} \\| master \\|`));
 }
});

test('live target dependencies and config block before querying a PR in both status modes', () => {
 for (const mode of ['git','frontmatter']) {
  const r=repo(); const file=`plans/${id}/PLAN.md`, dep='2026-01-01-dep';
  r.put('.specplane/config.yaml',`plans:\n  status_source: ${mode}\n  dependency_mode: wait_for_merge\n`);
  r.put(`plans/${dep}/PLAN.md`,plan('dependency').replaceAll(id,dep));
  r.put(file,plan('target',`depends_on: [${dep}]\n`)); r.git('add','-A'); r.git('commit','-qm','target');
  const sha=r.git('rev-parse','HEAD'); r.git('checkout','-qb',`plan/${id}`);
  r.put(file,plan('execution',`execution:\n  target_branch: master\n  start_target_branch: master\n  start_base: ${sha}\n`)); r.git('commit','-qam','execution');
  const result=r.sp('plan','index','--print','--live'); assert.equal(result.status,0,result.stderr); assert.match(result.stdout,/\| blocked \| master \|/);
 }
});

test('live discovers local and fetched remote branch-only records in plan ID order', () => {
 for (const remote of [false,true]) {
  const r=repo(); const earlier='2025-12-31-earlier', later='2026-01-02-later';
  r.git('checkout','-qb','release'); r.put('.specplane/config.yaml','plans:\n  status_source: frontmatter\n');
  for (const other of [earlier,later]) r.put(`plans/${other}/PLAN.md`,plan('target only').replaceAll(id,other));
  r.git('add','-A'); r.git('commit','-qm','target'); const sha=r.git('rev-parse','HEAD');
  for (const other of [earlier,later]) {
   r.git('checkout','-qb',`plan/${other}`,'release');
   r.put(`plans/${other}/PLAN.md`,plan(other,`execution:\n  target_branch: release\n  start_target_branch: release\n  start_base: ${sha}\n`).replaceAll(id,other).replace('status: ready','status: review')); r.git('commit','-qam','execution');
  }
  r.git('checkout','-q','master'); if (remote) for (const other of [earlier,later]) { r.git('update-ref',`refs/remotes/origin/plan/${other}`,r.git('rev-parse',`plan/${other}`)); r.git('branch','-D',`plan/${other}`); }
  const before=r.git('status','--porcelain=v1'), refs=r.git('show-ref'), head=r.git('rev-parse','HEAD'), headRef=r.git('symbolic-ref','HEAD');
  const result=r.sp('plan','index','--print','--live'); assert.equal(result.status,0,result.stderr);
  const rows=result.stdout.split('\n').filter(line => line.startsWith('| [')).map(line => line.match(/^\| \[([^\]]+)\]/)![1]);
  assert.deepEqual(rows,[earlier,id,later]); assert.match(result.stdout,/\| review \| release \|/);
  assert.equal(r.git('status','--porcelain=v1'),before); assert.equal(r.git('show-ref'),refs); assert.equal(r.git('rev-parse','HEAD'),head); assert.equal(r.git('symbolic-ref','HEAD'),headRef); assert.equal(fs.existsSync(path.join(r.root,'plans/PLANS.md')),false);
  const ordinary=r.sp('plan','index','--print'); assert.equal(ordinary.status,0,ordinary.stderr); assert.doesNotMatch(ordinary.stdout,/earlier|later/);
 }
});

test('live refuses missing target and incompatible branch bindings without stdout or mutations', () => {
 for (const kind of ['missing','invalid','divergent']) {
  const r=repo(); const file=`plans/${id}/PLAN.md`, sha=r.git('rev-parse','HEAD'); r.git('checkout','-qb',`plan/${id}`);
  const target=kind==='missing'?'missing':'master';
  r.put(file,plan('branch',`execution:\n  target_branch: ${target}\n  start_target_branch: ${target}\n  start_base: ${kind==='invalid'?'not-a-sha':sha}\n`)); r.git('commit','-qam','branch');
  if (kind==='divergent') { r.git('update-ref',`refs/remotes/origin/plan/${id}`,r.git('rev-parse','HEAD')); r.git('checkout','-q','master'); r.git('checkout','-qb','other'); r.put(file,plan('other',`execution:\n  target_branch: master\n  start_target_branch: master\n  start_base: ${sha}\n`)); r.git('commit','-qam','other'); r.git('branch','-f',`plan/${id}`,'HEAD'); }
  r.git('checkout','-q','master'); const before=r.git('status','--porcelain=v1'), refs=r.git('show-ref'), head=r.git('rev-parse','HEAD'), headRef=r.git('symbolic-ref','HEAD'); const result=r.sp('plan','index','--print','--live'); assert.notEqual(result.status,0,kind); assert.equal(result.stdout,'',kind); assert.notEqual(result.stderr,''); assert.equal(r.git('status','--porcelain=v1'),before); assert.equal(r.git('show-ref'),refs); assert.equal(r.git('rev-parse','HEAD'),head); assert.equal(r.git('symbolic-ref','HEAD'),headRef); assert.equal(fs.existsSync(path.join(r.root,'plans/PLANS.md')),false);
 }
});

test('live PR lookup uses recorded base and ignores PRs to another base', () => {
 const r=repo(); const sha=r.git('rev-parse','HEAD'); r.git('branch','release'); r.git('checkout','-qb',`plan/${id}`);
 r.put(`plans/${id}/PLAN.md`,plan('branch',`execution:\n  target_branch: release\n  start_target_branch: release\n  start_base: ${sha}\n`)); r.git('commit','-qam','branch'); r.git('checkout','-q','master'); r.git('remote','add','origin','https://github.com/example/repo.git');
 const bin=path.join(r.root,'bin'); fs.mkdirSync(bin); const log=path.join(r.root,'gh.log');
 fs.writeFileSync(path.join(bin,'gh'),`#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\ncase "$*" in *'--base wrong'*) echo '[{"url":"https://example.test/pr"}]';; *'--version'*) echo 'gh version';; *) echo '[]';; esac\n`,{mode:0o755});
 const previous=process.env.PATH; process.env.PATH=`${bin}:${previous}`;
 try { const result=r.sp('plan','index','--print','--live'); assert.equal(result.status,0,result.stderr); assert.match(result.stdout,/\| in_progress \| release \|/); assert.match(fs.readFileSync(log,'utf8'),/--base release/); } finally { process.env.PATH=previous; }
});

test('live unstarted routing respects the selected staged and working declarations', () => {
 const r=repo(); const file=`plans/${id}/PLAN.md`; r.git('branch','release'); r.git('branch','other');
 r.put(file,plan('staged','target_branch: release\n')); r.git('add',file); r.put(file,plan('working','target_branch: other\n'));
 for (const [source,target] of [['staged','release'],['working','other']]) {
  const result=r.sp('plan','index','--source',source,'--print','--live'); assert.equal(result.status,0,result.stderr); assert.match(result.stdout,new RegExp(`\\| ${source} \\| ready \\| ${target} \\|`));
 }
});

test('live refuses branch config path conflicts', () => {
 const r=repo(); const sha=r.git('rev-parse','HEAD'); r.git('checkout','-qb',`plan/${id}`);
 r.put('.specplane/config.yaml','plans:\n  dir: alternate\n'); r.put(`alternate/${id}/PLAN.md`,plan('alternate',`execution:\n  target_branch: master\n  start_target_branch: master\n  start_base: ${sha}\n`)); r.git('add','-A'); r.git('commit','-qm','alternate'); r.git('checkout','-q','master');
 const before=r.git('status','--porcelain=v1'); const result=r.sp('plan','index','--print','--live'); assert.notEqual(result.status,0); assert.equal(result.stdout,''); assert.match(result.stderr,/Conflicting plan or specification path/); assert.equal(r.git('status','--porcelain=v1'),before);
});

test('live renderer refuses incomplete status context', () => {
 const r=repo(); const snapshot=capturePlanSnapshot(r.root,'head');
 assert.throws(() => generatePlansMd(snapshot,{live:true,liveContext:{statuses:new Map(),targets:new Map([[id,'master']])}}),/Live status unavailable/);
 assert.throws(() => generatePlansMd(snapshot,{live:true,liveContext:{statuses:new Map([[id,'ready']]),targets:new Map()}}),/Live target unavailable/);
});

test('renderer sorts archived records without changing captured inputs', () => {
 const r=repo(); const snapshot=capturePlanSnapshot(r.root,'head');
 const captured=snapshot.plans.map(file => [file.path,file.bytes.toString('hex')]); const digest=snapshot.digest;
 const fm = { id, title:'archive', status:'done', specs:['feature/alpha'] } as const;
 const early='2025-12-31-earlier', late='2026-01-02-later';
 const records=[{id:late,archived:true,fm:{...fm,id:late,specs:[...fm.specs]}},{id:early,archived:true,fm:{...fm,id:early,specs:[...fm.specs]}}];
 const statuses=new Map([[id,'ready' as const],[early,'done' as const],[late,'done' as const]]), targets=new Map([[id,'master'],[early,'master'],[late,'master']]);
 const output=generatePlansMd(snapshot,{live:true,liveContext:{statuses,targets,additionalRecords:records}});
 const archived=output.split('## Archived plans')[1].split('## Dependency graph')[0];
 assert.ok(archived.indexOf(early) < archived.indexOf(late)); assert.deepEqual(records.map(r => r.id),[late,early]);
 assert.equal(snapshot.digest,digest); assert.deepEqual(snapshot.plans.map(file => [file.path,file.bytes.toString('hex')]),captured);
});
