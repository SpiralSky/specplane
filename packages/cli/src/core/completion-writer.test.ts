import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { makeRepo } from '../test-repo.js';
import { executeOperation } from './index.js';
import { acquireWriterLease } from './writer-leases.js';
import { writeImplementation } from './completion-writer.js';
import { parseFrontmatter } from '../frontmatter.js';

const rootFile = 'docs/specifications/features/root.md';
const childFile = 'docs/specifications/features/child.md';
const header = (id: string) => `---\nid: feature/${id}\ntitle: ${id}\nstatus: approved\nauthor: user\n`;
function fixture() {
  const root = makeRepo({ [rootFile]: header('root') + 'extends: feature/child#heading\nimplementation: {status: partial, evidence: [manual], implementation_revision: abc}\nother: keep\n---\n# Body\n', [childFile]: header('child') + 'extends: feature/grandchild\n---\n# Child\n', 'docs/specifications/features/grandchild.md': header('grandchild') + '---\n# Grandchild\n', dirty: 'unstaged\n' });
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'add', 'dirty']);
  return root;
}
const call = (root: string, status: 'incomplete' | 'partial' | 'complete', dryRun = false) => executeOperation({ operation: 'spec.implementation', arguments: { id: 'feature/root', status, dryRun } }, { checkout: root, extensionId: 'test' });
test('core and CLI preserve evidence and body, cover statuses, dry-run and repeated complete', () => {
  const root = fixture();
  try {
    const original = fs.readFileSync(path.join(root, rootFile), 'utf8');
    const index = fs.readFileSync(path.join(root, '.git/index'));
    const preview = call(root, 'complete', true); assert.ok(preview.ok); assert.equal(preview.value.assessment_status, 'current'); assert.equal(fs.readFileSync(path.join(root, rootFile), 'utf8'), original); assert.equal(fs.existsSync(path.join(root, '.git/specplane-runtime')), false);
    const cli = spawnSync(process.execPath, [path.resolve('dist/cli.js'), 'spec', 'complete', 'feature/root', '--json'], { cwd: root, encoding: 'utf8' }); assert.equal(cli.status, 0, cli.stderr); const result = JSON.parse(cli.stdout); assert.equal(result.fingerprint, preview.value.fingerprint);
    const after = fs.readFileSync(path.join(root, rootFile), 'utf8'); assert.match(after, /evidence: \[manual\]/); assert.match(after, /implementation_revision: abc/); assert.ok(after.endsWith('other: keep\n---\n# Body\n')); assert.match(after, /base:feature\/child/); assert.match(after, /base:feature\/grandchild/);
    const repeated = call(root, 'complete'); assert.ok(repeated.ok); assert.equal(repeated.value.changed, false); assert.equal(fs.readFileSync(path.join(root, rootFile), 'utf8'), after);
    for (const status of ['incomplete', 'partial'] as const) { const receipt = call(root, status); assert.ok(receipt.ok); assert.equal(receipt.value.assessment_status, 'unrecorded'); assert.equal(receipt.value.fingerprint, null); assert.match(fs.readFileSync(path.join(root, rootFile), 'utf8'), /assessed_dependencies:/); }
    assert.equal(fs.readFileSync(path.join(root, 'dirty'), 'utf8'), 'unstaged\n'); assert.deepEqual(fs.readFileSync(path.join(root, '.git/index')), index);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('invalid metadata, missing closure and held checkout lease refuse without altering files', () => {
  const root = fixture();
  try {
    const file = path.join(root, rootFile), original = fs.readFileSync(file, 'utf8');
    fs.unlinkSync(path.join(root, childFile)); assert.equal(call(root, 'complete').ok, false); assert.equal(fs.readFileSync(file, 'utf8'), original);
    fs.writeFileSync(file, original.replace('status: partial', 'status: invalid')); assert.equal(call(root, 'partial').ok, false); assert.match(fs.readFileSync(file, 'utf8'), /status: invalid/);
    fs.writeFileSync(file, original); const lease = acquireWriterLease({ checkouts: [root], requestId: 'test' });
    try { assert.equal(call(root, 'partial').ok, false); assert.equal(fs.readFileSync(file, 'utf8'), original); } finally { lease.release(); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('root option selects the exact root, and qualified IDs retain precedence', () => {
  const root = fixture();
  try {
    fs.mkdirSync(path.join(root, 'overlay'), { recursive: true });
    fs.mkdirSync(path.join(root, '.specplane'), { recursive: true });
    fs.writeFileSync(path.join(root, '.specplane/config.yaml'), 'spec_roots:\n  - {name: base, path: docs/specifications}\n  - {name: overlay, path: overlay, extends: base}\n');
    const before = fs.readFileSync(path.join(root, rootFile));
    const absent = executeOperation({ operation: 'spec.complete', arguments: { id: 'feature/root', root: 'overlay' } }, { checkout: root, extensionId: 'test' });
    assert.equal(absent.ok, false); assert.deepEqual(fs.readFileSync(path.join(root, rootFile)), before);
    const qualified = executeOperation({ operation: 'spec.complete', arguments: { id: 'base:feature/root', root: 'overlay', dryRun: true } }, { checkout: root, extensionId: 'test' });
    assert.ok(qualified.ok); assert.equal(qualified.value.id, 'base:feature/root');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('preimage checks reject injected config, root, dependency, missing candidate, HEAD, index and symlink races', () => {
  for (const target of ['config', 'root', 'dependency', 'grandchild', 'missing', 'head', 'index', 'symlink', 'parent-symlink', 'same-content'] as const) {
    const root = fixture();
    try {
      const file = path.join(root, rootFile), child = path.join(root, childFile);
      fs.mkdirSync(path.join(root, 'overlay/features'), { recursive: true });
      fs.mkdirSync(path.join(root, '.specplane'), { recursive: true });
      const config = path.join(root, '.specplane/config.yaml');
      fs.writeFileSync(config, 'spec_roots:\n  - {name: base, path: docs/specifications}\n  - {name: overlay, path: overlay}\n');
      const original = fs.readFileSync(file, 'utf8');
      const index = path.join(root, '.git/index'); const beforeIndex = fs.readFileSync(index);
      const dirty = fs.readFileSync(path.join(root, 'dirty'));
      let expectedIndex = beforeIndex;
      assert.throws(() => writeImplementation({ id: 'feature/root', status: 'complete' }, root, { beforeRecheck() {
        switch (target) {
          case 'config': fs.appendFileSync(config, '# changed\n'); break;
          case 'root': fs.appendFileSync(file, 'external root edit\n'); break;
          case 'dependency': fs.appendFileSync(child, 'external dependency edit\n'); break;
          case 'grandchild': fs.appendFileSync(path.join(root, 'docs/specifications/features/grandchild.md'), 'external edit\n'); break;
          case 'same-content': fs.renameSync(file, `${file}.saved`); fs.copyFileSync(`${file}.saved`, file); break;
          case 'missing': fs.writeFileSync(path.join(root, 'overlay/features/root.md'), original); break;
          case 'head': fs.writeFileSync(path.join(root, '.git/HEAD'), 'ref: refs/heads/other\n'); break;
          case 'index': expectedIndex = Buffer.concat([beforeIndex, Buffer.from('external')]); fs.writeFileSync(index, expectedIndex); break;
          case 'symlink': fs.renameSync(file, `${file}.saved`); fs.symlinkSync(`${file}.saved`, file); break;
          case 'parent-symlink': fs.renameSync(path.dirname(file), `${path.dirname(file)}.saved`); fs.symlinkSync(`${path.dirname(file)}.saved`, path.dirname(file)); break;
        }
      } }), /changed|Symlink/, target);
      const actualFile = target === 'symlink' ? `${file}.saved` : target === 'parent-symlink' ? path.join(`${path.dirname(file)}.saved`, 'root.md') : file;
      assert.equal(fs.readFileSync(actualFile, 'utf8'), original + (target === 'root' ? 'external root edit\n' : ''), target);
      assert.deepEqual(fs.readFileSync(index), expectedIndex, target);
      assert.deepEqual(fs.readFileSync(path.join(root, 'dirty')), dirty, target);
      assert.deepEqual(fs.readdirSync(path.dirname(actualFile)).filter(name => name.endsWith('.tmp')), [], target);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});

test('initial symlinks and aborted or locked operations refuse', () => {
  const root = fixture();
  try {
    const file = path.join(root, rootFile); fs.renameSync(file, `${file}.saved`); fs.symlinkSync(`${file}.saved`, file);
    assert.throws(() => writeImplementation({ id: 'feature/root', status: 'partial' }, root), /Symlink/);
    fs.unlinkSync(file); fs.renameSync(`${file}.saved`, file);
    const abort = new AbortController(); abort.abort();
    const cancelled = executeOperation({ operation: 'spec.complete', arguments: { id: 'feature/root' } }, { checkout: root, extensionId: 'test', signal: abort.signal });
    assert.ok(!cancelled.ok); assert.equal(cancelled.error.code, 'CANCELLED');
    const lease = acquireWriterLease({ checkouts: [root], requestId: 'test-core' });
    try {
      const locked = executeOperation({ operation: 'spec.complete', arguments: { id: 'feature/root' } }, { checkout: root, extensionId: 'test' });
      assert.ok(!locked.ok); assert.equal(locked.error.code, 'LOCKED'); assert.equal(locked.error.retryable, true);
    } finally { lease.release(); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('source-aware YAML updates preserve unrelated metadata, comments, delimiter and CRLF', () => {
  for (const form of ['indented', 'explicit', 'flow', 'flow-new', 'block', 'crlf'] as const) {
    const root = fixture();
    try {
      const file = path.join(root, rootFile);
      const fields = 'id: feature/root\ntitle: root\nstatus: approved\nauthor: user\n';
      let source = form === 'indented' ? '---\n  ' + (fields + 'implementation: {status: partial, evidence: [manual]}\n# keep comment\nother: keep\n').replace(/\n(?=.)/g, '\n  ') + '---\n# Body\n'
        : form === 'explicit' ? `---\n${fields}? implementation\n: {status: partial, evidence: [manual]}\n# keep comment\nother: keep\n---\n# Body\n`
        : form === 'flow' ? '---\n{id: feature/root, title: root, status: approved, author: user, implementation: {status: partial}, other: keep}\n---\n# Body\n'
        : form === 'flow-new' ? '---\n{id: feature/root, title: root, status: approved, author: user, other: keep}\n---\n# Body\n'
        : `---\n${fields}implementation:\n  status: partial\n  evidence: [manual]\n# keep comment\nother: keep\n--- # suffix\n# Body\n`;
      if (form === 'crlf') source = source.replace(/\n/g, '\r\n');
      fs.writeFileSync(file, source);
      const before = parseFrontmatter(source);
      const receipt = writeImplementation({ id: 'feature/root', status: 'complete' }, root);
      assert.equal(receipt.assessment_status, 'current', form);
      const after = fs.readFileSync(file, 'utf8'); const parsed = parseFrontmatter(after);
      const without = (data: Record<string, unknown>) => Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'implementation'));
      assert.deepEqual(without(parsed.data), without(before.data), form); assert.equal(parsed.body, before.body, form);
      if (source.includes('# keep comment')) assert.ok(after.includes('# keep comment'), form);
      if (source.includes('--- # suffix')) assert.ok(after.includes('--- # suffix'), form);
      if (form === 'crlf') assert.equal(after.replace(/\r\n/g, '').includes('\n'), false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});

test('an implementation anchor referenced elsewhere refuses rather than changing unrelated metadata', () => {
  const root = fixture();
  try {
    const file = path.join(root, rootFile);
    const source = `${header('root')}implementation: &old {status: partial}\nother: *old\n---\n# Body\n`;
    fs.writeFileSync(file, source);
    assert.throws(() => writeImplementation({ id: 'feature/root', status: 'complete' }, root));
    assert.equal(fs.readFileSync(file, 'utf8'), source);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('CLI and core report matching previews for each status and refuse invalid input', () => {
  const root = fixture();
  try {
    for (const status of ['incomplete', 'partial', 'complete'] as const) {
      const core = call(root, status, true); assert.ok(core.ok);
      const cli = spawnSync(process.execPath, [path.resolve('dist/cli.js'), 'spec', 'implementation', 'feature/root', '--status', status, '--dry-run', '--json'], { cwd: root, encoding: 'utf8' });
      assert.equal(cli.status, 0, cli.stderr); assert.deepEqual(JSON.parse(cli.stdout), core.value);
    }
    const invalid = spawnSync(process.execPath, [path.resolve('dist/cli.js'), 'spec', 'implementation', 'feature/root', '--status', 'bad'], { cwd: root, encoding: 'utf8' });
    assert.notEqual(invalid.status, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('lease ownership loss refuses before mutation and leaves no temporary file', () => {
  const root = fixture();
  try {
    const file = path.join(root, rootFile), before = fs.readFileSync(file);
    assert.throws(() => writeImplementation({ id: 'feature/root', status: 'complete' }, root, { beforeRecheck() {
      const dir = path.join(root, '.git/specplane-runtime');
      for (const name of fs.readdirSync(dir).filter(name => name.startsWith('checkout-'))) fs.unlinkSync(path.join(dir, name));
    } }));
    assert.deepEqual(fs.readFileSync(file), before);
    assert.deepEqual(fs.readdirSync(path.dirname(file)).filter(name => name.endsWith('.tmp')), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('dry run in a linked checkout creates no common runtime records', () => {
  const root = fixture(); const linked = `${root}-linked`;
  try {
    execFileSync('git', ['-C', root, 'add', '.']);
    execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']);
    execFileSync('git', ['-C', root, 'worktree', 'add', '-qb', 'fixture-linked', linked]);
    const result = call(linked, 'complete', true); assert.ok(result.ok);
    assert.equal(fs.existsSync(path.join(root, '.git/specplane-runtime')), false);
  } finally { fs.rmSync(linked, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true }); }
});

test('outside file and directory symlinks are refused without modifying targets', () => {
  for (const kind of ['file', 'directory', 'dangling'] as const) {
    const root = fixture(), outside = fs.mkdtempSync(path.join(os.tmpdir(), 'completion-outside-'));
    try {
      const file = path.join(root, rootFile), original = fs.readFileSync(file, 'utf8');
      const target = path.join(outside, 'root.md'); fs.writeFileSync(target, original);
      if (kind === 'directory') { fs.rmSync(path.dirname(file), { recursive: true }); fs.symlinkSync(outside, path.dirname(file)); }
      else { fs.unlinkSync(file); fs.symlinkSync(kind === 'dangling' ? path.join(outside, 'missing') : target, file); }
      assert.throws(() => writeImplementation({ id: 'feature/root', status: 'partial' }, root), /Symlink/);
      assert.equal(fs.readFileSync(target, 'utf8'), original); assert.equal(fs.lstatSync(kind === 'directory' ? path.dirname(file) : file).isSymbolicLink(), true);
    } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
  }
});
