import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { runInit } from '../commands/init.js';
import { makeRepo } from '../test-repo.js';
import { claude } from './claude.js';
import { Report } from './index.js';
import { InstallTransaction, installPaths, SimulatedCrash, testHooks } from './containment.transaction.js';

afterEach(() => { delete testHooks.interrupt; });

function fixture(fn: (root: string, outside: string) => void, opts: { git?: boolean } = {}): void {
  const root = makeRepo({});
  if (opts.git !== false) execFileSync('git', ['init', '-q'], { cwd: root });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'specplane-tx-outside-'));
  try { fn(root, outside); }
  finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
}

const INIT_FILES = ['.specplane/config.yaml', 'docs/specifications/features/INFO.md', 'docs/specifications/architecture/INFO.md', 'AGENTS.md', 'plans/.gitkeep'];
const present = (root: string): string[] => INIT_FILES.filter((f) => fs.existsSync(path.join(root, f)));
const leftovers = (root: string): string[] => {
  const out: string[] = [];
  const walk = (d: string): void => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === '.git') continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/specplane-(new|restore)-/.test(e.name)) out.push(p); } };
  walk(root);
  return out;
};

test('journal lives under private git data, not the worktree', () => fixture((root) => {
  const p = installPaths(root);
  assert.ok(p.dir.startsWith(fs.realpathSync(path.join(root, '.git'))), p.dir);
}));

for (const point of ['prepared', 'before-apply:0', 'after-apply:0', 'before-apply:3', 'after-apply:3']) {
  test(`init interrupted at ${point} recovers to the preimage without partial activation`, () => fixture((root) => {
    fs.writeFileSync(path.join(root, 'AGENTS.md'), '# my notes\n');
    testHooks.interrupt = (p) => { if (p === point) throw new SimulatedCrash(point); };
    assert.throws(() => runInit(root, { harness: 'none' }), SimulatedCrash);
    delete testHooks.interrupt;
    const tx = InstallTransaction.open(root);
    assert.match(tx.notes.join('\n'), /Recovered interrupted installation/);
    tx.release();
    assert.deepEqual(present(root), ['AGENTS.md']);
    assert.equal(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), '# my notes\n');
    assert.deepEqual(leftovers(root), []);
    assert.equal(fs.existsSync(path.join(root, 'plans')), false);
    // A later full run completes and is then a no-op.
    runInit(root, { harness: 'none' });
    assert.deepEqual(present(root), INIT_FILES);
    assert.match(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), /^# my notes\n/);
    assert.match(runInit(root, { harness: 'none' }).join('\n'), /Specplane block is up to date/);
  }));
}

test('a crash after the committed marker is finished by the next run', () => fixture((root) => {
  testHooks.interrupt = (p) => { if (p === 'committed') throw new SimulatedCrash(p); };
  assert.throws(() => runInit(root, { harness: 'none' }), SimulatedCrash);
  delete testHooks.interrupt;
  const lines = runInit(root, { harness: 'none' });
  assert.match(lines.join('\n'), /Completed interrupted installation/);
  assert.deepEqual(present(root), INIT_FILES);
  assert.equal(fs.existsSync(installPaths(root).journal), false);
}));

test('an ordinary failure mid-apply rolls back immediately and keeps user text', () => fixture((root) => {
  fs.writeFileSync(path.join(root, 'AGENTS.md'), 'user text\n');
  testHooks.interrupt = (p) => { if (p === 'after-apply:3') throw new Error('disk full'); };
  assert.throws(() => runInit(root, { harness: 'none' }), /disk full/);
  delete testHooks.interrupt;
  assert.deepEqual(present(root), ['AGENTS.md']);
  assert.equal(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), 'user text\n');
  assert.equal(fs.existsSync(installPaths(root).lock), false);
  assert.equal(fs.existsSync(installPaths(root).journal), false);
}));

test('recovery preserves an edit made after an applied write and reports it', () => fixture((root) => {
  testHooks.interrupt = (p) => { if (p === 'after-apply:3') throw new SimulatedCrash(p); };
  assert.throws(() => runInit(root, { harness: 'none' }), SimulatedCrash);
  delete testHooks.interrupt;
  fs.appendFileSync(path.join(root, 'AGENTS.md'), '\nmy edit\n');
  const tx = InstallTransaction.open(root);
  const notes = tx.notes.join('\n');
  tx.release();
  assert.match(notes, /Recovery required: AGENTS\.md/);
  assert.match(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), /my edit/);
  assert.equal(fs.existsSync(path.join(root, '.specplane/config.yaml')), false);
}));

