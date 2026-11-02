import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { capturePlanSnapshot as capture, recheckPlanSnapshot as recheck, prospectivePlanSnapshot } from './snapshot.js';

function repo(): string {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-'));
  git(r, 'init', '-q'); git(r, 'config', 'user.email', 'test@example.com'); git(r, 'config', 'user.name', 'Test'); return r;
}
function git(r: string, ...args: string[]): string { return execFileSync('git', args, { cwd: r, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }); }
function put(r: string, p: string, text: string): void { fs.mkdirSync(path.dirname(path.join(r, p)), { recursive: true }); fs.writeFileSync(path.join(r, p), text); }
function texts(r: string, source: 'head' | 'staged' | 'working'): string[] { return capture(r, source).plans.map(p => `${p.path}:${p.bytes}`); }
function commit(r: string): void { git(r, 'add', '.'); git(r, 'commit', '-qm', 'initial'); }
test('three explicit sources preserve stage zero additions, deletions and tracked edits', () => {
  const r = repo(); put(r, 'plans/a/PLAN.md', 'head'); put(r, 'plans/b/PLAN.md', 'old'); commit(r);
  put(r, 'plans/a/PLAN.md', 'staged'); git(r, 'add', 'plans/a/PLAN.md'); git(r, 'rm', '-q', 'plans/b/PLAN.md'); put(r, 'plans/c/PLAN.md', 'new'); git(r, 'add', 'plans/c/PLAN.md'); put(r, 'plans/a/PLAN.md', 'working');
  assert.deepEqual(texts(r, 'head'), ['plans/a/PLAN.md:head', 'plans/b/PLAN.md:old']);
  assert.deepEqual(texts(r, 'staged'), ['plans/a/PLAN.md:staged', 'plans/c/PLAN.md:new']);
  assert.deepEqual(texts(r, 'working'), ['plans/a/PLAN.md:working', 'plans/c/PLAN.md:new']);
  assert.ok(capture(r, 'head').excluded.length); assert.ok(capture(r, 'staged').excluded.length);
});
test('config and inventory come from the same selected source', () => {
  const r = repo(); put(r, '.specplane/config.yaml', 'plans:\n  dir: one\n'); put(r, 'one/a/PLAN.md', 'one'); put(r, 'two/b/PLAN.md', 'two'); put(r, 'three/c/PLAN.md', 'three'); commit(r);
  put(r, '.specplane/config.yaml', 'plans:\n  dir: two\n'); git(r, 'add', '.specplane/config.yaml'); put(r, '.specplane/config.yaml', 'plans:\n  dir: three\n');
  assert.deepEqual(texts(r, 'head'), ['one/a/PLAN.md:one']); assert.deepEqual(texts(r, 'staged'), ['two/b/PLAN.md:two']); assert.deepEqual(texts(r, 'working'), ['three/c/PLAN.md:three']);
});
test('working includes ignored tracked and nonignored new inputs and honors deletions', () => {
  const r = repo(); put(r, 'plans/a/PLAN.md', 'tracked'); commit(r); put(r, '.gitignore', 'plans/a/\nplans/ignored/\n'); put(r, 'plans/ignored/PLAN.md', 'ignored'); put(r, 'plans/new/PLAN.md', 'new');
  assert.deepEqual(texts(r, 'working'), ['plans/a/PLAN.md:tracked', 'plans/new/PLAN.md:new']); fs.rmSync(path.join(r, 'plans/a/PLAN.md')); assert.deepEqual(texts(r, 'working'), ['plans/new/PLAN.md:new']);
});
test('unborn and detached HEAD have explicit behavior', () => {
  const r = repo(); assert.throws(() => capture(r), /Unborn HEAD.*staged.*working/); put(r, 'plans/a/PLAN.md', 'a'); git(r, 'add', '.'); assert.equal(capture(r, 'staged').plans.length, 1); git(r, 'commit', '-qm', 'initial'); git(r, 'checkout', '-q', '--detach'); assert.equal(capture(r).plans.length, 1); assert.throws(() => capture(r, 'bad' as never), /Unknown/);
});
test('unmerged inputs refuse while output-only conflicts are exposed', () => {
  const r = repo(); put(r, 'plans/a/PLAN.md', 'base'); put(r, 'plans/PLANS.md', 'base'); commit(r); git(r, 'checkout', '-qb', 'side'); put(r, 'plans/a/PLAN.md', 'side'); put(r, 'plans/PLANS.md', 'side'); git(r, 'commit', '-qam', 'side'); git(r, 'checkout', '-q', 'master'); put(r, 'plans/a/PLAN.md', 'main'); put(r, 'plans/PLANS.md', 'main'); git(r, 'commit', '-qam', 'main'); try { git(r, 'merge', 'side'); } catch { /* expected conflicts */ }
  assert.throws(() => capture(r, 'staged'), /Unresolved plan/); assert.throws(() => capture(r, 'working'), /Unresolved plan/); put(r, 'plans/a/PLAN.md', 'resolved'); git(r, 'add', 'plans/a/PLAN.md'); assert.equal(capture(r, 'staged').outputUnmerged, true); assert.equal(capture(r).outputUnmerged, true);
});
test('recheck detects discovery, input, index, output and operation changes', () => {
  const r = repo(); put(r, 'plans/a/PLAN.md', 'a'); commit(r);
  let s = capture(r, 'working'); put(r, 'plans/b/PLAN.md', 'b'); assert.throws(() => recheck(r, s), /changed/); s = capture(r, 'working'); fs.rmSync(path.join(r, 'plans/b/PLAN.md')); assert.throws(() => recheck(r, s), /changed/);
  s = capture(r, 'working'); put(r, '.gitignore', '# changed\n'); assert.throws(() => recheck(r, s), /changed/); s = capture(r, 'staged'); put(r, 'plans/a/PLAN.md', 'changed'); git(r, 'add', 'plans/a/PLAN.md'); assert.throws(() => recheck(r, s), /changed/);
  s = capture(r, 'staged'); put(r, 'plans/PLANS.md', 'generated'); assert.throws(() => recheck(r, s), /changed/); s = capture(r, 'staged'); put(r, '.git/MERGE_HEAD', 'identity'); assert.throws(() => recheck(r, s), /changed/);
});
test('prospective overlay uses only authorized head edits and containment rejects escapes', () => {
  const r = repo(); put(r, 'plans/a/PLAN.md', 'old'); commit(r); put(r, 'plans/a/PLAN.md', 'unrelated'); const base = capture(r); const next = prospectivePlanSnapshot(r, base, new Map([['plans/a/PLAN.md', Buffer.from('new')]])); assert.equal(next.plans[0].bytes.toString(), 'new'); assert.throws(() => prospectivePlanSnapshot(r, base, new Map([['other', Buffer.from('x')]])), /Unauthorized/);
  put(r, '.specplane/config.yaml', 'plans:\n  dir: ../outside\n'); assert.throws(() => capture(r, 'working'), /inside/);
});
test('unmerged config refuses and symlink inputs are not followed', () => {
  const r = repo(); put(r, '.specplane/config.yaml', 'plans:\n  dir: plans\n'); commit(r); git(r, 'checkout', '-qb', 'side'); put(r, '.specplane/config.yaml', 'plans:\n  dir: other\n'); git(r, 'commit', '-qam', 'side'); git(r, 'checkout', '-q', 'master'); put(r, '.specplane/config.yaml', 'plans:\n  dir: different\n'); git(r, 'commit', '-qam', 'main'); try { git(r, 'merge', 'side'); } catch { /* expected */ }
  assert.throws(() => capture(r, 'staged'), /Unresolved config/); assert.throws(() => capture(r, 'working'), /Unresolved config/);
  git(r, 'merge', '--abort'); fs.rmSync(path.join(r, '.specplane/config.yaml')); fs.symlinkSync('/etc/passwd', path.join(r, '.specplane/config.yaml')); assert.throws(() => capture(r, 'working'), /Symlink/);
});
test('prospective canonical paths and bytewise ordering match committed snapshots', () => {
  const r = repo(); put(r, 'plans/Z/PLAN.md', 'z'); put(r, 'plans/a/PLAN.md', 'a'); commit(r);
  const base = capture(r), index = git(r, 'ls-files', '--stage');
  const empty = prospectivePlanSnapshot(r, base, new Map());
  assert.deepEqual(empty.plans, base.plans); assert.equal(empty.digest, base.digest);
  for (const p of ['plans/../PLAN.md', 'plans/./PLAN.md', 'plans//PLAN.md', 'plans/archive/../PLAN.md', 'plans/archive/./PLAN.md', 'plans\\a\\PLAN.md', '/plans/a/PLAN.md', 'C:/plans/a/PLAN.md']) {
    assert.throws(() => prospectivePlanSnapshot(r, base, new Map([[p, Buffer.from('bad')]])), /Unauthorized/);
  }
  const overlay = prospectivePlanSnapshot(r, base, new Map([['plans/Z/PLAN.md', null], ['plans/archive/B/PLAN.md', Buffer.from('b')]]));
  assert.equal(git(r, 'ls-files', '--stage'), index);
  fs.rmSync(path.join(r, 'plans/Z/PLAN.md')); put(r, 'plans/archive/B/PLAN.md', 'b'); git(r, 'add', '-A'); git(r, 'commit', '-qm', 'overlay');
  const committed = capture(r); assert.deepEqual(overlay.plans, committed.plans); assert.equal(overlay.digest, committed.digest);
});
test('ignored rule files are rechecked even when inventory is unchanged', () => {
  const r = repo(); put(r, 'plans/a/PLAN.md', 'a'); commit(r);
  put(r, '.git/info/exclude', '*.gitignore\n'); put(r, 'plans/.gitignore', '# first\n'); put(r, 'plans/new/PLAN.md', 'new');
  const before = capture(r, 'working'); assert.equal(before.plans.length, 2);
  put(r, 'plans/.gitignore', '# second\n'); assert.throws(() => recheck(r, before), /changed/);
  const next = capture(r, 'working'); put(r, 'plans/.gitignore', 'new/\n'); assert.throws(() => recheck(r, next), /changed/);
  assert.deepEqual(capture(r, 'working').plans.map(p => p.path), ['plans/a/PLAN.md']);
});
test('working discovery skips excluded trees but retains rules for tracked and visible plans', () => {
  const r = repo(); put(r, 'plans/tracked/PLAN.md', 'tracked'); commit(r);
  put(r, '.gitignore', 'plans/ignored/\nplans/tracked/\n*.gitignore\n');
  put(r, 'plans/ignored/PLAN.md', 'excluded');
  fs.symlinkSync('missing', path.join(r, 'plans/ignored/.gitignore'));
  put(r, 'plans/tracked/.gitignore', '# tracked ancestor\n');
  put(r, 'plans/visible/.gitignore', '# visible ancestor\n');
  put(r, 'plans/visible/PLAN.md', 'visible');
  const before = capture(r, 'working');
  assert.deepEqual(before.plans.map(p => p.path), ['plans/tracked/PLAN.md', 'plans/visible/PLAN.md']);
  fs.unlinkSync(path.join(r, 'plans/ignored/.gitignore'));
  put(r, 'plans/ignored/.gitignore', '# irrelevant\n');
  recheck(r, before);
  put(r, 'plans/tracked/.gitignore', '# changed tracked ancestor\n');
  assert.throws(() => recheck(r, before), /changed/);
  const next = capture(r, 'working');
  put(r, 'plans/visible/.gitignore', '# changed visible ancestor\n');
  assert.throws(() => recheck(r, next), /changed/);
  const membership = capture(r, 'working');
  put(r, 'plans/visible/.gitignore', 'PLAN.md\n');
  assert.throws(() => recheck(r, membership), /changed/);
  assert.deepEqual(capture(r, 'working').plans.map(p => p.path), ['plans/tracked/PLAN.md']);
});
test('snapshot branch validation follows Git and accepts repository root plans', () => {
  const r = repo(); put(r, '.specplane/config.yaml', 'plans:\n  dir: .\n  target_branch: "@"\n'); put(r, 'a/PLAN.md', 'a'); put(r, 'archive/b/PLAN.md', 'b'); commit(r);
  assert.deepEqual(capture(r).plans.map(p => p.path), ['a/PLAN.md', 'archive/b/PLAN.md']);
  for (const name of ['bad..name', '-bad', '@{-1}', 'bad.lock']) {
    put(r, '.specplane/config.yaml', `plans:\n  target_branch: "${name}"\n`);
    assert.throws(() => capture(r, 'working'), /valid Git branch/);
  }
  for (const dir of ['../outside', 'C:/outside', '/outside']) {
    put(r, '.specplane/config.yaml', `plans:\n  dir: '${dir}'\n`);
    assert.throws(() => capture(r, 'working'));
  }
});
test('external exclude and ancestor rules invalidate working snapshots; symlink directories refuse', () => {
  const r = repo(), external = fs.mkdtempSync(path.join(os.tmpdir(), 'excludes-'));
  const exclude = path.join(external, 'ignore'); fs.writeFileSync(exclude, '# one\n'); git(r, 'config', 'core.excludesFile', exclude);
  put(r, '.specplane/config.yaml', 'plans:\n  dir: nested/plans\n'); put(r, 'nested/plans/a/PLAN.md', 'a'); commit(r);
  let s = capture(r, 'working'); fs.writeFileSync(exclude, '# two\n'); assert.throws(() => recheck(r, s), /changed/);
  s = capture(r, 'working'); put(r, 'nested/.gitignore', '# ancestor\n'); assert.throws(() => recheck(r, s), /changed/);
  fs.renameSync(path.join(r, 'nested'), path.join(r, 'saved')); fs.symlinkSync(path.join(r, 'saved'), path.join(r, 'nested'), 'dir');
  assert.throws(() => capture(r, 'working'), /Symlink/);
});
test('owned output scratch is ignored exactly while newly discovered plans still invalidate the snapshot', () => {
  const r = repo(); put(r, 'plans/a/PLAN.md', 'one'); commit(r);
  const captured = capture(r, 'working'); const scratch = 'plans/.specplane-index-test.tmp'; put(r, scratch, 'pending');
  assert.throws(() => recheck(r, captured), /changed/); recheck(r, captured, scratch);
  put(r, 'plans/b/PLAN.md', 'new'); assert.throws(() => recheck(r, captured, scratch), /changed/);
});
