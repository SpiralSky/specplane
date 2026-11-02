import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { retargetFrontmatter, retargetPlan } from './retarget.js';
import { acquireWriterLease } from '../core/writer-leases.js';
import { executeOperation } from '../core/index.js';
import { lifecycleContext, refusePendingRetarget } from './lifecycle-context.js';
import { firstStart } from './first-start.js';
import { loadConfig } from '../config.js';
const id = '2026-11-02-example';
function fixture() {
 const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'retarget-'));
 const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 }).trim();
 const put = (p: string, s: string) => { const f = path.join(cwd, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
 git('init', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com');
 put('.specplane/config.yaml', 'plans:\n  dependency_mode: stack\n');
 put(`plans/${id}/PLAN.md`, `---\nid: ${id}\ntitle: Example\nstatus: ready\nspecs: [feature/example]\n---\nBody\n`);
 put('docs/specifications/features/example.md', '---\nid: feature/example\ntitle: Example\nauthor: user\nstatus: approved\n---\nApproved\n');
 put('implementation', 'original'); git('add', '.'); git('commit', '-m', 'base'); const base = git('rev-parse', 'HEAD'); git('branch', 'candidate'); git('switch', '-c', `plan/${id}`);
 put(`plans/${id}/PLAN.md`, `---\nid: ${id}\ntitle: Example\nstatus: ready\nspecs: [feature/example]\nexecution:\n  target_branch: main\n  start_target_branch: main\n  start_base: ${base}\n---\nBody\n`); git('commit', '-am', 'bind');
 return { cwd, git, put, base, file: path.join(cwd, `plans/${id}/PLAN.md`), cleanup: () => fs.rmSync(cwd, { recursive: true, force: true }) };
}
test('preview and core update preserve provenance and unrelated changes', () => {
 const f = fixture(); try {
 f.put('implementation', 'staged'); f.git('add', 'implementation'); f.put('implementation', 'dirty');
 const head = f.git('rev-parse', 'HEAD'), status = f.git('status', '--porcelain');
 const preview = retargetPlan({ id, target: 'candidate', dryRun: true }, f.cwd);
 const cli = JSON.parse(execFileSync(process.execPath, [path.resolve('dist/cli.js'), 'plan', 'retarget', id, '--target', 'candidate', '--dry-run', '--json'], { cwd: f.cwd, encoding: 'utf8', timeout: 10000 }));
 const human = execFileSync(process.execPath, [path.resolve('dist/cli.js'), 'plan', 'retarget', id, '--target', 'candidate', '--dry-run'], { cwd: f.cwd, encoding: 'utf8', timeout: 10000 });
 assert.match(human, new RegExp(`Original start: main at ${f.base}`)); assert.match(human, /Comparison baseline: \(none\)/); assert.match(human, new RegExp(`plans/${id}/PLAN.md`)); assert.match(human, /Refs may change/);
 assert.deepEqual(cli, preview);
 assert.equal(preview.changed, true); assert.equal(preview.committed, false); assert.equal(f.git('status', '--porcelain'), status);
 const result = executeOperation({ operation: 'plan.retarget', arguments: { id, target: 'candidate' } }, { checkout: f.cwd, extensionId: 'test' }); assert.equal(result.ok, true, JSON.stringify(result));
 if (!result.ok) return; assert.deepEqual(result.value.changed_files, preview.changed_files); assert.equal(result.value.start_base, f.base);
 assert.match(fs.readFileSync(f.file, 'utf8'), /start_target_branch: main/); assert.match(fs.readFileSync(f.file, 'utf8'), /Body\n$/);
 assert.equal(f.git('rev-parse', 'HEAD'), head); assert.equal(f.git('show', ':implementation'), 'staged'); assert.equal(fs.readFileSync(path.join(f.cwd, 'implementation'), 'utf8'), 'dirty');
 assert.throws(() => refusePendingRetarget(id, loadConfig(f.cwd).config, f.cwd), /Pending retarget/);
 assert.throws(() => firstStart(id, loadConfig(f.cwd).config, f.cwd, { dryRun: true }), /Pending retarget/);
 assert.throws(() => lifecycleContext(id, loadConfig(f.cwd).config, f.cwd), /Pending retarget/);
 for (const args of [['next', id], ['step-done', id, '--outcome', 'done', '--summary', 'test']]) assert.throws(() => execFileSync(process.execPath, [path.resolve('dist/cli.js'), 'plan', ...args], { cwd: f.cwd, encoding: 'utf8', stdio: 'pipe', timeout: 10000 }), /Pending retarget/);
 f.git('add', f.file); f.git('commit', '-m', 'retarget'); assert.equal(retargetPlan({ id, target: 'candidate', dryRun: true }, f.cwd).changed, false);
 const noop = execFileSync(process.execPath, [path.resolve('dist/cli.js'), 'plan', 'retarget', id, '--target', 'candidate', '--dry-run'], { cwd: f.cwd, encoding: 'utf8', timeout: 10000 }); assert.match(noop, /unchanged/); assert.match(noop, /Changed paths: \(none\)/); assert.match(noop, /Refs may change/);
 retargetPlan({ id, target: 'main' }, f.cwd); const history = fs.readFileSync(f.file, 'utf8');
 assert.match(history, /from: "main"\n\s+to: "candidate"\n\s+- from: "candidate"\n\s+to: "main"/);
 } finally { f.cleanup(); }
});
test('captured target ref changing before validation refuses without a write', () => {
 const f = fixture(); try {
  const original = fs.readFileSync(f.file); const index = fs.readFileSync(path.join(f.cwd, '.git/index'));
  assert.throws(() => retargetPlan({ id, target: 'candidate' }, f.cwd, { afterTargetCapture: () => f.git('update-ref', 'refs/heads/candidate', f.git('rev-parse', 'HEAD')) }), /changed/);
  assert.deepEqual(fs.readFileSync(f.file), original); assert.deepEqual(fs.readFileSync(path.join(f.cwd, '.git/index')), index);
 } finally { f.cleanup(); }
});
test('explicit GitHub requires origin for preview and update', () => {
 const f = fixture(); try {
  f.put('.specplane/config.yaml', 'plans:\n  dependency_mode: stack\n  forge: github\n'); f.git('commit', '-am', 'require github');
  const original = fs.readFileSync(f.file); const status = f.git('status', '--porcelain');
  for (const dryRun of [true, false]) assert.throws(() => retargetPlan({ id, target: 'candidate', dryRun }, f.cwd), /forge evidence/);
  assert.deepEqual(fs.readFileSync(f.file), original); assert.equal(f.git('status', '--porcelain'), status);
 } finally { f.cleanup(); }
});
test('local bare origin needs no forge evidence when forge is none', () => {
 const f = fixture(); const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'retarget-bare-')); try {
  execFileSync('git', ['init', '--bare', bare], { stdio: 'ignore', timeout: 5000 }); f.git('remote', 'add', 'origin', bare);
  f.put('.specplane/config.yaml', 'plans:\n  dependency_mode: stack\n  forge: none\n'); f.git('commit', '-am', 'disable forge');
  assert.equal(retargetPlan({ id, target: 'candidate', dryRun: true }, f.cwd).changed, true); assert.equal(retargetPlan({ id, target: 'candidate' }, f.cwd).changed, true);
 } finally { fs.rmSync(bare, { recursive: true, force: true }); f.cleanup(); }
});
test('forge evidence is scoped to origin and rechecked before writing', () => {
 const f = fixture(); const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-gh-')); const oldPath = process.env.PATH; const oldRepo = process.env.GH_REPO;
 try {
  const evidence = path.join(bin, 'evidence'); const args = path.join(bin, 'args');
  fs.writeFileSync(evidence, '[]'); fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\nprintf '%s\\n' "$@" > '${args}'\ncat '${evidence}'\n`, { mode: 0o755 });
  process.env.PATH = `${bin}:${oldPath}`; process.env.GH_REPO = 'wrong/other'; f.git('remote', 'add', 'origin', 'https://github.com/example/repo.git');
  const original = fs.readFileSync(f.file);
  assert.throws(() => retargetPlan({ id, target: 'candidate' }, f.cwd, { beforeRecheck: () => fs.writeFileSync(evidence, '[{"url":"x","baseRefName":"main"}]') }), /base conflicts/);
  assert.match(fs.readFileSync(args, 'utf8'), /--repo\ngithub\.com\/example\/repo\n/); assert.deepEqual(fs.readFileSync(f.file), original);
 } finally { process.env.PATH = oldPath; if (oldRepo === undefined) delete process.env.GH_REPO; else process.env.GH_REPO = oldRepo; fs.rmSync(bin, { recursive: true, force: true }); f.cleanup(); }
});
test('staged administrative changes and recovery markers refuse', () => {
 const f = fixture(); try {
  const original = fs.readFileSync(f.file); f.put(`plans/${id}/HANDOFF.md`, 'staged'); f.git('add', `plans/${id}/HANDOFF.md`);
  const index = fs.readFileSync(path.join(f.cwd, '.git/index')); assert.throws(() => retargetPlan({ id, target: 'candidate' }, f.cwd), /dirty/); assert.deepEqual(fs.readFileSync(path.join(f.cwd, '.git/index')), index); assert.deepEqual(fs.readFileSync(f.file), original);
  f.git('reset', '--', `plans/${id}/HANDOFF.md`); fs.unlinkSync(path.join(f.cwd, `plans/${id}/HANDOFF.md`));
  const marker = path.join(f.cwd, '.git/MERGE_HEAD'); fs.writeFileSync(marker, f.base + '\n');
  assert.throws(() => retargetPlan({ id, target: 'candidate', dryRun: true }, f.cwd), /mutation/); assert.equal(fs.readFileSync(marker, 'utf8'), f.base + '\n'); assert.deepEqual(fs.readFileSync(f.file), original);
 } finally { f.cleanup(); }
});
test('preview preserves private runtime and index bytes', () => {
 const f = fixture(); try {
  const runtime = path.join(f.cwd, '.git/specplane-runtime'); fs.mkdirSync(runtime); fs.writeFileSync(path.join(runtime, 'recovery-note'), 'retain');
  const index = fs.readFileSync(path.join(f.cwd, '.git/index')); const plan = fs.readFileSync(f.file);
  retargetPlan({ id, target: 'candidate', dryRun: true }, f.cwd);
  assert.deepEqual(fs.readdirSync(runtime), ['recovery-note']); assert.equal(fs.readFileSync(path.join(runtime, 'recovery-note'), 'utf8'), 'retain'); assert.deepEqual(fs.readFileSync(path.join(f.cwd, '.git/index')), index); assert.deepEqual(fs.readFileSync(f.file), plan);
 } finally { f.cleanup(); }
});
test('active lease, dirty recording and ref races refuse without writes', () => {
 const f = fixture(); try {
 const original = fs.readFileSync(f.file, 'utf8'); const lease = acquireWriterLease({ repository: true, plans: [id], checkouts: [f.cwd], requestId: 'test' });
 assert.throws(() => retargetPlan({ id, target: 'candidate', dryRun: true }, f.cwd), /lease/); lease.release();
 f.put(`plans/${id}/HANDOFF.md`, 'pending'); assert.throws(() => retargetPlan({ id, target: 'candidate' }, f.cwd), /dirty/); fs.unlinkSync(path.join(f.cwd, `plans/${id}/HANDOFF.md`));
 assert.throws(() => retargetPlan({ id, target: 'candidate' }, f.cwd, { beforeRecheck: () => f.git('update-ref', 'refs/heads/candidate', f.git('rev-parse', 'HEAD')) }), /changed/);
 assert.equal(fs.readFileSync(f.file, 'utf8'), original);
 } finally { f.cleanup(); }
});
test('unavailable forge evidence refuses', () => {
 const f = fixture(); try { f.git('remote', 'add', 'origin', 'https://example.invalid/repo.git'); assert.throws(() => retargetPlan({ id, target: 'candidate', dryRun: true }, f.cwd), /forge evidence/); } finally { f.cleanup(); }
});
test('wrong pull request base and unavailable gh evidence refuse', () => {
 const f = fixture(); const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-gh-')); const oldPath = process.env.PATH;
 try {
  fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\nprintf \'[{"url":"https://example/pr/1","baseRefName":"main"}]\'\n', { mode: 0o755 });
  process.env.PATH = `${bin}:${oldPath}`; f.git('remote', 'add', 'origin', 'https://github.com/example/repo.git');
  assert.throws(() => retargetPlan({ id, target: 'candidate', dryRun: true }, f.cwd), /base conflicts/);
  fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  assert.throws(() => retargetPlan({ id, target: 'candidate' }, f.cwd), /forge evidence/);
 } finally { process.env.PATH = oldPath; fs.rmSync(bin, { recursive: true, force: true }); f.cleanup(); }
});
test('changed recording preimage and lifecycle conflicts refuse', () => {
 const f = fixture(); try {
  const original = fs.readFileSync(f.file, 'utf8');
  assert.throws(() => retargetPlan({ id, target: 'candidate' }, f.cwd, { beforeRecheck: () => f.put(`plans/${id}/PLAN.md`, original + 'external\n') }), /preimage changed/);
  assert.equal(fs.readFileSync(f.file, 'utf8'), original + 'external\n'); f.put(`plans/${id}/PLAN.md`, original);
  f.git('switch', 'candidate'); const target = fs.readFileSync(f.file, 'utf8'); f.put(`plans/${id}/PLAN.md`, target.replace('status: ready', 'status: abandoned')); f.git('commit', '-am', 'abandon'); f.git('switch', `plan/${id}`);
  assert.throws(() => retargetPlan({ id, target: 'candidate', dryRun: true }, f.cwd), /lifecycle/);
 } finally { f.cleanup(); }
});
test('git mode permits active migration states and refuses draft and terminal states', () => {
 const f = fixture(); try {
  for (const [branch, status] of [['candidate', 'in_progress'], ['main', 'review'], [`plan/${id}`, 'review']]) {
   f.git('switch', branch); f.put(`plans/${id}/PLAN.md`, fs.readFileSync(f.file, 'utf8').replace('status: ready', `status: ${status}`)); f.git('commit', '-am', `status ${status}`);
  }
  assert.equal(retargetPlan({ id, target: 'candidate', dryRun: true }, f.cwd).changed, true);
  for (const status of ['draft', 'shelved', 'abandoned', 'done']) {
   f.git('switch', 'candidate'); f.put(`plans/${id}/PLAN.md`, fs.readFileSync(f.file, 'utf8').replace(/status: \w+/, `status: ${status}`)); f.git('commit', '-am', `status ${status}`); f.git('switch', `plan/${id}`);
   assert.throws(() => retargetPlan({ id, target: 'candidate', dryRun: true }, f.cwd), status === 'shelved' ? /Invalid plan record/ : /lifecycle/);
  }
 } finally { f.cleanup(); }
});
test('ref changed during final forge query refuses without writing', () => {
 const f = fixture(); const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-gh-')); const oldPath = process.env.PATH;
 try {
  const count = path.join(bin, 'count');
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\nn=0\n[ ! -f '${count}' ] || n=$(cat '${count}')\nn=$((n+1))\nprintf '%s' "$n" > '${count}'\nif [ "$n" -eq 3 ]; then git update-ref refs/heads/candidate '${f.git('rev-parse', 'HEAD')}'; fi\nprintf '[]'\n`, { mode: 0o755 });
  process.env.PATH = `${bin}:${oldPath}`; f.git('remote', 'add', 'origin', 'https://github.com/example/repo.git');
  const original = fs.readFileSync(f.file); const index = fs.readFileSync(path.join(f.cwd, '.git/index'));
  assert.throws(() => retargetPlan({ id, target: 'candidate' }, f.cwd), /Ref .* changed/);
  assert.equal(fs.readFileSync(count, 'utf8'), '3'); assert.deepEqual(fs.readFileSync(f.file), original); assert.deepEqual(fs.readFileSync(path.join(f.cwd, '.git/index')), index);
 } finally { process.env.PATH = oldPath; fs.rmSync(bin, { recursive: true, force: true }); f.cleanup(); }
});
test('unfinished cross-target stack refuses', () => {
 const f = fixture(); try {
  const dep = '2026-11-02-base'; const planText = fs.readFileSync(f.file, 'utf8').replace('specs: [feature/example]', `specs: [feature/example]\ndepends_on: [${dep}]`);
  f.put(`plans/${id}/PLAN.md`, planText); f.git('commit', '-am', 'add dependency');
  for (const b of ['main', 'candidate']) { f.git('switch', b); const p = fs.readFileSync(f.file, 'utf8').replace('specs: [feature/example]', `specs: [feature/example]\ndepends_on: [${dep}]`); f.put(`plans/${id}/PLAN.md`, p); f.put(`plans/${dep}/PLAN.md`, `---\nid: ${dep}\ntitle: Base\nstatus: ready\nspecs: [feature/example]\n---\n`); f.git('add', '.'); f.git('commit', '-m', 'add dependency'); }
  f.git('switch', 'main'); f.git('switch', '-c', `plan/${dep}`); f.put(`plans/${dep}/PLAN.md`, `---\nid: ${dep}\ntitle: Base\nstatus: ready\nspecs: [feature/example]\nexecution:\n  target_branch: main\n  start_target_branch: main\n  start_base: ${f.base}\n---\n`); f.git('commit', '-am', 'bind dependency'); f.git('switch', `plan/${id}`);
  assert.throws(() => retargetPlan({ id, target: 'candidate', dryRun: true }, f.cwd), /compatible recorded target/);
 } finally { f.cleanup(); }
});
test('missing old branch requires independent historical identity', () => {
 const f = fixture(); try { f.git('branch', '-D', 'main'); assert.equal(retargetPlan({ id, target: 'candidate', dryRun: true }, f.cwd).changed, true); } finally { f.cleanup(); }
});
test('retarget preserves the comparison base alongside starting provenance', () => {
 const f = fixture(); try {
  for (const branch of [`plan/${id}`, 'main', 'candidate']) {
   if (f.git('branch', '--show-current') !== branch) f.git('switch', branch);
   f.put(`plans/${id}/PLAN.md`, fs.readFileSync(f.file, 'utf8').replace('specs: [feature/example]', `specs: [feature/example]\ncomparison_base: ${f.base}`));
   f.git('commit', '-am', 'record comparison');
  }
  f.git('switch', `plan/${id}`); const receipt = retargetPlan({ id, target: 'candidate' }, f.cwd);
  assert.equal(receipt.comparison_base, f.base); assert.equal(receipt.start_base, f.base);
  assert.match(fs.readFileSync(f.file, 'utf8'), new RegExp(`comparison_base: ${f.base}`));
 } finally { f.cleanup(); }
});
test('preserves inline metadata comments and an empty target history', () => {
 const f = fixture(); try {
  let text = fs.readFileSync(f.file, 'utf8').replace('  target_branch: main', '  target_branch: main # destination').replace(`  start_base: ${f.base}`, `  start_base: ${f.base}\n  target_changes: [] # history`);
  f.put(`plans/${id}/PLAN.md`, text); f.git('commit', '-am', 'add comments'); retargetPlan({ id, target: 'candidate' }, f.cwd);
  text = fs.readFileSync(f.file, 'utf8'); assert.match(text, /target_branch: "candidate" # destination/); assert.match(text, /target_changes: # history/); assert.match(text, /start_target_branch: main/);
 } finally { f.cleanup(); }
});
test('preserves CRLF, BOM, comments and body bytes', () => {
 const input = `\uFEFF---\r\nid: ${id}\r\ntitle: Example\r\nstatus: ready\r\nspecs: [feature/example]\r\nexecution:\r\n  target_branch: main # current\r\n  start_target_branch: main\r\n  start_base: ${'a'.repeat(40)}\r\n---\r\nBody\nwith mixed body endings\r\n`;
 const result = retargetFrontmatter(input, 'main', 'candidate');
 assert.match(result, /^\uFEFF---\r\n/); assert.match(result, /target_branch: "candidate" # current\r\n/); assert.ok(result.endsWith('---\r\nBody\nwith mixed body endings\r\n'));
});
test('preserves flow binding source and appends to its history', () => {
 const input = `---\nid: ${id}\ntitle: Example\nstatus: ready\nspecs: [feature/example]\ntarget_branch: main # declaration\nexecution: {target_branch: main, start_target_branch: main, start_base: ${'a'.repeat(40)}, target_changes: []}\n---\nBody\n`;
 const first = retargetFrontmatter(input, 'main', 'candidate');
 assert.match(first, /target_branch: "candidate" # declaration/); assert.match(first, /start_target_branch: main/); assert.match(first, /target_changes: \[\{from: "main", to: "candidate"\}\]/);
 const second = retargetFrontmatter(first, 'candidate', 'release'); assert.match(second, /\{from: "main", to: "candidate"\}, \{from: "candidate", to: "release"\}/); assert.ok(second.endsWith('---\nBody\n'));
});
test('appends a flow history in a block binding', () => {
 const input = `---\nid: ${id}\ntitle: Example\nstatus: ready\nspecs: [feature/example]\nexecution:\n  target_branch: candidate # current\n  start_target_branch: main\n  start_base: ${'a'.repeat(40)}\n  target_changes: [{from: main, to: candidate}] # prior\n---\nBody\n`;
 const output = retargetFrontmatter(input, 'candidate', 'release');
 assert.match(output, /target_changes: \[\{from: main, to: candidate\}, \{from: "candidate", to: "release"\}\] # prior/);
 assert.match(output, /start_target_branch: main/);
 assert.match(output, /target_branch: "release" # current/);
});

test('finish and restack contexts permit migrated active states and reject inactive states', () => {
 const f = fixture(); try {
  f.git('switch', 'main'); f.put(`plans/${id}/PLAN.md`, fs.readFileSync(f.file, 'utf8').replace('status: ready', 'status: in_progress')); f.git('commit', '-am', 'migrated target'); f.git('switch', `plan/${id}`);
  for (const status of ['review', 'in_progress', 'ready', 'draft', 'shelved', 'abandoned']) {
   f.put(`plans/${id}/PLAN.md`, fs.readFileSync(f.file, 'utf8').replace(/status: \w+/, `status: ${status}`)); f.git('commit', '-am', `branch ${status}`);
   for (const operation of ['finish', 'restack'] as const) {
    if (['ready', 'in_progress', 'review'].includes(status)) assert.equal(lifecycleContext(id, loadConfig(f.cwd).config, f.cwd, operation).plan.status, status);
    else assert.throws(() => lifecycleContext(id, loadConfig(f.cwd).config, f.cwd, operation), status === 'shelved' ? /Invalid plan record/ : /not executable/);
   }
  }
  f.put(`plans/${id}/PLAN.md`, fs.readFileSync(f.file, 'utf8').replace('status: abandoned', 'status: done')); f.git('commit', '-am', 'done');
  assert.equal(lifecycleContext(id, loadConfig(f.cwd).config, f.cwd, 'finish').plan.status, 'done');
  assert.throws(() => lifecycleContext(id, loadConfig(f.cwd).config, f.cwd, 'restack'), /not executable/);
 } finally { f.cleanup(); }
});
