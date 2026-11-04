import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CONFIG, makeRepo, spec } from '../test-repo.js';
import { prepareConfirmation as prepareConfirmedOperation, confirmOperation as confirmConfirmedOperation } from './index.js';
import { acquireWriterLease } from './writer-leases.js';
import { loadConfig } from '../config.js';
import { startPlan } from '../plan/flows.js';
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

test('invalid batches, dry runs, other lifecycle decisions and extra authorization fields refuse', async () => {
  const f = fixture(); try {
    const cases = [
      { operation: 'spec.approve', arguments: { ids: ['feature/draft', 'feature/approved'] } },
      { operation: 'spec.approve', arguments: { ids: ['feature/draft'], dryRun: true } },
      { operation: 'plan.cleanup', arguments: { id: planId } },
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

test('hardlinked governed inputs refuse before human review', async () => {
  const f = fixture(); try {
    fs.linkSync(path.join(f.root, 'specs/features/draft.md'), path.join(f.root, 'linked.txt'));
    const result = await prepareConfirmedOperation(approve, f.context);
    assert.equal(result.ok, false); assert.equal(f.shown(), undefined);
    if (!result.ok) assert.match(result.error.message, /hard links/);
  } finally { f.cleanup(); }
});

test('overlay approval displays exact refreshed pins and commits only the reviewed bytes', async () => {
  for (const variant of ['confirm', 'decline', 'changed-base', 'dirty-base'] as const) {
    const f = fixture(); try {
      const relative = 'ext-specs/features/overlay.md';
      fs.mkdirSync(path.dirname(path.join(f.root, relative)), { recursive: true });
      fs.writeFileSync(path.join(f.root, relative), spec({ id: 'feature/overlay', title: 'Overlay', status: 'review', author: 'user', extends: 'feature/approved' }));
      f.git('add', '.'); f.git('commit', '-m', 'overlay');
      const before = f.git('rev-parse', 'HEAD');
      const original = fs.readFileSync(path.join(f.root, relative), 'utf8');
      const base = path.join(f.root, 'specs/features/approved.md');
      if (variant === 'dirty-base') fs.appendFileSync(base, '\nUncommitted base change.\n');
      if (variant === 'decline') f.context.interaction = { async confirm(c) {
        assert.match(c.summary, /based_on:/);
        return { challengeId: c.challengeId, decision: 'decline', interactionId: 'declined' };
      } };
      const prepared = await prepareConfirmedOperation({ operation: 'spec.approve', arguments: { ids: ['ext:feature/overlay'] } }, f.context);
      assert.equal(fs.readFileSync(path.join(f.root, relative), 'utf8'), original);
      assert.equal(f.git('rev-parse', 'HEAD'), before);
      if (variant === 'decline' || variant === 'dirty-base') {
        assert.equal(prepared.ok, false, JSON.stringify(prepared));
        if (variant === 'dirty-base') assert.equal(f.shown(), undefined);
        continue;
      }
      assert.equal(prepared.ok, true, JSON.stringify(prepared)); if (!prepared.ok) continue;
      assert.match(prepared.value.summary, /Exact change: ext-specs\/features\/overlay.md/);
      const hash = f.git('rev-parse', '--short', 'HEAD:specs/features/approved.md');
      assert.ok(prepared.value.summary.includes(`feature/approved: "${hash}"`));
      if (variant === 'changed-base') fs.appendFileSync(base, '\nChanged after review.\n');
      const result = confirmConfirmedOperation(prepared.value, f.response(), f.context);
      assert.equal(result.ok, variant === 'confirm', JSON.stringify(result));
      if (variant === 'confirm') {
        const after = fs.readFileSync(path.join(f.root, relative), 'utf8');
        assert.ok(prepared.value.summary.endsWith(after));
        assert.equal(f.git('show', `HEAD:${relative}`), after.trim());
        assert.equal(f.git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'), relative);
      } else {
        assert.equal(f.git('rev-parse', 'HEAD'), before);
        assert.equal(fs.readFileSync(path.join(f.root, relative), 'utf8'), original);
      }
    } finally { f.cleanup(); }
  }
});

test('ordered spec batches preview dependent approvals without changing source HEAD or staging', async () => {
  const f = fixture(); try {
    const overlay = 'ext-specs/features/overlay.md';
    fs.mkdirSync(path.dirname(path.join(f.root, overlay)), { recursive: true });
    fs.writeFileSync(path.join(f.root, overlay), spec({ id: 'feature/overlay', title: 'Overlay', status: 'review', author: 'user', extends: 'feature/draft' }));
    f.git('add', '.'); f.git('commit', '-m', 'overlay');
    fs.writeFileSync(path.join(f.root, 'unrelated.txt'), 'keep staging'); f.git('add', 'unrelated.txt');
    const index = f.git('show', ':unrelated.txt'), head = f.git('rev-parse', 'HEAD');
    const hookLog = path.join(f.root, 'hook-ran');
    fs.writeFileSync(path.join(f.root, '.git/hooks/post-commit'), `#!/bin/sh\necho ran >> '${hookLog}'\n`, { mode: 0o755 });
    const request: MechanicalRequest = { operation: 'spec.approve', arguments: { ids: ['feature/draft', 'ext:feature/overlay', 'architecture/pending'] } };
    const prepared = await prepareConfirmedOperation(request, f.context);
    assert.equal(prepared.ok, true, JSON.stringify(prepared)); if (!prepared.ok) return;
    assert.deepEqual(prepared.value.targets, request.arguments.ids);
    assert.equal(f.git('rev-parse', 'HEAD'), head);
    assert.equal(f.git('show', ':unrelated.txt'), index);
    assert.equal(fs.existsSync(hookLog), false, 'preview cannot execute source hooks');
    assert.match(prepared.value.summary, /one commit per target/);
    assert.match(prepared.value.summary, /based_on:/);
    const result = confirmConfirmedOperation(prepared.value, f.response(), f.context);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(f.git('rev-list', '--count', `${head}..HEAD`), '3');
    const after = fs.readFileSync(path.join(f.root, overlay), 'utf8');
    assert.ok(prepared.value.summary.includes(after));
    assert.ok(after.includes(f.git('rev-parse', '--short=7', 'HEAD:specs/features/draft.md')));
    assert.equal(f.git('show', ':unrelated.txt'), index);
    assert.equal(fs.readFileSync(hookLog, 'utf8'), 'ran\nran\nran\n');
  } finally { f.cleanup(); }
});

test('plan batches preview each successive prospective index', async () => {
  const f = fixture(); try {
    const second = '2026-01-02-second';
    const file = `plans/${second}/PLAN.md`;
    fs.mkdirSync(path.dirname(path.join(f.root, file)), { recursive: true });
    fs.writeFileSync(path.join(f.root, file), `---\nid: ${second}\ntitle: Second\nstatus: draft\nspecs: [feature/approved]\n---\n# Plan\n`);
    f.git('add', '.'); f.git('commit', '-m', 'second');
    const head = f.git('rev-parse', 'HEAD');
    const prepared = await prepareConfirmedOperation({ operation: 'plan.approve', arguments: { ids: [planId, second] } }, f.context);
    assert.equal(prepared.ok, true, JSON.stringify(prepared)); if (!prepared.ok) return;
    assert.equal(f.git('rev-parse', 'HEAD'), head);
    assert.equal(fs.existsSync(path.join(f.root, 'plans/PLANS.md')), false);
    const result = confirmConfirmedOperation(prepared.value, f.response(), f.context);
    assert.equal(result.ok, true, JSON.stringify(result));
    const first = f.git('show', 'HEAD~1:plans/PLANS.md');
    const final = fs.readFileSync(path.join(f.root, 'plans/PLANS.md'), 'utf8');
    assert.notEqual(first.trim(), final.trim());
    assert.ok(prepared.value.summary.includes(first));
    assert.ok(prepared.value.summary.endsWith(final));
    assert.equal(f.git('rev-list', '--count', `${head}..HEAD`), '2');
  } finally { f.cleanup(); }
});

test('batch refusals and decline cannot partially approve targets', async () => {
  for (const variant of ['reverse', 'alias', 'decline', 'dirty-policy', 'staged-target', 'changed-after'] as const) {
    const f = fixture(); try {
      const head = f.git('rev-parse', 'HEAD');
      let ids = ['feature/draft', 'architecture/pending'];
      if (variant === 'reverse') ids.reverse();
      if (variant === 'alias') ids = ['feature/draft', 'base:feature/draft'];
      if (variant === 'dirty-policy') fs.writeFileSync(path.join(f.root, 'specs/ignored-note.txt'), 'uncommitted');
      if (variant === 'staged-target') {
        const file = path.join(f.root, 'specs/features/draft.md'), before = fs.readFileSync(file, 'utf8');
        fs.appendFileSync(file, '\nstaged\n'); f.git('add', 'specs/features/draft.md'); fs.writeFileSync(file, before);
      }
      if (variant === 'decline') f.context.interaction = { async confirm(c) { return { challengeId: c.challengeId, decision: 'decline', interactionId: 'decline' }; } };
      const prepared = await prepareConfirmedOperation({ operation: 'spec.approve', arguments: { ids } }, f.context);
      if (variant === 'changed-after') {
        assert.equal(prepared.ok, true, JSON.stringify(prepared)); if (!prepared.ok) continue;
        fs.appendFileSync(path.join(f.root, 'specs/architecture/pending.md'), '\nchanged\n');
        assert.equal(confirmConfirmedOperation(prepared.value, f.response(), f.context).ok, false);
      } else assert.equal(prepared.ok, false, `${variant}: ${JSON.stringify(prepared)}`);
      assert.equal(f.git('rev-parse', 'HEAD'), head);
      assert.match(fs.readFileSync(path.join(f.root, 'specs/features/draft.md'), 'utf8'), /status: "review"/);
      acquireWriterLease({ repository: true, checkouts: [f.root], requestId: 'after' }).release();
    } finally { f.cleanup(); }
  }
});

test('decision batches show exact text and retain separate approval commits', async () => {
  const f = fixture(); try {
    const file = 'decisions/0002-second.md';
    fs.writeFileSync(path.join(f.root, file), '---\nid: decision/0002\ntitle: Second\ndate: 2026-01-02\nstatus: proposed\n---\n# Second\n');
    f.git('add', '.'); f.git('commit', '-m', 'second decision');
    const before = f.git('rev-parse', 'HEAD');
    const prepared = await prepareConfirmedOperation({ operation: 'decision.accept', arguments: { ids: ['0001', 'decision/0002'] } }, f.context);
    assert.equal(prepared.ok, true, JSON.stringify(prepared)); if (!prepared.ok) return;
    assert.equal(f.git('rev-parse', 'HEAD'), before);
    assert.match(prepared.value.summary, /Exact change: decisions\/0002-second.md/);
    const result = confirmConfirmedOperation(prepared.value, f.response(), f.context);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(prepared.value.summary.endsWith(fs.readFileSync(path.join(f.root, file), 'utf8')));
    assert.equal(f.git('rev-list', '--count', `${before}..HEAD`), '2');
  } finally { f.cleanup(); }
});

test('a hook changing later batch evidence stops after the completed commit and cannot replay consent', async () => {
  const f = fixture(); try {
    const before = f.git('rev-parse', 'HEAD');
    const prepared = await prepareConfirmedOperation({ operation: 'spec.approve', arguments: { ids: ['feature/draft', 'architecture/pending'] } }, f.context);
    assert.equal(prepared.ok, true, JSON.stringify(prepared)); if (!prepared.ok) return;
    fs.writeFileSync(path.join(f.root, '.git/hooks/post-commit'), '#!/bin/sh\necho foreign >> specs/architecture/pending.md\n', { mode: 0o755 });
    const result = confirmConfirmedOperation(prepared.value, f.response(), f.context);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'RECOVERY_REQUIRED');
    assert.equal(f.git('rev-list', '--count', `${before}..HEAD`), '1');
    assert.match(fs.readFileSync(path.join(f.root, 'specs/architecture/pending.md'), 'utf8'), /status: "review"/);
    assert.match(fs.readFileSync(path.join(f.root, 'specs/architecture/pending.md'), 'utf8'), /foreign/);
    assert.equal(confirmConfirmedOperation(prepared.value, f.response(), f.context).ok, false);
  } finally { f.cleanup(); }
});

test('trusted abandonment displays exact lifecycle/index output and retains all leases until consumption', async () => {
  const f = fixture(); try {
    const before = f.git('rev-parse', 'HEAD');
    const prepared = await prepareConfirmedOperation({ operation: 'plan.abandon', arguments: { id: planId } }, f.context);
    assert.equal(prepared.ok, true, JSON.stringify(prepared)); if (!prepared.ok) return;
    assert.equal(f.git('rev-parse', 'HEAD'), before);
    assert.match(prepared.value.summary, /Exact change: plans\/PLANS.md/);
    assert.match(prepared.value.summary, /status: abandoned/);
    assert.match(prepared.value.summary, /Delete branch: none/);
    assert.throws(() => acquireWriterLease({ repository: true, plans: [planId], checkouts: [f.root], requestId: 'other' }), /held/);
    const result = confirmConfirmedOperation(prepared.value, f.response(), f.context);
    assert.equal(result.ok, true, JSON.stringify(result));
    const paths = f.git('ls-files').split('\n');
    const planFile = paths.find(file => file.endsWith(`/${planId}/PLAN.md`));
    assert.ok(planFile);
    assert.match(fs.readFileSync(path.join(f.root, planFile!), 'utf8'), /status: abandoned/);
    assert.match(f.git('log', '-1', '--format=%B'), /Specplane-Workflow: abandon/);
    assert.equal(confirmConfirmedOperation(prepared.value, f.response(), f.context).ok, false);
    acquireWriterLease({ repository: true, plans: [planId], checkouts: [f.root], requestId: 'after' }).release();
  } finally { f.cleanup(); }
});

test('trusted abandonment refuses forced removal and invalidates changed refs and index consent', async () => {
  for (const change of ['force', 'ref', 'index'] as const) {
    const f = fixture(); try {
      const before = f.git('rev-parse', 'HEAD');
      const prepared = await prepareConfirmedOperation({ operation: 'plan.abandon', arguments: { id: planId, ...(change === 'force' ? { force: true } : {}) } }, f.context);
      if (change === 'force') {
        assert.equal(prepared.ok, false); assert.equal(f.shown(), undefined);
        if (!prepared.ok) assert.equal(prepared.error.code, 'UNSUPPORTED_CAPABILITY');
      } else {
        assert.equal(prepared.ok, true, JSON.stringify(prepared)); if (!prepared.ok) continue;
        if (change === 'ref') f.git('branch', 'new-ref');
        else { fs.writeFileSync(path.join(f.root, 'unrelated.txt'), 'staged'); f.git('add', 'unrelated.txt'); }
        const result = confirmConfirmedOperation(prepared.value, f.response(), f.context);
        assert.equal(result.ok, false);
        assert.match(fs.readFileSync(path.join(f.root, `plans/${planId}/PLAN.md`), 'utf8'), /status: draft/);
      }
      assert.equal(f.git('rev-parse', 'HEAD'), before);
      acquireWriterLease({ repository: true, plans: [planId], checkouts: [f.root], requestId: 'after' }).release();
    } finally { f.cleanup(); }
  }
});


test('trusted abandonment initiated in a plan worktree removes it and releases the complete lease set', async () => {
  const f = fixture();
  const worktrees = fs.mkdtempSync(path.join(path.dirname(f.root), 'confirmation-worktrees-'));
  try {
    const configFile = path.join(f.root, '.specplane/config.yaml');
    fs.appendFileSync(configFile, `execution:\n  backend: worktree\n  worktree_dir: ${worktrees}\n`);
    const planFile = path.join(f.root, `plans/${planId}/PLAN.md`);
    fs.writeFileSync(planFile, fs.readFileSync(planFile, 'utf8').replace('status: draft', 'status: ready'));
    fs.writeFileSync(path.join(f.root, 'ext-specs/.gitkeep'), '');
    f.git('add', '.'); f.git('commit', '-m', 'ready');
    const started = startPlan(planId, loadConfig(f.root).config, f.root);
    assert.ok(started.path);
    const checkout = started.path!;
    const context = { ...f.context, checkout };
    const prepared = await prepareConfirmedOperation({ operation: 'plan.abandon', arguments: { id: planId, deleteBranch: true } }, context);
    assert.equal(prepared.ok, true, JSON.stringify(prepared)); if (!prepared.ok) return;
    assert.ok(fs.existsSync(checkout));
    assert.match(prepared.value.summary, /Delete branch: plan\//);
    for (const target of [f.root, checkout]) assert.throws(() => acquireWriterLease({ checkouts: [target], requestId: 'other' }), /held/);
    const result = confirmConfirmedOperation(prepared.value, f.response(), context);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(fs.existsSync(checkout), false);
    assert.equal(f.git('branch', '--list', `plan/${planId}`), '');
    acquireWriterLease({ repository: true, plans: [planId], checkouts: [f.root], requestId: 'after' }).release();
  } finally { f.cleanup(); fs.rmSync(worktrees, { recursive: true, force: true }); }
});

test('trusted abandonment binds changed governed bytes in a different registered checkout', async () => {
  const f = fixture();
  const worktrees = fs.mkdtempSync(path.join(path.dirname(f.root), 'confirmation-worktrees-'));
  try {
    fs.appendFileSync(path.join(f.root, '.specplane/config.yaml'), `execution:\n  backend: worktree\n  worktree_dir: ${worktrees}\n`);
    const planFile = path.join(f.root, `plans/${planId}/PLAN.md`);
    fs.writeFileSync(planFile, fs.readFileSync(planFile, 'utf8').replace('status: draft', 'status: ready'));
    fs.writeFileSync(path.join(f.root, 'ext-specs/.gitkeep'), '');
    f.git('add', '.'); f.git('commit', '-m', 'ready');
    const started = startPlan(planId, loadConfig(f.root).config, f.root);
    assert.ok(started.path);
    const before = f.git('rev-parse', 'HEAD');
    const prepared = await prepareConfirmedOperation({ operation: 'plan.abandon', arguments: { id: planId } }, f.context);
    assert.equal(prepared.ok, true, JSON.stringify(prepared)); if (!prepared.ok) return;
    fs.appendFileSync(path.join(started.path!, 'specs/features/draft.md'), '\nchanged elsewhere\n');
    const result = confirmConfirmedOperation(prepared.value, f.response(), f.context);
    assert.equal(result.ok, false);
    assert.equal(f.git('rev-parse', 'HEAD'), before);
    assert.ok(fs.existsSync(started.path!));
    assert.match(fs.readFileSync(path.join(started.path!, 'specs/features/draft.md'), 'utf8'), /changed elsewhere/);
    acquireWriterLease({ repository: true, plans: [planId], checkouts: [f.root, started.path!], requestId: 'after' }).release();
  } finally { f.cleanup(); fs.rmSync(worktrees, { recursive: true, force: true }); }
});
