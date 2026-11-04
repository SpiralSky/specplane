import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { repo } from './workflow-test-fixture.js';
import { sha256 } from './workflow-preparation.js';
import { acquireWriterLease } from './writer-leases.js';
import { recordContent, type ContentRecording } from './content-recording.js';

function setup() {
  const r = repo(), file = 'specs/features/test.md';
  r.git('switch', '-c', 'work/content');
  const original = fs.readFileSync(path.join(r.cwd, file), 'utf8');
  const reviewed = original + '\nReviewed body addition.\n';
  const after = reviewed.replace('author: user\n', 'author: mixed\ncontributors: [{id: model, kind: model, roles: [revise]}]\n');
  r.put(file, reviewed);
  const input: ContentRecording = {
    manifest: { protocol: 1, head: r.git('rev-parse', 'HEAD'), branch: 'work/content', changes: [{ path: file, beforeDigest: sha256(original), afterDigest: sha256(reviewed), purpose: 'reviewed body' }] },
    generated: [{ path: file, before: reviewed, after }],
    message: 'docs: record reviewed content\n\nSpecplane-Workflow: spec-draft-architecture\nSpecplane-Request: request\n',
  };
  const lease = acquireWriterLease({ checkouts: [r.cwd], requestId: randomUUID() });
  const record = () => recordContent(input, r.cwd, lease);
  const hook = (name: string, text: string) => fs.writeFileSync(path.join(r.cwd, '.git/hooks', name), `#!/bin/sh\n${text}\n`, { mode: 0o755 });
  return { ...r, file, original, reviewed, after, input, lease, record, hook };
}

test('non-plan content commits reviewed body and generated metadata in one exact transaction', () => {
  const f = setup();
  try {
    let intent: Parameters<NonNullable<ContentRecording['beforeCommit']>>[0] | undefined;
    f.input.beforeCommit = value => { intent = value; };
    const receipt = f.record();
    assert.equal(receipt.commit, f.git('rev-parse', 'HEAD'));
    assert.equal(f.git('rev-parse', 'HEAD^'), f.input.manifest.head);
    assert.equal(f.git('show', `HEAD:${f.file}`) + '\n', f.after);
    assert.equal(f.git('status', '--porcelain'), '');
    assert.ok(intent);
    assert.equal(intent.head, f.input.manifest.head);
    assert.equal(intent.branch, 'work/content');
    assert.equal(intent.tree, f.git('rev-parse', 'HEAD^{tree}'));
    assert.equal(intent.message, f.input.message);
    assert.equal(f.git('log', '-1', '--format=%B'), f.input.message.trimEnd());
  } finally { f.lease.release(); }
});

test('failed content commit restores only generated metadata and preserves reviewed body and index', () => {
  const f = setup();
  try {
    f.git('add', '--', f.file);
    const index = fs.readFileSync(path.join(f.cwd, '.git/index'));
    f.hook('pre-commit', 'exit 1');
    assert.throws(f.record, /git commit/);
    assert.equal(f.git('rev-parse', 'HEAD'), f.input.manifest.head);
    assert.equal(fs.readFileSync(path.join(f.cwd, f.file), 'utf8'), f.reviewed);
    assert.ok(fs.readFileSync(path.join(f.cwd, '.git/index')).equals(index));
  } finally { f.lease.release(); }
});

test('fully staged reviewed body remains valid when core adds contribution metadata', () => {
  const f = setup();
  try {
    f.git('add', '--', f.file);
    f.record();
    assert.equal(fs.readFileSync(path.join(f.cwd, f.file), 'utf8'), f.after);
    assert.equal(f.git('status', '--porcelain'), '');
  } finally { f.lease.release(); }
});

test('durable content intent failure rolls back generated metadata without undoing caller edits', () => {
  const f = setup();
  try {
    f.input.beforeCommit = () => { throw new Error('cannot persist intent'); };
    assert.throws(f.record, /cannot persist intent/);
    assert.equal(f.git('rev-parse', 'HEAD'), f.input.manifest.head);
    assert.equal(fs.readFileSync(path.join(f.cwd, f.file), 'utf8'), f.reviewed);
  } finally { f.lease.release(); }
});

test('content commit hooks cannot silently change the committed message', () => {
  const f = setup();
  try {
    f.hook('commit-msg', 'printf "tampered\\n" >> "$1"');
    assert.throws(f.record, { code: 'RECOVERY_REQUIRED' });
    assert.notEqual(f.git('rev-parse', 'HEAD'), f.input.manifest.head);
    assert.equal(fs.readFileSync(path.join(f.cwd, f.file), 'utf8'), f.after);
    assert.match(f.git('log', '-1', '--format=%B'), /tampered/);
  } finally { f.lease.release(); }
});

