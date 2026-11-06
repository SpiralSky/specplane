import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { filesystemMocks } from '../fixtures.js';
const mock = await filesystemMocks();
import { readContainedFile, withContainedDirectory } from './contained-files.js';

function fixture(action: (root: string, outside: string) => void): void {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'specplane-contained-')));
  const root = path.join(base, 'root'), outside = path.join(base, 'outside');
  fs.mkdirSync(root); fs.mkdirSync(outside);
  try { action(root, outside); }
  finally { fs.rmSync(base, { recursive: true, force: true }); }
}
function directoryLink(target: string, destination: string): void {
  fs.symlinkSync(target, destination, process.platform === 'win32' ? 'junction' : 'dir');
}

// Production imports the builtin ESM namespace. Keep the namespace synchronized
// with each temporary replacement and restore it before fixture cleanup.
function withMocks(install: () => void, action: () => void): void {
  try { install(); syncBuiltinESMExports(); action(); }
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

test('normal operations need neither procfs nor opened directory descriptors', () => fixture(root => {
  const open = fs.openSync, lstat = fs.lstatSync, realpath = fs.realpathSync;
  const rejectProc = (file: fs.PathLike) => assert.doesNotMatch(String(file), /^\/proc(?:\/|$)/);
  withMocks(() => {
    mock.method(fs, 'openSync', ((file: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
      rejectProc(file);
      if (fs.existsSync(file)) assert.equal(lstat(file).isDirectory(), false, 'directories must not be opened');
      return open(file, flags, mode);
    }) as typeof fs.openSync);
    mock.method(fs, 'lstatSync', ((...args: Parameters<typeof fs.lstatSync>) => {
      rejectProc(args[0]); return lstat(...args);
    }) as typeof fs.lstatSync);
    mock.method(fs, 'realpathSync', ((...args: Parameters<typeof fs.realpathSync>) => {
      rejectProc(args[0]); return realpath(...args);
    }) as typeof fs.realpathSync);
  }, () => withContainedDirectory(root, 'journal/request', true, directory => {
    directory.writeExclusive('event.json', 'portable');
    assert.equal(directory.read('event.json').toString(), 'portable');
    assert.deepEqual(directory.list(), ['event.json']);
  }));
}));

test('a persistent parent replacement at open refuses before reading evidence bytes', () => fixture((root, outside) => {
  const parent = path.join(root, 'parent'), evidence = path.join(parent, 'evidence');
  fs.mkdirSync(parent); fs.writeFileSync(evidence, 'inside');
  fs.writeFileSync(path.join(outside, 'evidence'), 'outside');
  const open = fs.openSync; let swapped = false, reads = 0;
  withMocks(() => {
    mock.method(fs, 'openSync', ((file: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
      if (!swapped && String(file) === evidence) {
        swapped = true; fs.renameSync(parent, path.join(root, 'retained'));
        directoryLink(outside, parent);
      }
      return open(file, flags, mode);
    }) as typeof fs.openSync);
    mock.method(fs, 'readFileSync', (() => { reads++; throw new Error('payload must not be read'); }) as typeof fs.readFileSync);
  }, () => assert.throws(() => readContainedFile(root, 'parent/evidence')));
  assert.equal(swapped, true); assert.equal(reads, 0);
  assert.equal(fs.readFileSync(path.join(outside, 'evidence'), 'utf8'), 'outside');
}));

test('a persistent final-file replacement at open refuses before reading evidence bytes', () => fixture(root => {
  const evidence = path.join(root, 'evidence'); fs.writeFileSync(evidence, 'original');
  const open = fs.openSync; let swapped = false, reads = 0;
  withMocks(() => {
    mock.method(fs, 'openSync', ((file: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
      if (!swapped && String(file) === evidence) {
        swapped = true; fs.renameSync(evidence, path.join(root, 'retained'));
        fs.writeFileSync(evidence, 'replacement');
      }
      return open(file, flags, mode);
    }) as typeof fs.openSync);
    mock.method(fs, 'readFileSync', (() => { reads++; throw new Error('payload must not be read'); }) as typeof fs.readFileSync);
  }, () => assert.throws(() => readContainedFile(root, 'evidence')));
  assert.equal(swapped, true); assert.equal(reads, 0);
}));

test('a persistent journal replacement at exclusive open refuses before writing payload', () => fixture((root, outside) => {
  const journal = path.join(root, 'journal'), event = path.join(journal, 'event.json');
  fs.mkdirSync(journal);
  const open = fs.openSync; let swapped = false, writes = 0;
  withMocks(() => {
    mock.method(fs, 'openSync', ((file: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
      if (!swapped && String(file) === event) {
        swapped = true; fs.renameSync(journal, path.join(root, 'retained'));
        directoryLink(outside, journal);
      }
      return open(file, flags, mode);
    }) as typeof fs.openSync);
    mock.method(fs, 'writeFileSync', (() => { writes++; throw new Error('payload must not be written'); }) as typeof fs.writeFileSync);
  }, () => assert.throws(() => withContainedDirectory(root, 'journal', false, directory => {
    assert.throws(() => directory.writeExclusive('event.json', 'private capture'));
  })));
  assert.equal(swapped, true); assert.equal(writes, 0);
  // A portable path-based exclusive open may create an empty file before the
  // replacement is detected. These checks do not claim hostile-writer isolation.
  if (fs.existsSync(path.join(outside, 'event.json'))) assert.equal(fs.statSync(path.join(outside, 'event.json')).size, 0);
}));

test('replacing the bound root or journal refuses subsequent read write and list operations', () => {
  for (const replaceRoot of [false, true]) fixture((root, outside) => {
    fs.mkdirSync(path.join(root, 'journal'));
    fs.writeFileSync(path.join(root, 'journal/prior'), 'inside');
    const destination = replaceRoot ? root : path.join(root, 'journal');
    assert.throws(() => withContainedDirectory(root, 'journal', false, directory => {
      fs.renameSync(destination, destination + '-retained');
      directoryLink(outside, destination);
      assert.throws(() => directory.read('prior'));
      assert.throws(() => directory.writeExclusive('next', 'capture'));
      assert.throws(() => directory.list());
    }));
    assert.deepEqual(fs.readdirSync(outside), []);
  });
});

test('directory links hardlinks and nonregular files refuse without modifying evidence', () => fixture((root, outside) => {
  const original = path.join(outside, 'original'); fs.writeFileSync(original, 'preserve');
  directoryLink(outside, path.join(root, 'linked-directory'));
  fs.linkSync(original, path.join(root, 'hardlink'));
  fs.mkdirSync(path.join(root, 'directory'));
  for (const name of ['linked-directory/original', 'hardlink', 'directory']) assert.throws(() => readContainedFile(root, name));
  withContainedDirectory(root, null, false, directory => {
    for (const name of ['linked-directory', 'hardlink', 'directory']) assert.throws(() => directory.writeExclusive(name, 'replacement'));
  });
  assert.equal(fs.readFileSync(original, 'utf8'), 'preserve');
}));

test('file symlinks refuse without reading or replacing their targets', { skip: process.platform === 'win32' ? 'file symlink creation requires Windows privileges; directory junctions are covered separately' : false }, () => fixture((root, outside) => {
  const original = path.join(outside, 'original'); fs.writeFileSync(original, 'preserve');
  fs.symlinkSync(original, path.join(root, 'link'));
  fs.symlinkSync(path.join(outside, 'missing'), path.join(root, 'dangling'));
  for (const name of ['link', 'dangling']) {
    assert.throws(() => readContainedFile(root, name));
    withContainedDirectory(root, null, false, directory => assert.throws(() => directory.writeExclusive(name, 'replacement')));
  }
  assert.equal(fs.readFileSync(original, 'utf8'), 'preserve');
  assert.equal(fs.existsSync(path.join(outside, 'missing')), false);
}));

test('traversal and Windows path aliases refuse on every platform', () => fixture(root => {
  const invalid = ['', '/absolute', '../outside/original', 'a/../b', 'a//b', './a', 'a\\b', 'a\0b', '.git/config',
    'C:/absolute', 'file:stream', 'file.', 'file ', 'a./file', 'a /file', 'CON', 'nul.txt', 'Aux', 'PRN.json', 'COM1', 'lpt9.log'];
  for (const name of invalid) assert.throws(() => readContainedFile(root, name), { code: 'INVALID_EVIDENCE' }, name);
  withContainedDirectory(root, null, false, directory => {
    for (const name of invalid) assert.throws(() => directory.writeExclusive(name, 'replacement'), { code: 'INVALID_EVIDENCE' }, name);
    assert.throws(() => directory.writeExclusive('nested/file', 'replacement'), { code: 'INVALID_EVIDENCE' });
  });
  assert.deepEqual(fs.readdirSync(root), []);
}));

test('FIFO evidence refuses without waiting for a writer', { skip: process.platform === 'win32' ? 'Windows has no POSIX mkfifo' : false }, () => fixture(root => {
  const fifo = path.join(root, 'fifo');
  const result = spawnSync('mkfifo', [fifo], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.throws(() => readContainedFile(root, 'fifo'), { code: 'INVALID_EVIDENCE' });
}));

test('file descriptors close on read and write failures', () => fixture(root => {
  fs.writeFileSync(path.join(root, 'evidence'), 'inside');
  const open = fs.openSync, close = fs.closeSync, opened: number[] = [], closed: number[] = [];
  withMocks(() => {
    mock.method(fs, 'openSync', ((...args: Parameters<typeof fs.openSync>) => {
      const descriptor = open(...args); opened.push(descriptor); return descriptor;
    }) as typeof fs.openSync);
    mock.method(fs, 'closeSync', (descriptor: number) => { closed.push(descriptor); close(descriptor); });
    mock.method(fs, 'readFileSync', (() => { throw new Error('read failed'); }) as typeof fs.readFileSync);
    mock.method(fs, 'writeFileSync', (() => { throw new Error('write failed'); }) as typeof fs.writeFileSync);
  }, () => {
    assert.throws(() => readContainedFile(root, 'evidence'), /read failed/);
    withContainedDirectory(root, null, false, directory => assert.throws(() => directory.writeExclusive('event.json', 'capture'), /write failed/));
  });
  assert.equal(opened.length, 2);
  assert.deepEqual(closed, opened);
}));


test('an ambient directory alias above the selected root permits normal operations', () => fixture(root => {
  const alias = path.join(path.dirname(root), 'ambient-alias');
  directoryLink(path.dirname(root), alias);
  const aliasedRoot = path.join(alias, path.basename(root));
  withContainedDirectory(aliasedRoot, 'journal/request', true, directory => {
    directory.writeExclusive('event.json', 'portable');
    assert.equal(directory.read('event.json').toString(), 'portable');
    assert.deepEqual(directory.list(), ['event.json']);
  });
  assert.equal(readContainedFile(aliasedRoot, 'journal/request/event.json').toString(), 'portable');
}));

test('directory access expires when its synchronous callback returns', () => fixture(root => {
  const directory = withContainedDirectory(root, null, false, current => current);
  assert.throws(() => directory.read('evidence'), { code: 'RECOVERY_REQUIRED' });
  assert.throws(() => directory.writeExclusive('event.json', 'capture'), { code: 'RECOVERY_REQUIRED' });
  assert.throws(() => directory.list(), { code: 'RECOVERY_REQUIRED' });
  assert.deepEqual(fs.readdirSync(root), []);
}));

test('in-place evidence mutation during read refuses the returned bytes and closes the handle', () => fixture(root => {
  const evidence = path.join(root, 'evidence'); fs.writeFileSync(evidence, 'original');
  const read = fs.readFileSync, close = fs.closeSync; let descriptor: number | undefined, closed = false;
  withMocks(() => {
    mock.method(fs, 'readFileSync', ((file: fs.PathOrFileDescriptor) => {
      assert.equal(typeof file, 'number'); descriptor = file as number;
      const bytes = read(file);
      fs.appendFileSync(evidence, '-changed');
      return bytes;
    }) as typeof fs.readFileSync);
    mock.method(fs, 'closeSync', (fd: number) => { if (fd === descriptor) closed = true; close(fd); });
  }, () => assert.throws(() => readContainedFile(root, 'evidence'), { code: 'RECOVERY_REQUIRED' }));
  assert.equal(closed, true);
  assert.equal(fs.readFileSync(evidence, 'utf8'), 'original-changed');
}));

test('a final-file replacement during read refuses even when replacement bytes match', () => fixture(root => {
  const evidence = path.join(root, 'evidence'); fs.writeFileSync(evidence, 'original');
  const read = fs.readFileSync; let replaced = false;
  withMocks(() => {
    mock.method(fs, 'readFileSync', ((file: fs.PathOrFileDescriptor) => {
      const bytes = read(file);
      fs.renameSync(evidence, path.join(root, 'retained'));
      fs.writeFileSync(evidence, 'original'); replaced = true;
      return bytes;
    }) as typeof fs.readFileSync);
  }, () => assert.throws(() => readContainedFile(root, 'evidence'), { code: 'RECOVERY_REQUIRED' }));
  assert.equal(replaced, true);
  assert.equal(fs.readFileSync(evidence, 'utf8'), 'original');
}));

test('journal replacement during sync refuses without cleaning up either directory', { skip: process.platform === 'win32' ? 'Windows refuses to rename a directory while a file inside it is open' : false }, () => fixture((root, outside) => {
  const journal = path.join(root, 'journal'), retained = path.join(root, 'retained');
  fs.mkdirSync(journal);
  const sync = fs.fsyncSync; let replaced = false;
  withMocks(() => {
    mock.method(fs, 'fsyncSync', (fd: number) => {
      sync(fd); fs.renameSync(journal, retained); directoryLink(outside, journal); replaced = true;
    });
  }, () => assert.throws(() => withContainedDirectory(root, 'journal', false, directory => {
    directory.writeExclusive('event.json', 'private capture');
  }), { code: 'RECOVERY_REQUIRED' }));
  assert.equal(replaced, true);
  assert.equal(fs.readFileSync(path.join(retained, 'event.json'), 'utf8'), 'private capture');
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.equal(fs.lstatSync(journal).isSymbolicLink(), true);
}));

test('directory replacement during listing refuses the observed entries', () => fixture((root, outside) => {
  const journal = path.join(root, 'journal'); fs.mkdirSync(journal);
  fs.writeFileSync(path.join(journal, 'event.json'), 'capture');
  const readdir = fs.readdirSync; let replaced = false;
  withMocks(() => {
    mock.method(fs, 'readdirSync', ((...args: Parameters<typeof fs.readdirSync>) => {
      const entries = readdir(...args);
      fs.renameSync(journal, path.join(root, 'retained')); directoryLink(outside, journal); replaced = true;
      return entries;
    }) as typeof fs.readdirSync);
  }, () => assert.throws(() => withContainedDirectory(root, 'journal', false, directory => directory.list()), { code: 'RECOVERY_REQUIRED' }));
  assert.equal(replaced, true);
  assert.deepEqual(fs.readdirSync(outside), []);
}));
