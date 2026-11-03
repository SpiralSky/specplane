import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { runInit } from '../commands/init.js';
import { makeRepo } from '../test-repo.js';
import { codex, CODEX_SKILL } from './codex.js';
import { claude } from './claude.js';
import { Report } from './index.js';
import { assertInstallDestination, writeInstallFile } from './containment.js';

function fixture(fn: (root: string, outside: string) => void): void {
  const root = makeRepo({});
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'specplane-install-outside-'));
  try { fn(root, outside); }
  finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
}

test('Codex refuses dangling skill links without creating their target', () => fixture((root, outside) => {
  const file = path.join(root, CODEX_SKILL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.symlinkSync(path.join(outside, 'missing.md'), file);
  const report = new Report(root);
  codex.install(root, report);
  assert.match(report.lines.join('\n'), /symlink refused/);
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.equal(fs.lstatSync(file).isSymbolicLink(), true);
}));

test('Claude preflights every destination before writing any harness asset', () => fixture((root, outside) => {
  fs.mkdirSync(path.join(root, '.claude'));
  fs.symlinkSync(path.join(outside, 'missing.json'), path.join(root, '.claude/settings.json'));
  const report = new Report(root);
  claude.install(root, report);
  assert.match(report.lines.join('\n'), /symlink refused/);
  assert.deepEqual(fs.readdirSync(path.join(root, '.claude')), ['settings.json']);
  assert.deepEqual(fs.readdirSync(outside), []);
}));

for (const destination of ['.specplane/config.yaml', 'AGENTS.md', 'docs/specifications/features/INFO.md', 'plans/.gitkeep']) {
  test(`common init refuses dangling ${destination} before scaffolding`, () => fixture((root, outside) => {
    const file = path.join(root, destination);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.symlinkSync(path.join(outside, 'missing'), file);
    assert.throws(() => runInit(root, { harness: 'none' }), /symlink refused/);
    assert.deepEqual(fs.readdirSync(outside), []);
    if (destination !== '.specplane/config.yaml') assert.equal(fs.existsSync(path.join(root, '.specplane/config.yaml')), false);
  }));
}

test('contained links and links introduced after preflight are also refused', () => fixture((root, outside) => {
  const destination = path.join(root, 'new/asset');
  assertInstallDestination(root, destination);
  fs.symlinkSync(outside, path.join(root, 'new'), 'dir');
  assert.throws(() => writeInstallFile(root, destination, 'do not write'), /symlink refused/);
  assert.deepEqual(fs.readdirSync(outside), []);
  fs.writeFileSync(path.join(root, 'original'), 'original');
  fs.symlinkSync(path.join(root, 'original'), path.join(root, 'alias'));
  assert.throws(() => writeInstallFile(root, path.join(root, 'alias'), 'do not write'), /symlink refused/);
  assert.equal(fs.readFileSync(path.join(root, 'original'), 'utf8'), 'original');
}));

test('hard-linked assets and traversal refuse without modifying targets', () => fixture((root, outside) => {
  const source = path.join(outside, 'original');
  fs.writeFileSync(source, 'original');
  const destination = path.join(root, 'linked');
  fs.linkSync(source, destination);
  assert.throws(() => writeInstallFile(root, destination, 'do not write'), /hard-linked/);
  assert.throws(() => writeInstallFile(root, source, 'do not write'), /outside the repository/);
  assert.equal(fs.readFileSync(source, 'utf8'), 'original');
}));

test('Claude preserves customized executable content and mode', () => fixture((root) => {
  const file = path.join(root, '.claude/hooks/specplane-pre-commit.sh');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '# my custom hook\n', { mode: 0o640 });
  const report = new Report(root);
  claude.install(root, report);
  assert.match(report.lines.join('\n'), /customized or unrecognized file preserved/);
  assert.equal(fs.readFileSync(file, 'utf8'), '# my custom hook\n');
  assert.equal(fs.statSync(file).mode & 0o777, 0o640);
}));
