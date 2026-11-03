import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CONFIG, makeRepo, spec } from '../test-repo.js';
import { prepareConfirmation as prepareConfirmedOperation, confirmOperation as confirmConfirmedOperation } from './index.js';
import { acquireWriterLease } from './writer-leases.js';
import type { CoreContext, MechanicalRequest, ConfirmationChallenge, ConfirmationResponse } from './contracts.js';

const planId = '2026-01-01-confirmation';
function fixture() {
  const root = makeRepo({
    '.specplane/config.yaml': CONFIG,
    'specs/features/draft.md': spec({ id: 'feature/draft', title: 'Draft', status: 'review', author: 'user' }),
    'specs/features/approved.md': spec({ id: 'feature/approved', title: 'Approved', status: 'approved', author: 'user' }),
    'specs/architecture/pending.md': spec({ id: 'architecture/pending', title: 'Pending', status: 'review', author: 'user', implements: ['feature/draft'] }),
    [`plans/${planId}/PLAN.md`]: `---\nid: ${planId}\ntitle: Confirmation\nstatus: draft\nspecs: [feature/approved]\n---\n# Plan\n`,
    'decisions/0001-example.md': '---\nid: decision/0001\ntitle: Example\ndate: 2026-01-01\nstatus: proposed\n---\n# Example\n',
    '.gitignore': 'specs/ignored-note.txt\n',
  });
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com'); git('add', '.'); git('commit', '-m', 'initial');
  let shown: ConfirmationChallenge | undefined, response: ConfirmationResponse | undefined;
  let instant = new Date('2026-11-03T00:00:00Z');
  const signal = new AbortController();
  const context: CoreContext = { checkout: root, extensionId: 'test', signal: signal.signal, clock: { now: () => instant }, interaction: { async confirm(challenge) {
    shown = structuredClone(challenge); response = { challengeId: challenge.challengeId, decision: 'confirm', interactionId: 'direct-human-event' }; return response;
  } } };
  return { root, git, context, signal, shown: () => shown!, response: () => response!, expire: () => { instant = new Date('2026-11-03T00:16:00Z'); }, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
const approve: MechanicalRequest = { operation: 'spec.approve', arguments: { ids: ['feature/draft'] } };

test('approval adapters invoke real spec, reopen, plan-index and ADR operations after direct confirmation', async () => {
  const cases: [MechanicalRequest, string, string][] = [
    [approve, 'specs/features/draft.md', 'approved'],
    [{ operation: 'spec.reopen', arguments: { id: 'feature/approved' } }, 'specs/features/approved.md', 'review'],
    [{ operation: 'plan.approve', arguments: { ids: [planId] } }, `plans/${planId}/PLAN.md`, 'ready'],
    [{ operation: 'decision.accept', arguments: { ids: ['decision/0001'] } }, 'decisions/0001-example.md', 'accepted'],
  ];
  for (const [request, file, status] of cases) {
    const f = fixture(); try {
      const before = f.git('rev-parse', 'HEAD');
      const prepared = await prepareConfirmedOperation(request, f.context);
      assert.equal(prepared.ok, true, JSON.stringify(prepared)); if (!prepared.ok) continue;
      assert.equal(f.git('rev-parse', 'HEAD'), before, 'human response alone does not mutate');
      assert.match(prepared.value.summary, new RegExp(file.replaceAll('.', '\\.')));
      assert.match(prepared.value.summary, /Reviewed content:/);
      assert.throws(() => acquireWriterLease({ repository: true, checkouts: [f.root], requestId: 'contender' }), /held/);
      const result = confirmConfirmedOperation(prepared.value, f.response(), f.context);
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.match(fs.readFileSync(path.join(f.root, file), 'utf8'), new RegExp(`^status: ${status}$`, 'm'));
      assert.notEqual(f.git('rev-parse', 'HEAD'), before);
      assert.match(f.git('log', '-1', '--format=%B'), /Specplane-Workflow: approve/);
      if (request.operation === 'plan.approve') assert.match(fs.readFileSync(path.join(f.root, 'plans/PLANS.md'), 'utf8'), /ready/);
      if (request.operation === 'plan.approve') {
        assert.match(prepared.value.summary, /Exact change: plans\/PLANS.md/);
        assert.ok(prepared.value.summary.includes(fs.readFileSync(path.join(f.root, 'plans/PLANS.md'), 'utf8')));
      }
      assert.equal(confirmConfirmedOperation(prepared.value, f.response(), f.context).ok, false);
      acquireWriterLease({ repository: true, checkouts: [f.root], requestId: 'after' }).release();
    } finally { f.cleanup(); }
  }
});

test('approval dependency policies refuse before displaying a challenge', async () => {
  const f = fixture(); try {
    const before = f.git('rev-parse', 'HEAD');
    const result = await prepareConfirmedOperation({ operation: 'spec.approve', arguments: { ids: ['architecture/pending'] } }, f.context);
    assert.equal(result.ok, false); assert.equal(f.shown(), undefined);
    if (!result.ok) assert.match(result.error.message, /not.*approved/);
    assert.equal(f.git('rev-parse', 'HEAD'), before);
    acquireWriterLease({ repository: true, checkouts: [f.root], requestId: 'after' }).release();
  } finally { f.cleanup(); }
});

test('decline and missing host interaction cannot mutate or retain an active lease', async () => {
  for (const missing of [false, true]) {
    const f = fixture(); try {
      const before = f.git('rev-parse', 'HEAD');
      f.context.interaction = missing ? undefined : { async confirm(c) { return { challengeId: c.challengeId, decision: 'decline', interactionId: 'event' }; } };
      const result = await prepareConfirmedOperation(approve, f.context);
      assert.equal(result.ok, false); assert.equal(f.git('rev-parse', 'HEAD'), before);
      acquireWriterLease({ repository: true, checkouts: [f.root], requestId: 'after' }).release();
    } finally { f.cleanup(); }
  }
});

test('ignored governed bytes and unrelated Git index changes invalidate prepared approvals', async () => {
  for (const change of ['ignored', 'index', 'branch', 'expire', 'cancel'] as const) {
    const f = fixture(); try {
      const before = f.git('rev-parse', 'HEAD');
      const prepared = await prepareConfirmedOperation(approve, f.context); assert.equal(prepared.ok, true); if (!prepared.ok) continue;
      if (change === 'ignored') fs.writeFileSync(path.join(f.root, 'specs/ignored-note.txt'), 'changed policy context');
      if (change === 'index') { fs.writeFileSync(path.join(f.root, 'unrelated.txt'), 'staged'); f.git('add', 'unrelated.txt'); }
      if (change === 'branch') f.git('checkout', '-b', 'different');
      if (change === 'expire') f.expire();
      if (change === 'cancel') f.signal.abort();
      const result = confirmConfirmedOperation(prepared.value, f.response(), f.context);
      assert.equal(result.ok, false); assert.equal(f.git('rev-parse', 'HEAD'), before);
      assert.match(fs.readFileSync(path.join(f.root, 'specs/features/draft.md'), 'utf8'), /status: "review"/);
    } finally { f.cleanup(); }
  }
});

test('forged response, changed challenge and another extension cannot consume the trusted decision', async () => {
  const f = fixture(); try {
    const prepared = await prepareConfirmedOperation(approve, f.context); assert.equal(prepared.ok, true); if (!prepared.ok) return;
    assert.equal(confirmConfirmedOperation(prepared.value, { ...f.response(), interactionId: 'model' }, f.context).ok, false);
    assert.equal(confirmConfirmedOperation({ ...prepared.value, operation: 'plan.approve' }, f.response(), f.context).ok, false);
    assert.equal(confirmConfirmedOperation(prepared.value, f.response(), { ...f.context, extensionId: 'other' }).ok, false);
    assert.equal(confirmConfirmedOperation(prepared.value, f.response(), f.context).ok, true);
  } finally { f.cleanup(); }
});

test('unsupported batches, dry runs, other lifecycle decisions and extra authorization fields refuse', async () => {
  const f = fixture(); try {
    const cases = [
      { operation: 'spec.approve', arguments: { ids: ['feature/draft', 'feature/approved'] } },
      { operation: 'spec.approve', arguments: { ids: ['feature/draft'], dryRun: true } },
      { operation: 'plan.finish', arguments: { id: planId } },
      { ...approve, confirmed: true },
    ];
    for (const request of cases) assert.equal((await prepareConfirmedOperation(request as MechanicalRequest, f.context)).ok, false);
    assert.equal(f.shown(), undefined);
  } finally { f.cleanup(); }
});

test('caller request mutation cannot change the operation stored with the trusted response', async () => {
  const f = fixture(); try {
    const request = structuredClone(approve);
    const prepared = await prepareConfirmedOperation(request, f.context); assert.equal(prepared.ok, true); if (!prepared.ok) return;
    (request.arguments as { ids: string[] }).ids[0] = 'feature/approved';
    const result = confirmConfirmedOperation(prepared.value, f.response(), f.context);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.match(fs.readFileSync(path.join(f.root, 'specs/features/draft.md'), 'utf8'), /^status: approved$/m);
  } finally { f.cleanup(); }
});

test('caller context replacement cannot remove the original cancellation signal', async () => {
  const f = fixture(); try {
    const prepared = await prepareConfirmedOperation(approve, f.context); assert.equal(prepared.ok, true); if (!prepared.ok) return;
    f.context.signal = new AbortController().signal;
    f.signal.abort();
    assert.equal(confirmConfirmedOperation(prepared.value, f.response(), f.context).ok, false);
    acquireWriterLease({ repository: true, checkouts: [f.root], requestId: 'after' }).release();
  } finally { f.cleanup(); }
});

test('a newly cancelled confirmation request refuses even if preparation signal remains active', async () => {
  const f = fixture(); try {
    const prepared = await prepareConfirmedOperation(approve, f.context); assert.equal(prepared.ok, true); if (!prepared.ok) return;
    assert.equal(confirmConfirmedOperation(prepared.value, f.response(), { ...f.context, signal: AbortSignal.abort() }).ok, false);
    assert.equal(confirmConfirmedOperation(prepared.value, f.response(), f.context).ok, true);
  } finally { f.cleanup(); }
});

test('hardlinked governed inputs and overlay pin changes refuse before human review', async () => {
  for (const variant of ['hardlink', 'overlay'] as const) {
    const f = fixture(); try {
      if (variant === 'hardlink') fs.linkSync(path.join(f.root, 'specs/features/draft.md'), path.join(f.root, 'linked.txt'));
      else {
        fs.writeFileSync(path.join(f.root, 'specs/features/draft.md'), spec({ id: 'feature/draft', title: 'Draft', status: 'review', author: 'user', extends: 'feature/approved' }));
        f.git('add', '.'); f.git('commit', '-m', 'overlay');
      }
      const result = await prepareConfirmedOperation(approve, f.context);
      assert.equal(result.ok, false); assert.equal(f.shown(), undefined);
      if (!result.ok) assert.match(result.error.message, variant === 'hardlink' ? /hard links/ : /exact pin-change preview/);
    } finally { f.cleanup(); }
  }
});
