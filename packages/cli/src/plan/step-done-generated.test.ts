import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { loadConfig } from '../config.js';
import { readTrailerEntries } from '../git/commit.js';
import { acquireWriterLease } from '../core/writer-leases.js';
import { repo, id, stepFile } from '../core/workflow-test-fixture.js';
import { stepDone, type GeneratedRecording } from './step-done.js';
import type { RecordingSet } from './recording-set.js';

function setup() {
  const r = repo(), file = 'specs/features/test.md';
  const before = fs.readFileSync(path.join(r.cwd, file), 'utf8');
  const after = before.replace('author: user\n', 'author: user\ncontributors: [{id: reviewer, kind: model, roles: [review]}]\n');
  const generated: GeneratedRecording = {
    changes: [{ path: file, before, after }],
    trailers: [['Specplane-Contribution', '{"event_id":"a"}'], ['Specplane-Contribution', '{"event_id":"b"}'], ['Specplane-Request', randomUUID()]],
  };
  const manifest: RecordingSet = { protocol: 1, head: r.git('rev-parse', 'HEAD'), branch: `plan/${id}`, changes: [] };
  const lease = acquireWriterLease({ repository: true, plans: [id], checkouts: [r.cwd], requestId: randomUUID() });
  const record = () => stepDone(id, { outcome: 'done', summary: 'record review', changed: [] }, loadConfig(r.cwd).config, r.cwd, lease, manifest, generated);
  const hook = (name: string, text: string) => {
    const target = path.join(r.cwd, '.git/hooks', name);
    fs.writeFileSync(target, `#!/bin/sh\n${text}\n`, { mode: 0o755 });
  };
  return { ...r, file, before, after, generated, manifest, lease, record, hook };
}

test('internal generated metadata and repeated contribution trailers commit with core progress', () => {
  const f = setup();
  try {
    let intent: Parameters<NonNullable<GeneratedRecording['beforeCommit']>>[0] | undefined;
    f.generated.beforeCommit = value => { intent = value; };
    const receipt = f.record();
    assert.equal(f.git('rev-parse', 'HEAD^'), f.manifest.head);
    assert.equal(f.git('show', `HEAD:${f.file}`) + '\n', f.after);
    assert.match(f.git('show', `HEAD:${stepFile}`), /status: done/);
    assert.equal(f.git('status', '--porcelain'), '');
    const trailers = readTrailerEntries(receipt.commit, f.cwd);
    assert.deepEqual(trailers.filter(([key]) => key === 'Specplane-Contribution'), f.generated.trailers.slice(0, 2));
    assert.deepEqual(trailers.filter(([key]) => key === 'Specplane-Request'), f.generated.trailers.slice(2));
    assert.ok(intent);
    assert.equal(intent.tree, f.git('rev-parse', 'HEAD^{tree}'));
    assert.equal(intent.message.trimEnd(), f.git('log', '-1', '--format=%B'));
    assert.equal(intent.head, f.manifest.head);
    assert.equal(intent.branch, f.manifest.branch);
    const { commit: _commit, ...identity } = receipt;
    assert.deepEqual(intent.receipt, identity);
  } finally { f.lease.release(); }
});

test('durable intent failure rolls back generated writes before making a commit', () => {
  const f = setup();
  try {
    f.generated.beforeCommit = () => { throw new Error('intent persistence failed'); };
    assert.throws(f.record, /intent persistence failed/);
    assert.equal(f.git('rev-parse', 'HEAD'), f.manifest.head);
    assert.equal(fs.readFileSync(path.join(f.cwd, f.file), 'utf8'), f.before);
    assert.equal(f.git('status', '--porcelain'), '');
  } finally { f.lease.release(); }
});

test('intent callback runs for an empty extension and cannot change checked output', () => {
  const f = setup();
  try {
    f.generated.changes = []; f.generated.trailers = [];
    let called = false;
    f.generated.beforeCommit = () => { called = true; f.put(stepFile, fs.readFileSync(path.join(f.cwd, stepFile), 'utf8') + 'concurrent edit\n'); };
    assert.throws(f.record, /Recording recovery required/);
    assert.equal(called, true);
    assert.equal(f.git('rev-parse', 'HEAD'), f.manifest.head);
    assert.match(fs.readFileSync(path.join(f.cwd, stepFile), 'utf8'), /concurrent edit/);
  } finally { f.lease.release(); }
});

