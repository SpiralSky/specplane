import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createConfirmation, type DirectInteractionPort } from './confirmation.js';
import { acquireWriterLease, checkoutIdentity } from './writer-leases.js';
import type { ConfirmationChallenge, ConfirmationResponse } from './contracts.js';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'confirmation-'));
  const cwd = path.join(root, 'main'), other = path.join(root, 'other'), alias = path.join(root, 'alias');
  fs.mkdirSync(cwd);
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  git('init'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'initial');
  git('worktree', 'add', '-b', 'other', other); fs.symlinkSync(cwd, alias, 'dir');
  const file = path.join(cwd, 'reviewed.txt'); fs.writeFileSync(file, 'reviewed body');
  const lease = acquireWriterLease({ checkouts: [cwd], requestId: 'decision' });
  let time = new Date('2026-11-03T00:00:00Z'), payload = 'exact final text', evidence = 'acceptance report and gaps', mutations = 0;
  let delivered: ConfirmationResponse | undefined;
  const context = { checkout: cwd, extensionId: 'test' };
  const controller = new AbortController();
  const defaultInteraction: DirectInteractionPort = { async confirm(challenge) {
    delivered = { challengeId: challenge.challengeId, decision: 'confirm', interactionId: 'human-event-1' };
    return delivered;
  } };
  const create = (interaction: DirectInteractionPort | undefined = defaultInteraction, mutate?: () => void) => createConfirmation({
    ...context, operation: 'spec.approve', lease,
    snapshot: () => ({ targets: ['feature/test'], summary: 'Approve the displayed revision', payload, evidence, state: { head: git('rev-parse', 'HEAD'), branch: git('symbolic-ref', 'HEAD'), index: git('ls-files', '--stage'), file: fs.readFileSync(file, 'utf8'), target: git('rev-parse', 'other') } }),
    mutate: () => { mutations++; mutate?.(); return 'recorded'; },
  }, { interaction, clock: { now: () => time }, signal: controller.signal });
  const runtime = path.join(checkoutIdentity(cwd).commonDir, 'specplane-runtime');
  const journal = () => path.join(runtime, fs.readdirSync(runtime).find(f => f.startsWith('confirmation-'))!);
  return { cwd, other, alias, context, lease, controller, create, git, file, journal,
    response: () => structuredClone(delivered!), count: () => mutations,
    expire: () => { time = new Date('2026-11-03T00:15:00Z'); },
    changePayload: () => { payload = 'changed text'; }, changeEvidence: () => { evidence = 'changed report'; },
    cleanup: () => { try { lease.release(); } catch {} fs.rmSync(root, { recursive: true, force: true }); },
  };
}

test('trusted interaction binds full displayed challenge, persists one-use consumption before mutation', async () => {
  const f = fixture(); try {
    const service = f.create(undefined, () => assert.equal(JSON.parse(fs.readFileSync(f.journal(), 'utf8')).phase, 'consuming'));
    const challenge = await service.prepare();
    assert.equal(challenge.operation, 'spec.approve'); assert.deepEqual(challenge.targets, ['feature/test']);
    assert.equal(challenge.expiresAt, '2026-11-03T00:15:00.000Z');
    assert.equal(fs.statSync(f.journal()).mode & 0o777, 0o600);
    assert.equal(service.confirm(challenge, f.response(), { ...f.context, checkout: f.alias }), 'recorded');
    assert.equal(f.count(), 1);
    assert.throws(() => service.confirm(challenge, f.response(), f.context), /No unconsumed/);
    await assert.rejects(service.prepare(), /already prepared/);
  } finally { f.cleanup(); }
});

test('forged model responses cannot authorize before or during the host interaction', async () => {
  const f = fixture(); try {
    let release!: (r: ConfirmationResponse) => void, shown!: ConfirmationChallenge;
    const service = f.create({ confirm: c => { shown = c; return new Promise(resolve => { release = resolve; }); } });
    const pending = service.prepare(); await new Promise(resolve => setImmediate(resolve));
    const response: ConfirmationResponse = { challengeId: shown.challengeId, decision: 'confirm', interactionId: 'model-invented' };
    assert.throws(() => service.confirm(shown, response, f.context), /No unconsumed/);
    release({ ...response, decision: 'decline' });
    await assert.rejects(pending, /declined/); assert.equal(f.count(), 0);
  } finally { f.cleanup(); }
});

test('decline, unavailable response, malformed response and wrong challenge refuse', async () => {
  for (const choice of ['decline', 'null', 'malformed', 'wrong'] as const) {
    const f = fixture(); try {
      const service = f.create({ async confirm(c) {
        if (choice === 'null') return null;
        return { challengeId: choice === 'wrong' ? 'wrong' : c.challengeId, decision: choice === 'decline' ? 'decline' : 'confirm', interactionId: 'event', ...(choice === 'malformed' ? { authorization: true } : {}) };
      } });
      await assert.rejects(service.prepare(), /declined/); assert.equal(f.count(), 0);
      assert.equal(JSON.parse(fs.readFileSync(f.journal(), 'utf8')).phase, 'refused');
    } finally { f.cleanup(); }
  }
});