test('callback or failed-hook content replacements survive recovery refusal', () => {
  for (const callback of [false, true]) {
    const f = setup();
    try {
      if (callback) f.input.beforeCommit = () => f.put(f.file, f.after + 'intervening edit');
      else f.hook('pre-commit', `printf 'intervening edit' >> ${f.file}\nexit 1`);
      assert.throws(f.record, { code: 'RECOVERY_REQUIRED' });
      assert.equal(f.git('rev-parse', 'HEAD'), f.input.manifest.head);
      assert.equal(fs.readFileSync(path.join(f.cwd, f.file), 'utf8'), f.after + 'intervening edit');
    } finally { f.lease.release(); }
  }
});

test('unrelated edits and partial staging refuse before generated writes and preserve index', () => {
  for (const partial of [false, true]) {
    const f = setup();
    try {
      if (partial) {
        f.put(f.file, f.original + 'partly staged\n'); f.git('add', '--', f.file); f.put(f.file, f.reviewed);
      } else f.put('source.ts', 'unrelated change');
      const index = fs.readFileSync(path.join(f.cwd, '.git/index'));
      assert.throws(f.record, partial ? /partial staging/ : /unreviewed change/);
      assert.equal(f.git('rev-parse', 'HEAD'), f.input.manifest.head);
      assert.equal(fs.readFileSync(path.join(f.cwd, f.file), 'utf8'), f.reviewed);
      assert.ok(fs.readFileSync(path.join(f.cwd, '.git/index')).equals(index));
    } finally { f.lease.release(); }
  }
});

test('clean generated metadata joins an existing body edit without becoming caller-authorized content', () => {
  const f = setup();
  try {
    f.input.generated = [];
    const cleanFile = 'source.ts', before = fs.readFileSync(path.join(f.cwd, cleanFile), 'utf8'), after = before + '\nmetadata';
    f.input.generated.push({ path: cleanFile, before, after });
    f.record();
    assert.equal(fs.readFileSync(path.join(f.cwd, f.file), 'utf8'), f.reviewed);
    assert.equal(fs.readFileSync(path.join(f.cwd, cleanFile), 'utf8'), after);
    assert.equal(f.git('status', '--porcelain'), '');
  } finally { f.lease.release(); }
});

test('empty recording and stale or duplicate generated preimages refuse before mutation', () => {
  const f = setup();
  try {
    f.input.generated[0].before += 'stale';
    assert.throws(f.record, { code: 'STALE_STATE' });
    f.input.generated[0].before = f.reviewed;
    f.input.generated.push({ ...f.input.generated[0] });
    assert.throws(f.record, /Duplicate generated/);
    f.input.generated = []; f.input.manifest.changes = [];
    assert.throws(f.record, /actual file change/);
    assert.equal(fs.readFileSync(path.join(f.cwd, f.file), 'utf8'), f.reviewed);
    assert.equal(f.git('rev-parse', 'HEAD'), f.input.manifest.head);
  } finally { f.lease.release(); }
});


test('pending Git operations refuse before generated writes or commit', () => {
  for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'REBASE_HEAD']) {
    const f = setup();
    try {
      const index = fs.readFileSync(path.join(f.cwd, '.git/index'));
      const file = path.join(f.cwd, '.git', marker), content = f.input.manifest.head + '\n';
      fs.writeFileSync(file, content);
      assert.throws(f.record, /unfinished Git operation/);
      assert.equal(f.git('rev-parse', 'HEAD'), f.input.manifest.head);
      assert.equal(fs.readFileSync(path.join(f.cwd, f.file), 'utf8'), f.reviewed);
      assert.equal(fs.readFileSync(file, 'utf8'), content);
      assert.ok(fs.readFileSync(path.join(f.cwd, '.git/index')).equals(index));
    } finally { f.lease.release(); }
  }
});