test('failed commit restores matching generated metadata, progress and original index', () => {
  const f = setup();
  try {
    const index = fs.readFileSync(path.join(f.cwd, '.git/index'));
    f.hook('pre-commit', 'exit 1');
    assert.throws(f.record, /git commit/);
    assert.equal(f.git('rev-parse', 'HEAD'), f.manifest.head);
    assert.equal(fs.readFileSync(path.join(f.cwd, f.file), 'utf8'), f.before);
    assert.match(fs.readFileSync(path.join(f.cwd, stepFile), 'utf8'), /status: pending/);
    assert.equal(fs.existsSync(path.join(f.cwd, `plans/${id}/HANDOFF.md`)), false);
    assert.ok(fs.readFileSync(path.join(f.cwd, '.git/index')).equals(index));
    assert.equal(f.git('status', '--porcelain'), '');
  } finally { f.lease.release(); }
});

test('concurrent generated-file edits during a failed hook require recovery and survive', () => {
  const f = setup();
  try {
    f.hook('pre-commit', `printf 'concurrent edit' >> ${f.file}\nexit 1`);
    assert.throws(f.record, /Recording recovery required/);
    assert.equal(f.git('rev-parse', 'HEAD'), f.manifest.head);
    assert.equal(fs.readFileSync(path.join(f.cwd, f.file), 'utf8'), f.after + 'concurrent edit');
  } finally { f.lease.release(); }
});

test('commit-message hooks cannot alter repeated core contribution values unnoticed', () => {
  const f = setup();
  try {
    f.hook('commit-msg', 'printf "Specplane-Contribution: tampered\\n" >> "$1"');
    assert.throws(f.record, /Recording recovery required/);
    assert.notEqual(f.git('rev-parse', 'HEAD'), f.manifest.head);
    assert.equal(fs.readFileSync(path.join(f.cwd, f.file), 'utf8'), f.after);
  } finally { f.lease.release(); }
});

test('commit-message hooks cannot alter non-trailer text outside the immutable intended message', () => {
  const f = setup();
  try {
    f.hook('commit-msg', 'printf "\\nUnreviewed hook text\\n" >> "$1"');
    assert.throws(f.record, /committed message differs from the exact reviewed intent/);
    assert.notEqual(f.git('rev-parse', 'HEAD'), f.manifest.head);
    assert.equal(fs.readFileSync(path.join(f.cwd, f.file), 'utf8'), f.after);
  } finally { f.lease.release(); }
});

test('caller edits and stale generated preimages refuse before progress writes', () => {
  for (const staged of [false, true]) {
    const f = setup();
    try {
      fs.writeFileSync(path.join(f.cwd, f.file), f.before + 'caller edit\n');
      if (staged) f.git('add', '--', f.file);
      const index = fs.readFileSync(path.join(f.cwd, '.git/index'));
      assert.throws(f.record, /preimage changed|pre-existing core progress edit/);
      assert.equal(f.git('rev-parse', 'HEAD'), f.manifest.head);
      assert.equal(fs.readFileSync(path.join(f.cwd, f.file), 'utf8'), f.before + 'caller edit\n');
      assert.ok(fs.readFileSync(path.join(f.cwd, '.git/index')).equals(index));
      assert.equal(fs.existsSync(path.join(f.cwd, `plans/${id}/HANDOFF.md`)), false);
    } finally { f.lease.release(); }
  }
});