test('changed bytes, payload, evidence, branch, index or destination invalidate human consent', async () => {
  for (const change of ['file', 'payload', 'evidence', 'branch', 'index', 'target'] as const) {
    const f = fixture(); try {
      const service = f.create(); const challenge = await service.prepare();
      if (change === 'file') fs.writeFileSync(f.file, 'changed');
      if (change === 'payload') f.changePayload();
      if (change === 'evidence') f.changeEvidence();
      if (change === 'branch') f.git('checkout', '-b', 'moved');
      if (change === 'index') f.git('add', 'reviewed.txt');
      if (change === 'target') { const next = f.git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'new target'); f.git('update-ref', 'refs/heads/other', next); }
      assert.throws(() => service.confirm(challenge, f.response(), f.context), /changed/);
      assert.equal(f.count(), 0);
    } finally { f.cleanup(); }
  }
});

test('expiration, cancellation, cross-checkout use and changed lease refuse', async () => {
  for (const change of ['expire', 'cancel', 'checkout', 'extension', 'lease', 'response', 'challenge'] as const) {
    const f = fixture(); try {
      const service = f.create(); const challenge = await service.prepare(), response = f.response();
      if (change === 'expire') f.expire();
      if (change === 'cancel') f.controller.abort();
      if (change === 'lease') f.lease.release();
      if (change === 'response') response.interactionId = 'forged';
      if (change === 'challenge') challenge.summary = 'different effect';
      assert.throws(() => service.confirm(challenge, response, { checkout: change === 'checkout' ? f.other : f.cwd, extensionId: change === 'extension' ? 'another' : 'test' }));
      assert.equal(f.count(), 0);
    } finally { f.cleanup(); }
  }
});

test('cancellation stops a pending interaction and a late affirmative response cannot revive it', async () => {
  const f = fixture(); try {
    let answer!: (r: ConfirmationResponse) => void, shown!: ConfirmationChallenge;
    const service = f.create({ confirm: c => { shown = c; return new Promise(resolve => { answer = resolve; }); } });
    const pending = service.prepare(); await new Promise(resolve => setImmediate(resolve)); f.controller.abort();
    await assert.rejects(pending, /cancelled/);
    const response: ConfirmationResponse = { challengeId: shown.challengeId, decision: 'confirm', interactionId: 'late' };
    answer(response);
    assert.throws(() => service.confirm(shown, response, f.context), /No unconsumed/); assert.equal(f.count(), 0);
  } finally { f.cleanup(); }
});

test('changed or linked private journal refuses without mutating the linked file', async () => {
  for (const link of [false, true]) {
    const f = fixture(); try {
      const service = f.create(); const challenge = await service.prepare();
      if (link) { const journal = f.journal(); fs.unlinkSync(journal); fs.symlinkSync(f.file, journal); }
      else fs.writeFileSync(f.journal(), '{}');
      assert.throws(() => service.confirm(challenge, f.response(), f.context)); assert.equal(f.count(), 0);
      assert.equal(fs.readFileSync(f.file, 'utf8'), 'reviewed body');
    } finally { f.cleanup(); }
  }
});

test('uncertain mutation leaves consuming journal and cannot replay', async () => {
  const f = fixture(); try {
    const service = f.create(undefined, () => { throw new Error('interrupted mutation'); });
    const challenge = await service.prepare();
    assert.throws(() => service.confirm(challenge, f.response(), f.context), /interrupted/);
    assert.equal(JSON.parse(fs.readFileSync(f.journal(), 'utf8')).phase, 'consuming');
    assert.throws(() => service.confirm(challenge, f.response(), f.context), /No unconsumed/);
    assert.equal(f.count(), 1);
  } finally { f.cleanup(); }
});

test('missing trusted interaction refuses even when the caller possesses a valid response shape', async () => {
  const f = fixture(); try {
    const service = createConfirmation({ ...f.context, operation: 'spec.approve', lease: f.lease,
      snapshot: () => { throw new Error('must not collect a snapshot without a port'); },
      mutate: () => assert.fail('must not mutate'),
    }, {});
    await assert.rejects(service.prepare(), /direct-human/);
  } finally { f.cleanup(); }
});

test('expired or changed review during direct interaction cannot establish a ready response', async () => {
  for (const change of ['expire', 'edit', 'display'] as const) {
    const f = fixture(); try {
      const service = f.create({ async confirm(c) {
        if (change === 'expire') f.expire();
        if (change === 'edit') fs.writeFileSync(f.file, 'changed while reviewing');
        if (change === 'display') c.summary = 'different displayed operation';
        return { challengeId: c.challengeId, decision: 'confirm', interactionId: 'event' };
      } });
      await assert.rejects(service.prepare()); assert.equal(f.count(), 0);
      assert.equal(JSON.parse(fs.readFileSync(f.journal(), 'utf8')).phase, 'refused');
    } finally { f.cleanup(); }
  }
});
