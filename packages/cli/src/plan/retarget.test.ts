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
 assert.deepEqual(cli, preview);
 assert.equal(preview.changed, true); assert.equal(preview.committed, false); assert.equal(f.git('status', '--porcelain'), status);
 const result = executeOperation({ operation: 'plan.retarget', arguments: { id, target: 'candidate' } }, { checkout: f.cwd, extensionId: 'test' }); assert.equal(result.ok, true, JSON.stringify(result));
 if (!result.ok) return; assert.deepEqual(result.value.changed_files, preview.changed_files); assert.equal(result.value.start_base, f.base);
 assert.match(fs.readFileSync(f.file, 'utf8'), /start_target_branch: main/); assert.match(fs.readFileSync(f.file, 'utf8'), /Body\n$/);
 assert.equal(f.git('rev-parse', 'HEAD'), head); assert.equal(f.git('show', ':implementation'), 'staged'); assert.equal(fs.readFileSync(path.join(f.cwd, 'implementation'), 'utf8'), 'dirty');
 assert.throws(() => refusePendingRetarget(id, loadConfig(f.cwd).config, f.cwd), /Pending retarget/);
 assert.throws(() => firstStart(id, loadConfig(f.cwd).config, f.cwd, { dryRun: true }), /Pending retarget/);
 assert.throws(() => lifecycleContext(id, loadConfig(f.cwd).config, f.cwd), /Pending retarget/);
 f.git('add', f.file); f.git('commit', '-m', 'retarget'); assert.equal(retargetPlan({ id, target: 'candidate', dryRun: true }, f.cwd).changed, false);
 retargetPlan({ id, target: 'main' }, f.cwd); const history = fs.readFileSync(f.file, 'utf8');
 assert.match(history, /from: "main"\n\s+to: "candidate"\n\s+- from: "candidate"\n\s+to: "main"/);
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
