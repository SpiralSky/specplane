import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fixture, repo, id } from './workflow-test-fixture.js';
import { prepareWorkflow, validateWorkflowResult, recordWorkflow } from './index.js';
import { releaseStoppedPreparation, sha256 } from './workflow-preparation.js';
import { prepareVerifyReview, recordVerifyReview, type VerifyReviewRequest } from './verify-review.js';
import { checkoutIdentity } from './writer-leases.js';
import type { ConfirmationChallenge, ConfirmationResponse, CoreContext, WorkflowResult } from './contracts.js';

const WORKER = 'session:worker-1';
const REVIEWER = 'agent:reviewer-1';

interface Options { gaps?: string; config?: string; branchConfig?: string; mode?: 'attended' | 'unattended'; decision?: 'confirm' | 'decline' | 'none' }
async function setup(options: Options = {}) {
  const r = repo(options.config ?? '');
  if (options.branchConfig) {
    const file = path.join(r.cwd, '.specplane/config.yaml');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8') + options.branchConfig);
    r.git('commit', '-qam', 'change verification after start');
  }
  if (options.gaps !== undefined) { r.put(`plans/${id}/spec-gaps.md`, options.gaps); r.git('add', '-A'); r.git('commit', '-qm', 'earlier gaps'); }
  const p = await fixture('plan-step');
  const shown: ConfirmationChallenge[] = [];
  const decision = options.decision ?? 'confirm';
  const context: CoreContext = {
    checkout: r.cwd, extensionId: p.host.extensionId, compatibility: { manifest: p.manifest, host: p.host },
    ...(decision === 'none' ? {} : { interaction: { confirm: async (challenge: ConfirmationChallenge): Promise<ConfirmationResponse> => { shown.push(structuredClone(challenge)); return { challengeId: challenge.challengeId, decision: decision as 'confirm' | 'decline', interactionId: `dialog-${shown.length}` }; } } }),
  };
  const prepared = await prepareWorkflow({ protocol: 1, workflow: 'plan-step', extensionId: context.extensionId, checkout: r.cwd, mode: options.mode ?? 'attended', selection: { planId: id } }, context);
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  if (!prepared.ok) throw new Error('prepare failed');
  const value = prepared.value;
  const result = (files: string[], overrides: Partial<WorkflowResult> = {}): WorkflowResult => {
    for (const file of files) r.put(file, `content of ${file}\n`);
    return {
      protocol: 1, requestId: value.requestId, baseDigest: value.base.digest, outcome: 'done', summary: 'change things',
      changes: files.map(file => ({ path: file, beforeDigest: 'missing' as const, afterDigest: sha256(fs.readFileSync(path.join(r.cwd, file))), purpose: 'edit' })),
      criterionEvidence: value.criteria.map(c => ({ criterionId: c.id, assessment: 'met' as const, rationale: 'Read the file against the criterion', artifacts: files.length ? [{ path: files[0], digest: sha256(fs.readFileSync(path.join(r.cwd, files[0]))), kind: 'file' as const }] : [] })),
      gaps: [], contextExpansion: [], contributionEvents: [], openIssues: '', nextKnows: '', ...overrides,
    };
  };
  const blocked = (files: string[]): WorkflowResult => {
    const res = result(files, { outcome: 'blocked', openIssues: 'BLOCKED: the review failed' });
    res.criterionEvidence = value.criteria.map(c => ({ criterionId: c.id, assessment: 'unmet' as const, rationale: 'The review failed', artifacts: [] }));
    return res;
  };
  const validate = (res: WorkflowResult) => validateWorkflowResult(value, res, context);
  const review = async (verdict: 'pass' | 'fail', findings: string[] = [], reviewer = REVIEWER) => {
    const asked = await prepareVerifyReview({ requestId: value.requestId, workerSession: WORKER }, context);
    assert.equal(asked.ok, true, JSON.stringify(asked));
    if (!asked.ok) throw new Error('review prepare failed');
    return { request: asked.value, recorded: await recordVerifyReview({ reviewId: asked.value.requestId, reviewerSession: reviewer, result: { verdict, findings } }, context) };
  };
  const record = async (res: WorkflowResult) => {
    const proposal = await validate(res);
    assert.equal(proposal.ok, true, JSON.stringify(proposal));
    if (!proposal.ok) throw new Error('validate failed');
    return recordWorkflow(proposal.value, context);
  };
  return { ...r, p, context, shown, prepared: value, result, blocked, validate, review, record, close: () => releaseStoppedPreparation(value.requestId) };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
function refused(outcome: { ok: boolean; error?: { code: string; message: string } }, pattern: RegExp, code = 'INVALID_EVIDENCE') {
  assert.equal(outcome.ok, false, JSON.stringify(outcome));
  assert.equal(outcome.error?.code, code);
  assert.match(outcome.error?.message ?? '', pattern);
}
const handoffOf = (f: Fixture) => fs.readFileSync(path.join(f.cwd, 'plans', id, 'HANDOFF.md'), 'utf8');
const gapsOf = (f: Fixture) => fs.readFileSync(path.join(f.cwd, 'plans', id, 'spec-gaps.md'), 'utf8');
const RISKY = '.claude/x.md';

test('a verify-review request is read-only, carries spec context, criteria and diff, and takes no lease', async () => {
  const f = await setup();
  try {
    f.result([RISKY]);
    const asked = await prepareVerifyReview({ requestId: f.prepared.requestId, workerSession: WORKER }, f.context);
    assert.equal(asked.ok, true);
    if (!asked.ok) return;
    const request: VerifyReviewRequest = asked.value;
    assert.equal(request.workflow, 'verify-review');
    assert.equal(request.readOnly, true);
    assert.deepEqual(request.allowedEditPaths, []);
    assert.equal(request.parentRequestId, f.prepared.requestId);
    assert.deepEqual(request.criteria.map(c => c.id), f.prepared.criteria.map(c => c.id));
    assert.ok(request.context.some(entry => entry.path.startsWith('specs/')));
    assert.ok(request.changedPaths.includes(RISKY));
    assert.match(request.diff, /content of \.claude\/x\.md/);
    assert.equal('conversation' in request, false);
    // No second lease: the parent can still be recorded and released as usual.
    const leaseDir = path.join(checkoutIdentity(f.cwd).commonDir, 'specplane-runtime');
    assert.equal(fs.readdirSync(leaseDir).filter(name => name.includes(request.requestId)).length, 0);
    refused(await prepareVerifyReview({ requestId: f.prepared.requestId, workerSession: '' }, f.context), /worker session identity/);
    refused(await prepareVerifyReview({ requestId: 'no-such-request', workerSession: WORKER }, f.context), /unavailable|not|owner/i, 'STALE_STATE');
  } finally { f.close(); }
});

test('a risk step records done after a passing review of the same state', async () => {
  const f = await setup();
  try {
    const res = f.result([RISKY]);
    refused(await f.validate(res), /Missing verification check: separate or human/);
    const { recorded } = await f.review('pass');
    assert.equal(recorded.ok, true, JSON.stringify(recorded));
    const receipt = await f.record(res);
    assert.equal(receipt.ok, true, JSON.stringify(receipt));
    assert.match(handoffOf(f), /Verification: tier risk; .* by separate; .*checked by separate\./);
  } finally { f.close(); }
});

test('a review goes stale when a file changes after it', async () => {
  const f = await setup();
  try {
    const res = f.result([RISKY]);
    assert.equal((await f.review('pass')).recorded.ok, true);
    f.put(RISKY, 'changed after the review\n');
    res.changes[0].afterDigest = sha256(fs.readFileSync(path.join(f.cwd, RISKY)));
    res.criterionEvidence[0].artifacts[0].digest = res.changes[0].afterDigest;
    refused(await f.validate(res), /Missing verification check: separate or human/);
    // A review prepared before a change cannot be recorded after it either.
    f.put(RISKY, 'back to a state the review will cover\n');
    const early = await prepareVerifyReview({ requestId: f.prepared.requestId, workerSession: WORKER }, f.context);
    if (!early.ok) throw new Error('prepare failed');
    f.put(RISKY, 'changed again\n');
    const late = await recordVerifyReview({ reviewId: early.value.requestId, reviewerSession: 'agent:other', result: { verdict: 'pass', findings: [] } }, f.context);
    refused(late, /review is stale/, 'STALE_STATE');
  } finally { f.close(); }
});

test('a fail verdict never satisfies the check, and its findings become numbered gaps when the step ends blocked', async () => {
  const f = await setup();
  try {
    const res = f.result([RISKY]);
    const failing = await f.review('fail', ['The criterion is not covered by the edit.', 'A second\nfinding on two lines.']);
    assert.equal(failing.recorded.ok, true);
    if (failing.recorded.ok) assert.equal(failing.recorded.value.satisfied, false);
    refused(await f.validate(res), /Missing verification check: separate or human/);
    const receipt = await f.record(f.blocked([RISKY]));
    assert.equal(receipt.ok, true, JSON.stringify(receipt));
    const gaps = gapsOf(f);
    assert.match(gaps, /^# Spec gaps — 2026-11-03-test\n\n## G1: The criterion is not covered by the edit\.\n\n\*\*Kind\*\*: gap\n\*\*Step\*\*: 01\n\*\*Case\*\*: The criterion is not covered by the edit\.\n\*\*Resolution\*\*: .*\n\*\*Target spec\*\*: `base:feature\/test`\n\*\*Status\*\*: open\n\n## G2: A second finding on two lines\./);
    assert.match(handoffOf(f), /### Gaps found in specs\n\n- G1 \(gap\): The criterion is not covered by the edit\.\. See `spec-gaps\.md`\.\n- G2 \(gap\)/);
    assert.match(handoffOf(f), /findings recorded as G1, G2/);
  } finally { f.close(); }
});

test('findings of a passing review are appended after existing gaps when the step is done', async () => {
  const f = await setup({ gaps: '# Spec gaps — 2026-11-03-test\n\n## G4: Earlier\n\n**Kind**: gap\n**Step**: 01\n**Case**: c\n**Resolution**: r\n**Target spec**: `base:feature/test`\n**Status**: open\n' });
  try {
    const res = f.result([RISKY]);
    assert.equal((await f.review('pass', ['Minor: name the new file in the docs.'])).recorded.ok, true);
    const receipt = await f.record(res);
    assert.equal(receipt.ok, true, JSON.stringify(receipt));
    assert.match(gapsOf(f), /## G4: Earlier\n[\s\S]*\*\*Status\*\*: open\n\n## G5: Minor: name the new file in the docs\./);
    assert.match(handoffOf(f), /- G5 \(gap\): Minor: name the new file in the docs\.\. See/);
    assert.equal(f.git('status', '--porcelain'), '');
  } finally { f.close(); }
});

test('a review whose session identity equals the worker is refused and records nothing', async () => {
  const f = await setup();
  try {
    const res = f.result([RISKY]);
    const same = await f.review('pass', [], WORKER);
    refused(same.recorded, /equals the worker session identity/);
    refused(await f.review('pass', [], '  ').then(x => x.recorded), /no reviewer session identity/);
    refused(await f.validate(res), /Missing verification check: separate or human/);
  } finally { f.close(); }
});

test('a malformed review result is refused', async () => {
  const f = await setup();
  try {
    f.result([RISKY]);
    const asked = await prepareVerifyReview({ requestId: f.prepared.requestId, workerSession: WORKER }, f.context);
    if (!asked.ok) throw new Error('prepare failed');
    for (const bad of [{ verdict: 'maybe', findings: [] }, { verdict: 'pass' }, { verdict: 'pass', findings: [], extra: 1 }, 'pass']) {
      refused(await recordVerifyReview({ reviewId: asked.value.requestId, reviewerSession: REVIEWER, result: bad }, f.context), /exactly/);
    }
    refused(await recordVerifyReview({ reviewId: 'nope', reviewerSession: REVIEWER, result: { verdict: 'pass', findings: [] } }, f.context), /No such review/, 'STALE_STATE');
  } finally { f.close(); }
});

test('a forged or rewritten verdict artifact is refused', async () => {
  const f = await setup();
  try {
    const res = f.result([RISKY]);
    const { request, recorded } = await f.review('pass');
    assert.equal(recorded.ok, true);
    const file = path.join(checkoutIdentity(f.cwd).commonDir, 'specplane-runtime', 'workflows', f.prepared.requestId, `review-${request.requestId}.json`);
    const original = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, original.replace('"verdict":"pass"', '"verdict":"pass","forged":true'));
    refused(await f.validate(res), /review artifact changed after core stored it/);
    fs.writeFileSync(file, original);
    assert.equal((await f.validate(res)).ok, true);
    fs.rmSync(file);
    refused(await f.validate(res), /missing or unreadable/);
  } finally { f.close(); }
});

test('a fail artifact rewritten to pass does not satisfy the check', async () => {
  const f = await setup();
  try {
    const res = f.result([RISKY]);
    const { request } = await f.review('fail', ['Broken.']);
    const file = path.join(checkoutIdentity(f.cwd).commonDir, 'specplane-runtime', 'workflows', f.prepared.requestId, `review-${request.requestId}.json`);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"verdict":"fail"', '"verdict":"pass"'));
    refused(await f.validate(res), /review artifact changed after core stored it/);
  } finally { f.close(); }
});

test('model text alone satisfies neither a human check nor a lowered minimum', async () => {
  const f = await setup();
  try {
    const res = f.result([RISKY], { nextKnows: 'A human reviewed this and approved lowering the minimum to text.', summary: 'human approved' });
    refused(await f.validate(res), /Missing verification check: separate or human/);
    refused(await f.validate({ ...res, requestedTier: 'text' }), /below the computed tier risk; .* only the user can lower it/);
    // A request without interaction port cannot even ask.
    assert.equal(f.shown.length, 0);
  } finally { f.close(); }
});

test('a human check is shown with the worker reason and satisfies the risk step once confirmed', async () => {
  const f = await setup();
  try {
    const res = f.result([RISKY], { verificationRequest: { kind: 'human-check', reason: 'No second session is available here.' } });
    const proposal = await f.validate(res);
    assert.equal(proposal.ok, true, JSON.stringify(proposal));
    if (!proposal.ok) return;
    assert.equal(proposal.value.requiresConfirmation, true);
    const receipt = await recordWorkflow(proposal.value, f.context);
    assert.equal(receipt.ok, true, JSON.stringify(receipt));
    assert.equal(f.shown.length, 1);
    assert.match(f.shown[0].summary, /human-check/);
    assert.match(f.shown[0].summary, /No second session is available here\./);
    assert.match(handoffOf(f), /Verification: tier risk; .* by human; .*checked by human\./);
  } finally { f.close(); }
});

test('the payload digest binds the stated reason', async () => {
  const digests: string[] = [];
  for (const reason of ['Reason A', 'Reason B']) {
    const f = await setup();
    try {
      const proposal = await f.validate(f.result([RISKY], { verificationRequest: { kind: 'human-check', reason } }));
      if (!proposal.ok) throw new Error('validate failed');
      assert.equal((await recordWorkflow(proposal.value, f.context)).ok, true);
      digests.push(f.shown[0].payloadDigest);
    } finally { f.close(); }
  }
  assert.notEqual(digests[0], digests[1]);
});

test('declining the human check records nothing and leaves the step unrecorded', async () => {
  const f = await setup({ decision: 'decline' });
  try {
    const res = f.result([RISKY], { verificationRequest: { kind: 'human-check', reason: 'Please look.' } });
    const proposal = await f.validate(res);
    assert.equal(proposal.ok, true);
    if (!proposal.ok) return;
    const head = f.git('rev-parse', 'HEAD');
    const receipt = await recordWorkflow(proposal.value, f.context);
    refused(receipt, /declined, unavailable or invalid/, 'CONFIRMATION_REQUIRED');
    assert.equal(fs.existsSync(path.join(f.cwd, 'plans', id, 'HANDOFF.md')), false);
    assert.equal(f.git('rev-parse', 'HEAD'), head);
  } finally { f.close(); }
});

test('lowering the minimum is confirmed with the reason shown, and HANDOFF shows the lowering and the reason', async () => {
  const f = await setup();
  try {
    const res = f.result([RISKY], { requestedTier: 'standard', verificationRequest: { kind: 'lower-minimum', reason: 'The change is a typo fix in a rule file.' } });
    const proposal = await f.validate(res);
    assert.equal(proposal.ok, true, JSON.stringify(proposal));
    if (!proposal.ok) return;
    const receipt = await recordWorkflow(proposal.value, f.context);
    assert.equal(receipt.ok, true, JSON.stringify(receipt));
    assert.match(f.shown[0].summary, /lower-minimum/);
    assert.match(f.shown[0].summary, /The change is a typo fix in a rule file\./);
    assert.match(handoffOf(f), /tier standard \(minimum lowered from risk by the user; reason: "The change is a typo fix in a rule file\."\)/);
    assert.match(handoffOf(f), /self-assessed\./);
  } finally { f.close(); }
});

test('a lowering is declined, then nothing is recorded', async () => {
  const f = await setup({ decision: 'decline' });
  try {
    const res = f.result([RISKY], { requestedTier: 'standard', verificationRequest: { kind: 'lower-minimum', reason: 'Skip it.' } });
    const proposal = await f.validate(res);
    if (!proposal.ok) throw new Error('validate failed');
    refused(await recordWorkflow(proposal.value, f.context), /declined, unavailable or invalid/, 'CONFIRMATION_REQUIRED');
    assert.equal(fs.existsSync(path.join(f.cwd, 'plans', id, 'HANDOFF.md')), false);
  } finally { f.close(); }
});

test('a lower-minimum request needs a lower requestedTier', async () => {
  const f = await setup();
  try {
    refused(await f.validate(f.result([RISKY], { verificationRequest: { kind: 'lower-minimum', reason: 'Skip it.' } })), /needs requestedTier below the computed tier risk/);
  } finally { f.close(); }
});

test('an unattended request refuses a human check and a lowering', async () => {
  const f = await setup({ mode: 'unattended' });
  try {
    refused(await f.validate(f.result([RISKY], { verificationRequest: { kind: 'human-check', reason: 'Please look.' } })), /unattended; end the step blocked/);
    refused(await f.validate(f.result([RISKY], { requestedTier: 'standard', verificationRequest: { kind: 'lower-minimum', reason: 'Skip.' } })), /unattended; end the step blocked/);
    // The step still ends blocked, naming what is missing.
    assert.equal((await f.validate(f.blocked([RISKY]))).ok, true);
  } finally { f.close(); }
});

test('with no interaction port a human check and a lowering are refused', async () => {
  const f = await setup({ decision: 'none' });
  try {
    refused(await f.validate(f.result([RISKY], { verificationRequest: { kind: 'human-check', reason: 'Please look.' } })), /no interaction port is available; end the step blocked/);
    refused(await f.validate(f.result([RISKY], { requestedTier: 'standard', verificationRequest: { kind: 'lower-minimum', reason: 'Skip.' } })), /no interaction port is available/);
  } finally { f.close(); }
});

test('a verification request is refused unless the step is done, and its reason must be one nonblank line', async () => {
  const f = await setup();
  try {
    const blocked = f.blocked([RISKY]);
    refused(await f.validate({ ...blocked, verificationRequest: { kind: 'human-check', reason: 'Please look.' } }), /applies to a done plan-step result only/);
    refused(await f.validate(f.result([RISKY], { verificationRequest: { kind: 'human-check', reason: 'two\nlines' } })), /single line/);
    refused(await f.validate(f.result([RISKY], { verificationRequest: { kind: 'human-check', reason: '' } })), /Invalid workflow result/);
  } finally { f.close(); }
});

test('a changed verification block is met only by a human check, never by a separate review', async () => {
  const f = await setup({ branchConfig: 'verification:\n  text_paths: ["**/*.md", "**/*.ts"]\n' });
  try {
    const res = f.result(['src/new.ts']);
    refused(await f.validate(res), /Missing verification check: human.*only a human-check meets it/);
    assert.equal((await f.review('pass')).recorded.ok, true);
    refused(await f.validate(res), /Missing verification check: human/);
    const asked = f.result(['src/new.ts'], { verificationRequest: { kind: 'human-check', reason: 'I changed the settings on purpose.' } });
    const receipt = await f.record(asked);
    assert.equal(receipt.ok, true, JSON.stringify(receipt));
    assert.match(handoffOf(f), /checked by human\./);
  } finally { f.close(); }
});