test('generated transaction transport requires private lease and manifest and closed core trailers', () => {
  const f = setup();
  try {
    const opts = { outcome: 'done', summary: 'record review' };
    const config = loadConfig(f.cwd).config;
    assert.throws(() => stepDone(id, opts, config, f.cwd, undefined, undefined, f.generated), /held writer lease and internal manifest/);
    for (const trailers of [[['Specplane-Step', '99']], [['Specplane-Request', 'one'], ['Specplane-Request', 'two']], [['Specplane-Agent', 'one'], ['Specplane-Agent', 'two']], [['Specplane-Session', 'invented']]] as [string, string][][]) {
      f.generated.trailers = trailers;
      assert.throws(f.record, /generated recording trailer|(?:request|agent) trailer must occur once/i);
    }
    assert.equal(f.git('rev-parse', 'HEAD'), f.manifest.head);
    assert.equal(f.git('status', '--porcelain'), '');
  } finally { f.lease.release(); }
});

test('verified structured host attribution supersedes environment agent and omits unproved sessions', () => {
  const f = setup(), agent = process.env.SPECPLANE_AGENT, session = process.env.SPECPLANE_SESSION;
  try {
    process.env.SPECPLANE_AGENT = 'hostile-environment'; process.env.SPECPLANE_SESSION = 'invented-native-session';
    f.generated.trailers.push(['Specplane-Agent', 'codex']);
    const receipt = f.record(), trailers = readTrailerEntries(receipt.commit, f.cwd);
    assert.deepEqual(trailers.filter(([key]) => key === 'Specplane-Agent'), [['Specplane-Agent', 'codex']]);
    assert.deepEqual(trailers.filter(([key]) => key === 'Specplane-Session'), []);
  } finally {
    if (agent === undefined) delete process.env.SPECPLANE_AGENT; else process.env.SPECPLANE_AGENT = agent;
    if (session === undefined) delete process.env.SPECPLANE_SESSION; else process.env.SPECPLANE_SESSION = session;
    f.lease.release();
  }
});

test('step prewrite intent precedes generated metadata HANDOFF and status writes', () => {
  const f = setup();
  try {
    let called = false;
    f.generated.beforeWrite = intent => {
      called = true;
      assert.equal(fs.readFileSync(path.join(f.cwd, f.file), 'utf8'), f.before);
      assert.match(fs.readFileSync(path.join(f.cwd, stepFile), 'utf8'), /status: pending/);
      assert.equal(fs.existsSync(path.join(f.cwd, `plans/${id}/HANDOFF.md`)), false);
      assert.equal(intent.transaction.generated.find(c => c.path.endsWith('/HANDOFF.md'))?.before, null);
      assert.equal(intent.transaction.generated.find(c => c.path === stepFile)?.before?.includes('status: pending'), true);
      assert.match(f.git('show', `${intent.tree}:${stepFile}`), /status: done/);
      assert.equal(f.git('show', `${intent.tree}:${f.file}`) + '\n', f.after);
      throw new Error('prewrite evidence unavailable');
    };
    assert.throws(f.record, /prewrite evidence unavailable/);
    assert.ok(called); assert.equal(f.git('status', '--porcelain'), '');
    assert.equal(f.git('rev-parse', 'HEAD'), f.manifest.head);
  } finally { f.lease.release(); }
});

test('foreign index-lock bytes or replacement preserve pending step transaction for reconciliation', () => {
  for (const phase of ['beforeWrite', 'beforeCommit'] as const) for (const replace of [false, true]) {
    const f = setup();
    try {
      const index = fs.readFileSync(path.join(f.cwd, '.git/index')), lock = path.join(f.cwd, '.git/index.lock');
      f.generated[phase] = () => {
        if (replace) fs.renameSync(lock, lock + '.original');
        fs.writeFileSync(lock, 'foreign lock contents');
      };
      assert.throws(f.record, /Recording recovery required/);
      assert.equal(f.git('rev-parse', 'HEAD'), f.manifest.head);
      assert.equal(fs.readFileSync(lock, 'utf8'), 'foreign lock contents');
      assert.ok(fs.readFileSync(path.join(f.cwd, '.git/index')).equals(index));
      assert.equal(fs.readFileSync(path.join(f.cwd, f.file), 'utf8'), phase === 'beforeWrite' ? f.before : f.after);
      assert.match(fs.readFileSync(path.join(f.cwd, stepFile), 'utf8'), phase === 'beforeWrite' ? /status: pending/ : /status: done/);
    } finally { f.lease.release(); }
  }
});