test('a destination replaced by a link between preflight and commit never writes outside', () => fixture((root, outside) => {
  testHooks.interrupt = (p) => {
    if (p !== 'before-apply:1') return;
    const f = path.join(root, 'docs/specifications/architecture/INFO.md');
    fs.symlinkSync(path.join(outside, 'victim'), f);
  };
  assert.throws(() => runInit(root, { harness: 'none' }), /symlink refused/);
  delete testHooks.interrupt;
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.deepEqual(present(root), []);
  assert.deepEqual(leftovers(root), []);
}));

test('a parent directory swapped for a link after staging is refused', () => fixture((root, outside) => {
  testHooks.interrupt = (p) => {
    if (p !== 'before-apply:0') return;
    fs.rmSync(path.join(root, '.specplane'), { recursive: true });
    fs.symlinkSync(outside, path.join(root, '.specplane'), 'dir');
  };
  assert.throws(() => runInit(root, { harness: 'none' }), /symlink refused/);
  delete testHooks.interrupt;
  assert.deepEqual(fs.readdirSync(outside), []);
}));

test('a file changed by someone else after inspection is a conflict, not an overwrite', () => fixture((root) => {
  const tx = InstallTransaction.open(root);
  const file = path.join(root, 'AGENTS.md');
  fs.writeFileSync(file, 'v1');
  tx.stage(file, 'ours');
  fs.writeFileSync(file, 'theirs');
  assert.throws(() => tx.commit(), /changed since it was inspected/);
  tx.release();
  assert.equal(fs.readFileSync(file, 'utf8'), 'theirs');
}));

test('installations serialize on the repository lock', () => fixture((root) => {
  const first = InstallTransaction.open(root);
  assert.throws(() => InstallTransaction.open(root), /installation lock/);
  assert.throws(() => runInit(root, { harness: 'none' }), /installation lock/);
  first.release();
  runInit(root, { harness: 'none' });
}));

test('a lock left by a dead process is reclaimed', () => fixture((root) => {
  const p = installPaths(root);
  fs.mkdirSync(p.dir, { recursive: true });
  fs.writeFileSync(p.lock, JSON.stringify({ pid: 2 ** 22 + 12345, token: 'dead' }));
  runInit(root, { harness: 'none' });
  assert.deepEqual(present(root), INIT_FILES);
}));

test('ownership digests: customized survives, unmodified owned files update, each exactly once', () => fixture((root) => {
  const hook = path.join(root, '.claude/hooks/specplane-pre-commit.sh');
  claude.install(root, new Report(root));
  const original = fs.readFileSync(hook);
  // Pretend an older release installed different bytes: record them as the owned digest.
  const old = Buffer.from('#!/bin/sh\n# old release\n');
  fs.writeFileSync(hook, old);
  const ledger = installPaths(root).ledger;
  const files = JSON.parse(fs.readFileSync(ledger, 'utf8')).files as Record<string, string>;
  files['.claude/hooks/specplane-pre-commit.sh'] = crypto.createHash('sha256').update(old).digest('hex');
  fs.writeFileSync(ledger, JSON.stringify({ version: 1, files }));
  const report = new Report(root);
  claude.install(root, report);
  assert.match(report.lines.join('\n'), /Updated .claude\/hooks\/specplane-pre-commit\.sh/);
  assert.deepEqual(fs.readFileSync(hook), original);
  assert.equal(fs.statSync(hook).mode & 0o111, 0o111);
  // A user edit after that is never replaced.
  fs.writeFileSync(hook, '# mine\n');
  const again = new Report(root);
  claude.install(root, again);
  assert.match(again.lines.join('\n'), /customized or unrecognized file preserved/);
  assert.equal(fs.readFileSync(hook, 'utf8'), '# mine\n');
}));

test('non-git directories use a private fallback, never the worktree', () => fixture((root) => {
  const p = installPaths(root);
  assert.ok(!p.dir.startsWith(fs.realpathSync(root)), p.dir);
  runInit(root, { harness: 'none' });
  assert.deepEqual(present(root), INIT_FILES);
  fs.rmSync(path.dirname(path.dirname(p.dir)), { recursive: true, force: true });
}, { git: false }));
