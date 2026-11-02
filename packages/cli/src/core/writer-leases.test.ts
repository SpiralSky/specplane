import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { acquireWriterLease, checkoutIdentity, LeaseRefused } from './writer-leases.js';
function fixture() {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'writer-leases-'));
 const main = path.join(root, 'main'), other = path.join(root, 'other'), alias = path.join(root, 'alias');
 fs.mkdirSync(main);
 const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'ignore' });
 git(main, 'init'); git(main, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'initial');
 git(main, 'worktree', 'add', '-b', 'other', other); fs.symlinkSync(main, alias, 'dir');
 const runtime = path.join(checkoutIdentity(main).commonDir, 'specplane-runtime');
 return { main, other, alias, runtime, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
function locked(f: () => unknown) { assert.throws(f, (e: unknown) => e instanceof LeaseRefused && e.code === 'LOCKED'); }
function records(dir: string) { return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => path.join(dir, f)); }
test('aliases and plan/non-plan writers contend on one checkout', () => {
 const f = fixture(); try {
  assert.deepEqual(checkoutIdentity(f.main), checkoutIdentity(f.alias));
  const lease = acquireWriterLease({ checkouts: [f.main], plans: ['plan'], requestId: 'plan' });
  locked(() => acquireWriterLease({ checkouts: [f.alias], requestId: 'non-plan' }));
  lease.assertOwned(); lease.release();
  const next = acquireWriterLease({ checkouts: [f.alias], requestId: 'non-plan' });
  locked(() => acquireWriterLease({ checkouts: [f.main], plans: ['plan'], requestId: 'plan' })); next.release();
 } finally { f.cleanup(); }
});
test('ordered sets release their subset after multi-checkout contention', () => {
 const f = fixture(); try {
  const ordered = [f.main, f.other].sort((a, b) => checkoutIdentity(a).gitDir < checkoutIdentity(b).gitDir ? -1 : 1);
  const holder = acquireWriterLease({ checkouts: [ordered[1]], requestId: 'holder' });
  locked(() => acquireWriterLease({ repository: true, plans: ['z', 'a'], checkouts: ordered, requestId: 'contender' }));
  const probe = acquireWriterLease({ repository: true, plans: ['a', 'z'], checkouts: [ordered[0]], requestId: 'probe' });
  assert.deepEqual(probe.keys.map(k => k.kind), ['repository', 'plan', 'plan', 'checkout']);
  assert.deepEqual(probe.keys.filter(k => k.kind === 'plan').map(k => k.identity), ['a', 'z']);
  locked(() => acquireWriterLease({ repository: true, checkouts: [ordered[1]], requestId: 'installation' }));
  probe.release(); holder.release();
 } finally { f.cleanup(); }
});
test('malformed, delegated and guard data fail closed; ownership loss prevents release', () => {
 const f = fixture(); try {
  const lease = acquireWriterLease({ checkouts: [f.main], requestId: 'owner' });
  const file = records(f.runtime)[0], saved = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, '{}');
  assert.throws(() => acquireWriterLease({ checkouts: [f.main], requestId: 'next' }), /Malformed/);
  assert.throws(() => lease.release(), /Malformed/);
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(saved), worker: { pid: process.pid } }));
  assert.throws(() => acquireWriterLease({ checkouts: [f.main], requestId: 'next' }), /delegated/);
  fs.writeFileSync(file, saved); lease.release(); fs.writeFileSync(path.join(f.runtime, 'writer.guard'), '');
  locked(() => acquireWriterLease({ checkouts: [f.main], requestId: 'next' }));
 } finally { f.cleanup(); }
});
test('only a proven-dead undelegated owner is reclaimed', () => {
 const f = fixture(); try {
  const old = acquireWriterLease({ checkouts: [f.main], requestId: 'old' });
  const file = records(f.runtime)[0], record = JSON.parse(fs.readFileSync(file, 'utf8'));
  record.pid = 2147483647; fs.writeFileSync(file, JSON.stringify(record));
  const replacement = acquireWriterLease({ checkouts: [f.main], requestId: 'new' });
  assert.equal(replacement.reclaimed, true); assert.throws(() => old.release(), /ownership changed/);
  replacement.assertOwned(); replacement.release();
 } finally { f.cleanup(); }
});
test('another process cannot acquire an occupied checkout', () => {
 const f = fixture(); try {
  const lease = acquireWriterLease({ checkouts: [f.main], requestId: 'parent' });
  const script = `import { acquireWriterLease } from ${JSON.stringify(new URL('./writer-leases.js', import.meta.url).href)}; try { acquireWriterLease({checkouts:[process.argv[1]],requestId:'child'}); process.exitCode=2; } catch (e) { if (e.code !== 'LOCKED') { console.error(e); process.exitCode=3; } }`;
  execFileSync(process.execPath, ['--input-type=module', '-e', script, f.alias], { stdio: 'pipe', env: { ...process.env, NODE_TEST_CONTEXT: '' } });
  lease.release();
 } finally { f.cleanup(); }
});
test('linked runtime directories and nonregular lease records require recovery', () => {
 const f = fixture(); try {
  fs.symlinkSync(f.main, f.runtime, 'dir');
  assert.throws(() => acquireWriterLease({ checkouts: [f.main], requestId: 'one' }), /Runtime directory/);
  fs.unlinkSync(f.runtime);
  const lease = acquireWriterLease({ checkouts: [f.main], requestId: 'owner' });
  const file = records(f.runtime)[0], saved = fs.readFileSync(file, 'utf8');
  fs.unlinkSync(file); const target = path.join(f.main, 'target'); fs.writeFileSync(target, saved); fs.symlinkSync(target, file);
  assert.throws(() => acquireWriterLease({ checkouts: [f.main], requestId: 'next' }), /nonregular/);
  assert.throws(() => lease.release(), /nonregular/);
  fs.unlinkSync(file); fs.writeFileSync(file, saved); lease.release();
 } finally { f.cleanup(); }
});
test('caller mutations cannot change ownership verification', () => {
 const f = fixture(); try {
  const request = { checkouts: [f.main], requestId: 'original' };
  const lease = acquireWriterLease(request); request.requestId = 'modified';
  assert.throws(() => (lease.keys as unknown as unknown[]).splice(0));
  assert.throws(() => { (lease.keys[0] as { identity: string }).identity = 'modified'; });
  lease.assertOwned(); lease.release();
 } finally { f.cleanup(); }
});
test('dangling links and FIFOs fail closed without blocking', () => {
 const f = fixture(); try {
  const lease = acquireWriterLease({ checkouts: [f.main], requestId: 'owner' });
  const file = records(f.runtime)[0], saved = fs.readFileSync(file, 'utf8');
  fs.unlinkSync(file); fs.symlinkSync(path.join(f.main, 'missing'), file);
  assert.throws(() => acquireWriterLease({ checkouts: [f.main], requestId: 'next' }), /nonregular/);
  fs.unlinkSync(file); execFileSync('mkfifo', [file]);
  assert.throws(() => acquireWriterLease({ checkouts: [f.main], requestId: 'next' }), /nonregular/);
  assert.throws(() => lease.assertOwned(), /nonregular/);
  fs.unlinkSync(file); fs.writeFileSync(file, saved); lease.release();
 } finally { f.cleanup(); }
});
