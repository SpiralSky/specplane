import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mock, test } from 'node:test';
import { readContainedFile, withContainedDirectory } from './contained-files.js';

function fixture(action: (root: string, outside: string) => void): void {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'specplane-contained-'));
  const root = path.join(base, 'root'), outside = path.join(base, 'outside');
  fs.mkdirSync(root); fs.mkdirSync(outside);
  try { action(root, outside); }
  finally { fs.rmSync(base, { recursive: true, force: true }); }
}

// Production imports the builtin ESM namespace: synchronize it after replacing
// the default-export method and again after restoring the original method.
function duringOpen(before: (file: fs.PathLike) => void, action: () => void): void {
  const open = fs.openSync;
  mock.method(fs, 'openSync', ((file: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
    before(file);
    return open(file, flags, mode);
  }) as typeof fs.openSync);
  syncBuiltinESMExports();
  try { action(); }
  finally { mock.restoreAll(); syncBuiltinESMExports(); }
}

test('contained files read regular bytes and exclusively create sorted journal records', () => fixture(root => {
  withContainedDirectory(root, 'journal/request', true, directory => {
    directory.writeExclusive('b.json', 'second');
    directory.writeExclusive('a.json', 'first');
    assert.deepEqual(directory.list(), ['a.json', 'b.json']);
    assert.equal(directory.read('a.json').toString(), 'first');
    assert.throws(() => directory.writeExclusive('a.json', 'replacement'), { code: 'EEXIST' });
    assert.equal(directory.read('a.json').toString(), 'first');
  });
  assert.equal(readContainedFile(root, 'journal/request/b.json').toString(), 'second');
}));

test('a parent swapped for an outside link before traversal refuses outside bytes', () => fixture((root, outside) => {
  const parent = path.join(root, 'parent'); fs.mkdirSync(parent);
  fs.writeFileSync(path.join(parent, 'evidence'), 'inside');
  fs.writeFileSync(path.join(outside, 'evidence'), 'outside');
  let swapped = false;
  duringOpen(file => {
    if (!swapped && String(file).endsWith('/parent')) {
      swapped = true; fs.renameSync(parent, path.join(root, 'retained'));
      fs.symlinkSync(outside, parent, 'dir');
    }
  }, () => assert.throws(() => readContainedFile(root, 'parent/evidence')));
  assert.equal(swapped, true);
  assert.equal(fs.readFileSync(path.join(outside, 'evidence'), 'utf8'), 'outside');
}));

test('a replaced parent pathname cannot redirect a child read after the parent was opened', () => fixture((root, outside) => {
  const parent = path.join(root, 'parent'); fs.mkdirSync(parent);
  fs.writeFileSync(path.join(parent, 'evidence'), 'inside');
  fs.writeFileSync(path.join(outside, 'evidence'), 'outside');
  let swapped = false;
  duringOpen(file => {
    if (!swapped && String(file).endsWith('/evidence')) {
      swapped = true; fs.renameSync(parent, path.join(root, 'retained'));
      fs.symlinkSync(outside, parent, 'dir');
    }
  }, () => assert.equal(readContainedFile(root, 'parent/evidence').toString(), 'inside'));
  assert.equal(swapped, true);
}));

test('a replaced root pathname cannot redirect journal creation after root open', () => fixture((root, outside) => {
  let swapped = false;
  duringOpen(file => {
    if (!swapped && String(file).endsWith('/journal')) {
      swapped = true; fs.renameSync(root, root + '-retained');
      fs.symlinkSync(outside, root, 'dir');
    }
  }, () => withContainedDirectory(root, 'journal', true, directory => {
    directory.writeExclusive('event.json', 'captured');
    assert.deepEqual(directory.list(), ['event.json']);
  }));
  assert.equal(swapped, true);
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.equal(fs.readFileSync(path.join(root + '-retained', 'journal/event.json'), 'utf8'), 'captured');
}));

test('an opened journal keeps reads writes and listing on its retained directory', () => fixture((root, outside) => {
  fs.mkdirSync(path.join(root, 'journal'));
  fs.writeFileSync(path.join(root, 'journal/prior'), 'inside');
  fs.writeFileSync(path.join(outside, 'prior'), 'outside');
  withContainedDirectory(root, 'journal', false, directory => {
    fs.renameSync(path.join(root, 'journal'), path.join(root, 'retained'));
    fs.symlinkSync(outside, path.join(root, 'journal'), 'dir');
    assert.equal(directory.read('prior').toString(), 'inside');
    directory.writeExclusive('next', 'captured');
    assert.deepEqual(directory.list(), ['next', 'prior']);
  });
  assert.deepEqual(fs.readdirSync(outside), ['prior']);
  assert.equal(fs.readFileSync(path.join(outside, 'prior'), 'utf8'), 'outside');
}));

test('final links hardlinks directories and invalid paths refuse without modifying evidence', () => fixture((root, outside) => {
  const original = path.join(outside, 'original'); fs.writeFileSync(original, 'preserve');
  fs.symlinkSync(original, path.join(root, 'link'));
  fs.linkSync(original, path.join(root, 'hardlink'));
  fs.mkdirSync(path.join(root, 'directory'));
  for (const name of ['link', 'hardlink', 'directory']) assert.throws(() => readContainedFile(root, name));
  for (const name of ['', '/absolute', '../outside/original', 'a/../b', 'a//b', './a', 'a\\b', 'a\0b', '.git/config'])
    assert.throws(() => readContainedFile(root, name), { code: 'INVALID_EVIDENCE' });
  withContainedDirectory(root, null, false, directory => {
    for (const name of ['link', 'hardlink', 'directory']) assert.throws(() => directory.writeExclusive(name, 'replacement'));
    assert.throws(() => directory.writeExclusive('nested/file', 'replacement'), { code: 'INVALID_EVIDENCE' });
  });
  assert.equal(fs.readFileSync(original, 'utf8'), 'preserve');
}));

test('FIFO evidence refuses without waiting for a writer', () => fixture(root => {
  const fifo = path.join(root, 'fifo');
  const result = spawnSync('mkfifo', [fifo], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.throws(() => readContainedFile(root, 'fifo'), { code: 'INVALID_EVIDENCE' });
}));

test('unavailable procfs refuses explicitly before creating journal directories', () => fixture(root => {
  duringOpen(file => {
    if (String(file) === '/proc/self/fd') throw Object.assign(new Error('procfs unavailable'), { code: 'ENOENT' });
  }, () => assert.throws(() => withContainedDirectory(root, 'journal', true, () => {}), { code: 'UNSUPPORTED_CAPABILITY' }));
  assert.deepEqual(fs.readdirSync(root), []);
}));

test('descriptors close after traversal and callback failures', () => fixture(root => {
  const count = () => fs.readdirSync('/proc/self/fd').length;
  const before = count();
  for (let i = 0; i < 20; i++) {
    assert.throws(() => readContainedFile(root, 'missing/file'));
    assert.throws(() => withContainedDirectory(root, null, false, () => { throw new Error('callback failed'); }), /callback failed/);
  }
  assert.equal(count(), before);
}));