test('prewrite journal receives the intended tree and preimages before any generated content is written', () => {
  const f = setup();
  try {
    let beforeWrite = false;
    f.input.beforeWrite = intent => {
      beforeWrite = true;
      assert.equal(fs.readFileSync(path.join(f.cwd, f.file), 'utf8'), f.reviewed);
      assert.equal(f.git('rev-parse', 'HEAD'), f.input.manifest.head);
      assert.equal(intent.transaction.generated[0].before, f.reviewed);
      assert.equal(intent.transaction.generated[0].after, f.after);
      assert.equal(intent.transaction.indexBeforeDigest, sha256(fs.readFileSync(path.join(f.cwd, '.git/index'))));
      assert.match(intent.transaction.temporaryIndexBasename, /^specplane-content-/);
      const lock = fs.statSync(path.join(f.cwd, '.git/index.lock'), { bigint: true });
      assert.equal(intent.transaction.indexLock.ino, String(lock.ino));
      assert.equal(f.git('show', `${intent.tree}:${f.file}`) + '\n', f.after);
      throw new Error('prewrite journal refused');
    };
    assert.throws(f.record, /prewrite journal refused/);
    assert.ok(beforeWrite);
    assert.equal(fs.readFileSync(path.join(f.cwd, f.file), 'utf8'), f.reviewed);
    assert.equal(f.git('rev-parse', 'HEAD'), f.input.manifest.head);
  } finally { f.lease.release(); }
});

test('dedicated creation executes after prewrite evidence and commits exact generated bytes', () => {
  const f = setup();
  try {
    const file = 'new.md', scaffold = '# Scaffold\n', after = '# Final exact body\n';
    f.input.generated.push({ path: file, before: null, after });
    let journaled = false, applied = false;
    f.input.beforeWrite = intent => { journaled = true; assert.equal(fs.existsSync(path.join(f.cwd, file)), false); assert.equal(intent.transaction.generated.find(c => c.path === file)?.before, null); assert.equal(intent.transaction.generated.find(c => c.path === file)?.afterMode, 0o600 & ~process.umask()); };
    f.input.creation = { files: [{ path: file, scaffold }], apply: () => { assert.ok(journaled); applied = true; fs.writeFileSync(path.join(f.cwd, file), scaffold, { flag: 'wx', mode: 0o600 }); } };
    f.record();
    assert.ok(applied); assert.equal(fs.readFileSync(path.join(f.cwd, file), 'utf8'), after);
    assert.equal(fs.statSync(path.join(f.cwd, file)).mode & 0o777, 0o600 & ~process.umask());
    assert.equal(f.git('status', '--porcelain'), '');
  } finally { f.lease.release(); }
});

test('failed partial creation removes only matching scaffolds and preserves unexpected bytes', () => {
  for (const changed of [false, true]) {
    const f = setup();
    try {
      const file = 'new.md', scaffold = '# Scaffold\n';
      f.input.generated.push({ path: file, before: null, after: '# Final\n' });
      f.input.creation = { files: [{ path: file, scaffold }], apply: () => { fs.writeFileSync(path.join(f.cwd, file), changed ? 'external content' : scaffold, { flag: 'wx', mode: 0o600 }); throw new Error('creation interrupted'); } };
      assert.throws(f.record, changed ? /requires reconciliation/ : /creation interrupted/);
      if (changed) assert.equal(fs.readFileSync(path.join(f.cwd, file), 'utf8'), 'external content');
      else assert.equal(fs.existsSync(path.join(f.cwd, file)), false);
      assert.equal(fs.readFileSync(path.join(f.cwd, f.file), 'utf8'), f.reviewed);
      assert.equal(f.git('rev-parse', 'HEAD'), f.input.manifest.head);
    } finally { f.lease.release(); }
  }
});

test('foreign index-lock bytes or replacement refuse before commit and survive cleanup', () => {
  for (const phase of ['beforeWrite', 'beforeCommit'] as const) for (const replace of [false, true]) {
    const f = setup();
    try {
      const index = fs.readFileSync(path.join(f.cwd, '.git/index')), lock = path.join(f.cwd, '.git/index.lock');
      f.input[phase] = () => {
        if (replace) fs.renameSync(lock, lock + '.original');
        fs.writeFileSync(lock, 'foreign lock contents');
      };
      assert.throws(f.record, { code: 'RECOVERY_REQUIRED' });
      assert.equal(f.git('rev-parse', 'HEAD'), f.input.manifest.head);
      assert.equal(fs.readFileSync(lock, 'utf8'), 'foreign lock contents');
      assert.ok(fs.readFileSync(path.join(f.cwd, '.git/index')).equals(index));
      assert.equal(fs.readFileSync(path.join(f.cwd, f.file), 'utf8'), phase === 'beforeWrite' ? f.reviewed : f.after);
    } finally { f.lease.release(); }
  }
});
