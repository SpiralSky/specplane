import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { parseFrontmatter } from '../frontmatter.js';
import { readTrailerEntries } from '../git/commit.js';
import { prepareWorkflow, validateWorkflowResult, recordWorkflow, captureContribution, readContributions, executeWorkflowTest, inspectWorkflow } from './index.js';
import { fixture, repo, id, stepFile } from './workflow-test-fixture.js';
import { releaseStoppedPreparation, sha256 } from './workflow-preparation.js';
import type { ContributionEvent, CoreContext, WorkflowResult, ConfirmationChallenge } from './contracts.js';

const spec = 'base:feature/test', file = 'specs/features/test.md';
async function setup(workflow: 'validate' | 'spec-assist' = 'spec-assist', role: 'assist' | 'draft' | 'review' = 'draft', interaction?: CoreContext['interaction'], execution?: CoreContext['execution'], beforePrepare?: (r: ReturnType<typeof repo>) => void) {
  const r = repo();
  r.put('.specplane/config.yaml', fs.readFileSync(path.join(r.cwd, '.specplane/config.yaml'), 'utf8') + `specs:\n  feature:\n    llm_role: ${role}\n`);
  beforePrepare?.(r);
  r.git('commit', '-am', 'set policy'); r.git('switch', '-c', 'work/non-plan');
  const p = await fixture(workflow), observations = new Map<string, ContributionEvent>(); let observationsRead = 0;
  const context: CoreContext = {
    checkout: r.cwd, extensionId: p.host.extensionId, compatibility: { manifest: p.manifest, host: p.host }, interaction, execution,
    contributions: { observe: async ({ eventId }) => { observationsRead++; return observations.get(eventId) ?? null; } },
  };
  const prepared = await prepareWorkflow({ protocol: 1, workflow, checkout: r.cwd, extensionId: context.extensionId, mode: 'attended', selection: { specIds: [spec], input: 'Review the requested content' } }, context);
  assert.ok(prepared.ok, JSON.stringify(prepared)); if (!prepared.ok) throw new Error('prepare');
  const original = fs.readFileSync(path.join(r.cwd, file), 'utf8');
  const plan = fs.readFileSync(path.join(r.cwd, `plans/${id}/PLAN.md`), 'utf8');
  const step = fs.readFileSync(path.join(r.cwd, stepFile), 'utf8');
  const result: WorkflowResult = {
    protocol: 1, requestId: prepared.value.requestId, baseDigest: prepared.value.base.digest, outcome: 'blocked', summary: 'record reviewed content', changes: [],
    criterionEvidence: prepared.value.criteria.map(c => ({ criterionId: c.id, assessment: 'uncertain', rationale: 'Semantic acceptance remains unverified without a reviewed mapping', artifacts: [] })),
    gaps: [], contextExpansion: [], contributionEvents: [], openIssues: 'BLOCKED: acceptance review remains uncertain', nextKnows: 'Inspect this limitation before declaring completion.',
  };
  return { ...r, context, prepared: prepared.value, result, original, observations, observationsRead: () => observationsRead,
    close: () => releaseStoppedPreparation(prepared.value.requestId),
    assertLifecycleUnchanged() {
      assert.equal(parseFrontmatter(fs.readFileSync(path.join(r.cwd, file), 'utf8')).data.status, 'approved');
      assert.equal(fs.readFileSync(path.join(r.cwd, `plans/${id}/PLAN.md`), 'utf8'), plan);
      assert.equal(fs.readFileSync(path.join(r.cwd, stepFile), 'utf8'), step);
      assert.equal(fs.existsSync(path.join(r.cwd, `plans/${id}/HANDOFF.md`)), false);
    },
  };
}

test('read-only non-plan validation records an uncertain private receipt without changing HEAD', async () => {
  const f = await setup('validate');
  try {
    // Read-only findings have no publication destination to authorize.
    f.git('config', 'branch.work/non-plan.remote', '.');
    f.git('config', 'branch.work/non-plan.merge', 'refs/heads/main');
    const proposal = await validateWorkflowResult(f.prepared, f.result, f.context);
    assert.ok(proposal.ok, JSON.stringify(proposal)); if (!proposal.ok) return;
    assert.equal(proposal.value.operation, 'workflow.record'); assert.deepEqual(proposal.value.paths, []);
    const recorded = await recordWorkflow(proposal.value, f.context);
    assert.ok(recorded.ok, JSON.stringify(recorded)); if (!recorded.ok || !('requestId' in recorded.value)) return;
    assert.equal(recorded.value.commit, null); assert.equal(recorded.value.outcome, 'blocked');
    assert.equal(recorded.value.workflow, 'validate'); assert.deepEqual(recorded.value.paths, []);
    assert.match(recorded.value.summary, /uncertain/);
    assert.ok(recorded.value.limitations.some(value => value.includes('Read-only')));
    assert.equal(f.git('rev-parse', 'HEAD'), f.prepared.base.head); assert.equal(f.git('status', '--porcelain'), '');
    const revalidated = await validateWorkflowResult(f.prepared, f.result, f.context);
    assert.ok(revalidated.ok, JSON.stringify(revalidated)); if (revalidated.ok) assert.deepEqual(revalidated.value, proposal.value);
    const incompatible = await validateWorkflowResult(f.prepared, { ...f.result, summary: 'different result' }, f.context);
    assert.equal(incompatible.ok, false);
    const retry = await recordWorkflow(proposal.value, f.context);
    assert.ok(retry.ok, JSON.stringify(retry)); if (retry.ok) assert.deepEqual(retry.value, recorded.value);
    const inspection = inspectWorkflow(f.prepared.requestId, f.context);
    assert.ok(inspection.ok, JSON.stringify(inspection)); if (inspection.ok) assert.deepEqual(inspection.value.recording, recorded.value);
    f.assertLifecycleUnchanged();
  } finally { f.close(); }
});

test('a new preparation cannot reuse a committed contribution event ID for another edit', async () => {
  const f = await setup(); let secondRequest: string | undefined;
  try {
    const after = f.original + '\nFirst actual contribution.\n'; f.put(file, after);
    const event: ContributionEvent = {
      eventId: randomUUID(), requestId: f.prepared.requestId, spec, role: 'revise', source: 'runtime', actor: { kind: 'model', provider: 'observed', model_id: 'A' },
      action: { kind: 'edit', evidencePath: file, evidenceDigest: sha256(after) }, revision: { beforeDigest: sha256(f.original), afterDigest: sha256(after) },
    };
    f.observations.set(event.eventId, structuredClone(event));
    const firstCapture = await captureContribution(event, f.context); assert.ok(firstCapture.ok, JSON.stringify(firstCapture));
    f.result.changes = [{ path: file, beforeDigest: sha256(f.original), afterDigest: sha256(after), purpose: 'first body edit' }]; f.result.contributionEvents = [event];
    const proposal = await validateWorkflowResult(f.prepared, f.result, f.context);
    assert.ok(proposal.ok, JSON.stringify(proposal)); if (!proposal.ok) return;
    const firstRecord = await recordWorkflow(proposal.value, f.context); assert.ok(firstRecord.ok, JSON.stringify(firstRecord)); if (!firstRecord.ok) return;
    f.close();
    const prepared = await prepareWorkflow({ protocol: 1, workflow: 'spec-assist', checkout: f.cwd, extensionId: f.context.extensionId, mode: 'attended', selection: { specIds: [spec], input: 'A later edit' } }, f.context);
    assert.ok(prepared.ok, JSON.stringify(prepared)); if (!prepared.ok) return; secondRequest = prepared.value.requestId;
    const before = fs.readFileSync(path.join(f.cwd, file), 'utf8'), later = before + '\nA later actual contribution.\n'; f.put(file, later);
    const reused: ContributionEvent = { ...event, requestId: secondRequest, action: { ...event.action, evidenceDigest: sha256(later) }, revision: { beforeDigest: sha256(before), afterDigest: sha256(later) } };
    f.observations.set(reused.eventId, structuredClone(reused));
    const captured = await captureContribution(reused, f.context); assert.ok(captured.ok, JSON.stringify(captured));
    const result: WorkflowResult = { ...f.result, requestId: secondRequest, baseDigest: prepared.value.base.digest, changes: [{ path: file, beforeDigest: sha256(before), afterDigest: sha256(later), purpose: 'later edit' }], contributionEvents: [reused], criterionEvidence: prepared.value.criteria.map(c => ({ criterionId: c.id, assessment: 'uncertain', rationale: 'Still unverified', artifacts: [] })) };
    const refused = await validateWorkflowResult(prepared.value, result, f.context);
    assert.equal(refused.ok, false); if (!refused.ok) assert.equal(refused.error.code, 'RECOVERY_REQUIRED');
    assert.equal(f.git('rev-parse', 'HEAD'), firstRecord.value.commit);
    assert.equal(fs.readFileSync(path.join(f.cwd, file), 'utf8'), later);
  } finally { if (secondRequest) releaseStoppedPreparation(secondRequest); f.close(); }
});

test('draft-authorized body edit and trusted action commit attribution atomically on a non-plan branch', async () => {
  const f = await setup();
  try {
    const after = f.original + '\nA reviewed draft body addition.\n'; f.put(file, after);
    const event: ContributionEvent = {
      eventId: randomUUID(), requestId: f.prepared.requestId, spec, role: 'revise', source: 'runtime', actor: { kind: 'model', provider: 'observed', model_id: 'model-A' },
      action: { kind: 'edit', evidencePath: file, evidenceDigest: sha256(after) }, revision: { beforeDigest: sha256(f.original), afterDigest: sha256(after) },
    };
    f.observations.set(event.eventId, structuredClone(event));
    const captured = await captureContribution(event, f.context); assert.ok(captured.ok, JSON.stringify(captured));
    f.result.changes = [{ path: file, beforeDigest: sha256(f.original), afterDigest: sha256(after), purpose: 'reviewed draft body' }];
    f.result.contributionEvents = [event];
    const proposal = await validateWorkflowResult(f.prepared, f.result, f.context);
    assert.ok(proposal.ok, JSON.stringify(proposal)); if (!proposal.ok) return;
    assert.equal(proposal.value.requiresConfirmation, false);
    const recorded = await recordWorkflow(proposal.value, f.context);
    assert.ok(recorded.ok, JSON.stringify(recorded)); if (!recorded.ok || !('requestId' in recorded.value)) return;
    assert.equal(recorded.value.commit, f.git('rev-parse', 'HEAD'));
    assert.equal(f.git('rev-parse', 'HEAD^'), f.prepared.base.head); assert.equal(f.git('status', '--porcelain'), '');
    const committed = fs.readFileSync(path.join(f.cwd, file), 'utf8'), parsed = parseFrontmatter(committed);
    assert.equal(parsed.body, parseFrontmatter(after).body); assert.equal(parsed.data.author, 'mixed');
    const summaries = parsed.data.contributors as { id: string; provider?: string; model_id?: string; roles: string[] }[];
    assert.equal(summaries.length, 1); assert.equal(summaries[0].model_id, 'model-A'); assert.deepEqual(summaries[0].roles, ['revise']);
    const trailers = readTrailerEntries(recorded.value.commit!, f.cwd), contributions = trailers.filter(([key]) => key === 'Specplane-Contribution').map(([, value]) => JSON.parse(value));
    assert.equal(contributions.length, 1); assert.equal(contributions[0].event_id, event.eventId); assert.equal(contributions[0].contributor, summaries[0].id);
    assert.deepEqual(contributions[0].revision, event.revision);
    assert.deepEqual(trailers.filter(([key]) => key === 'Specplane-Request'), [['Specplane-Request', f.prepared.requestId]]);
    const inspection = await readContributions({ requestId: f.prepared.requestId }, f.context);
    assert.ok(inspection.ok, JSON.stringify(inspection)); if (inspection.ok) assert.equal(inspection.value.status, 'recorded');
    const retry = await recordWorkflow(proposal.value, f.context);
    assert.ok(retry.ok, JSON.stringify(retry)); if (retry.ok) assert.equal(retry.value.commit, recorded.value.commit);
    assert.equal(f.observationsRead(), 1); f.assertLifecycleUnchanged();
  } finally { f.close(); }
});

test('sequential model actions retain both revisions and contributors in the final recording', async () => {
  const f = await setup();
  try {
    fs.appendFileSync(path.join(f.cwd, '.git/info/exclude'), '\nprivate-actions/\n');
    let before = f.original;
    const events: ContributionEvent[] = [];
    for (const model of ['A', 'B']) {
      const after = before + `\nContribution from model ${model}.\n`, evidencePath = `private-actions/${model}.md`, evidence = `Performed edit by ${model}`;
      f.put(file, after); f.put(evidencePath, evidence);
      const event: ContributionEvent = {
        eventId: randomUUID(), requestId: f.prepared.requestId, spec, role: 'revise', source: 'runtime', actor: { kind: 'model', provider: 'observed', model_id: model },
        action: { kind: 'edit', evidencePath, evidenceDigest: sha256(evidence) }, revision: { beforeDigest: sha256(before), afterDigest: sha256(after) },
      };
      f.observations.set(event.eventId, structuredClone(event));
      const captured = await captureContribution(event, f.context); assert.ok(captured.ok, JSON.stringify(captured));
      events.push(event); before = after;
    }
    const stale = await captureContribution(events[0], f.context);
    assert.equal(stale.ok, false); if (!stale.ok) assert.ok(['STALE_STATE', 'INVALID_EVIDENCE'].includes(stale.error.code), JSON.stringify(stale));
    assert.equal(f.observationsRead(), 2);
    f.result.changes = [{ path: file, beforeDigest: sha256(f.original), afterDigest: sha256(before), purpose: 'sequential reviewed edits' }];
    f.result.contributionEvents = [...events].reverse();
    const proposal = await validateWorkflowResult(f.prepared, f.result, f.context);
    assert.ok(proposal.ok, JSON.stringify(proposal)); if (!proposal.ok) return;
    const recorded = await recordWorkflow(proposal.value, f.context);
    assert.ok(recorded.ok, JSON.stringify(recorded)); if (!recorded.ok) return;
    const parsed = parseFrontmatter(fs.readFileSync(path.join(f.cwd, file), 'utf8'));
    assert.equal(parsed.body, parseFrontmatter(before).body);
    const summaries = parsed.data.contributors as { model_id?: string; roles: string[] }[];
    assert.deepEqual(summaries.map(summary => summary.model_id).sort(), ['A', 'B']);
    const trailers = readTrailerEntries(recorded.value.commit!, f.cwd).filter(([key]) => key === 'Specplane-Contribution').map(([, value]) => JSON.parse(value));
    assert.deepEqual(trailers.map(event => event.event_id), events.map(event => event.eventId).sort());
    for (const event of events) assert.deepEqual(trailers.find(trailer => trailer.event_id === event.eventId)?.revision, event.revision);
    assert.equal(f.git('status', '--porcelain'), ''); f.assertLifecycleUnchanged();
  } finally { f.close(); }
});

test('finalized assist content requires one exact direct-human review and matching retry reuses its commit', async () => {
  const shown: ConfirmationChallenge[] = [];
  const f = await setup('spec-assist', 'assist', { confirm: async challenge => { shown.push(structuredClone(challenge)); return { challengeId: challenge.challengeId, decision: 'confirm', interactionId: 'direct-human-1' }; } });
  try {
    const body = '# Test\n\nFinalized feature content approved for writing.\n';
    f.result.finalizedEdits = [{ spec, body }];
    const proposal = await validateWorkflowResult(f.prepared, f.result, f.context);
    assert.ok(proposal.ok, JSON.stringify(proposal)); if (!proposal.ok) return;
    assert.equal(proposal.value.requiresConfirmation, true); assert.equal(shown.length, 0);
    assert.equal(fs.readFileSync(path.join(f.cwd, file), 'utf8'), f.original);
    const recorded = await recordWorkflow(proposal.value, f.context);
    assert.ok(recorded.ok, JSON.stringify(recorded)); if (!recorded.ok) return;
    assert.equal(shown.length, 1); assert.equal(shown[0].operation, 'workflow.record'); assert.deepEqual(shown[0].targets, [file]);
    assert.ok('requestId' in recorded.value && recorded.value.validation?.valid);
    assert.ok(recorded.value.limitations?.some(value => value.includes('absent body observations remain unrecorded')));
    assert.ok(shown[0].summary.includes(`Before:\n${f.original}`)); assert.ok(shown[0].summary.includes(body));
    assert.match(shown[0].summary, /does not approve a spec or change its lifecycle status/);
    const current = parseFrontmatter(fs.readFileSync(path.join(f.cwd, file), 'utf8'));
    assert.equal(current.body, body); assert.deepEqual(current.data, { ...parseFrontmatter(f.original).data, author: 'mixed' });
    assert.equal(recorded.value.commit, f.git('rev-parse', 'HEAD'));
    const retry = await recordWorkflow(proposal.value, f.context);
    assert.ok(retry.ok, JSON.stringify(retry)); if (retry.ok) assert.equal(retry.value.commit, recorded.value.commit);
    assert.equal(shown.length, 1); assert.equal(f.git('status', '--porcelain'), ''); f.assertLifecycleUnchanged();
  } finally { f.close(); }
});

test('final spec validation failure returns findings and restores the original finalized-content preimage', async () => {
  const f = await setup('spec-assist', 'assist', { confirm: async challenge => ({ challengeId: challenge.challengeId, decision: 'confirm', interactionId: 'invalid-existing-spec-review' }) }, undefined,
    r => r.put(file, fs.readFileSync(path.join(r.cwd, file), 'utf8').replace('id: feature/test', 'id: feature/wrong')));
  try {
    f.result.finalizedEdits = [{ spec, body: '# Finalized body\n' }];
    const proposal = await validateWorkflowResult(f.prepared, f.result, f.context);
    assert.ok(proposal.ok, JSON.stringify(proposal)); if (!proposal.ok) return;
    const recorded = await recordWorkflow(proposal.value, f.context);
    assert.equal(recorded.ok, false);
    if (!recorded.ok) {
      assert.equal(recorded.error.code, 'INVALID_EVIDENCE');
      const details = recorded.error.details as { validation?: { valid: boolean; errors: { type: string; file: string }[] } };
      assert.equal(details.validation?.valid, false);
      assert.ok(details.validation?.errors.some(finding => finding.type === 'id' && finding.file === file));
    }
    assert.equal(f.git('rev-parse', 'HEAD'), f.prepared.base.head);
    assert.equal(fs.readFileSync(path.join(f.cwd, file), 'utf8'), f.original); assert.equal(f.git('status', '--porcelain'), '');
    const intentFile = path.join(f.cwd, '.git/specplane-runtime/workflows', f.prepared.requestId, 'recording-intent.json');
    assert.equal(fs.existsSync(intentFile), true);
    // Prewrite intent survives rollback; it does not attest to the failed later validation.
    assert.equal(JSON.parse(fs.readFileSync(intentFile, 'utf8')).commit.receipt.validation, undefined);
  } finally { f.close(); }
});

test('an observation of original spec bytes cannot attest to different finalized content', async () => {
  let confirmations = 0;
  const f = await setup('spec-assist', 'assist', { confirm: async challenge => { confirmations++; return { challengeId: challenge.challengeId, decision: 'confirm', interactionId: 'unused-confirmation' }; } });
  try {
    fs.appendFileSync(path.join(f.cwd, '.git/info/exclude'), '\nprivate-actions/\n');
    const evidencePath = 'private-actions/review.md', evidence = 'Performed review of the original spec'; f.put(evidencePath, evidence);
    const event: ContributionEvent = {
      eventId: randomUUID(), requestId: f.prepared.requestId, spec, role: 'review', source: 'runtime', actor: { kind: 'model', provider: 'observed', model_id: 'reviewer' },
      action: { kind: 'review', evidencePath, evidenceDigest: sha256(evidence) }, revision: { reviewedDigest: sha256(f.original) },
    };
    f.observations.set(event.eventId, structuredClone(event));
    const captured = await captureContribution(event, f.context); assert.ok(captured.ok, JSON.stringify(captured));
    f.result.finalizedEdits = [{ spec, body: '# Different finalized body\n' }]; f.result.contributionEvents = [event];
    const proposal = await validateWorkflowResult(f.prepared, f.result, f.context);
    assert.equal(proposal.ok, false); if (!proposal.ok) assert.equal(proposal.error.code, 'INVALID_EVIDENCE');
    assert.equal(confirmations, 0); assert.equal(f.git('rev-parse', 'HEAD'), f.prepared.base.head);
    assert.equal(fs.readFileSync(path.join(f.cwd, file), 'utf8'), f.original); f.assertLifecycleUnchanged();
  } finally { f.close(); }
});

test('review role applies only the exact finalized text approved through its bound human interaction', async () => {
  let shown: ConfirmationChallenge | undefined;
  const f = await setup('spec-assist', 'review', { confirm: async challenge => { shown = structuredClone(challenge); return { challengeId: challenge.challengeId, decision: 'confirm', interactionId: 'exact-review-edit' }; } });
  try {
    const body = '# Test\n\nA precise user-approved correction.\n'; f.result.finalizedEdits = [{ spec, body }];
    assert.deepEqual(f.prepared.scope.allowedEditPaths, []);
    const proposal = await validateWorkflowResult(f.prepared, f.result, f.context);
    assert.ok(proposal.ok, JSON.stringify(proposal)); if (!proposal.ok) return;
    assert.equal(proposal.value.requiresConfirmation, true);
    assert.equal(fs.readFileSync(path.join(f.cwd, file), 'utf8'), f.original);
    const recorded = await recordWorkflow(proposal.value, f.context);
    assert.ok(recorded.ok, JSON.stringify(recorded)); if (!recorded.ok) return;
    assert.ok(shown?.summary.includes(body));
    assert.equal(parseFrontmatter(fs.readFileSync(path.join(f.cwd, file), 'utf8')).body, body);
    assert.equal(f.git('rev-parse', 'HEAD'), recorded.value.commit); f.assertLifecycleUnchanged();
  } finally { f.close(); }
});

test('adding an interaction after preparation cannot authorize finalized assist writes', async () => {
  const f = await setup('spec-assist', 'assist'); let called = 0;
  try {
    f.result.finalizedEdits = [{ spec, body: '# Finalized\n' }];
    const proposal = await validateWorkflowResult(f.prepared, f.result, f.context);
    assert.ok(proposal.ok, JSON.stringify(proposal)); if (!proposal.ok) return;
    const context: CoreContext = { ...f.context, interaction: { confirm: async challenge => { called++; return { challengeId: challenge.challengeId, decision: 'confirm', interactionId: 'late-port' }; } } };
    const recorded = await recordWorkflow(proposal.value, context);
    assert.equal(recorded.ok, false); if (!recorded.ok) assert.equal(recorded.error.code, 'CONFIRMATION_REQUIRED');
    assert.equal(called, 0); assert.equal(f.git('rev-parse', 'HEAD'), f.prepared.base.head);
    assert.equal(fs.readFileSync(path.join(f.cwd, file), 'utf8'), f.original); f.assertLifecycleUnchanged();
  } finally { f.close(); }
});

test('declined preparation-bound interaction cannot be replaced to authorize finalized content', async () => {
  for (const replaceMethod of [false, true]) {
    let originalCalls = 0, replacementCalls = 0;
    const port: NonNullable<CoreContext['interaction']> = { confirm: async challenge => { originalCalls++; return { challengeId: challenge.challengeId, decision: 'decline', interactionId: 'declined' }; } };
    const f = await setup('spec-assist', 'assist', port);
    try {
      f.result.finalizedEdits = [{ spec, body: '# Finalized\n' }];
      const proposal = await validateWorkflowResult(f.prepared, f.result, f.context);
      assert.ok(proposal.ok, JSON.stringify(proposal)); if (!proposal.ok) continue;
      const replacement: NonNullable<CoreContext['interaction']> = { confirm: async challenge => { replacementCalls++; return { challengeId: challenge.challengeId, decision: 'confirm', interactionId: 'replacement' }; } };
      if (replaceMethod) port.confirm = replacement.confirm; else f.context.interaction = replacement;
      const recorded = await recordWorkflow(proposal.value, f.context);
      assert.equal(recorded.ok, false); if (!recorded.ok) assert.equal(recorded.error.code, 'CONFIRMATION_REQUIRED');
      assert.equal(originalCalls, 1); assert.equal(replacementCalls, 0);
      assert.equal(f.git('rev-parse', 'HEAD'), f.prepared.base.head); assert.equal(fs.readFileSync(path.join(f.cwd, file), 'utf8'), f.original);
      f.assertLifecycleUnchanged();
    } finally { f.close(); }
  }
});

test('state changes during finalized-content confirmation preserve original spec and refuse mutation', async () => {
  let mutate = () => {};
  const f = await setup('spec-assist', 'assist', { confirm: async challenge => { mutate(); return { challengeId: challenge.challengeId, decision: 'confirm', interactionId: 'stale-human-response' }; } });
  try {
    f.result.finalizedEdits = [{ spec, body: '# Finalized\n' }];
    mutate = () => f.put('source.ts', 'intervening source edit');
    const proposal = await validateWorkflowResult(f.prepared, f.result, f.context);
    assert.ok(proposal.ok, JSON.stringify(proposal)); if (!proposal.ok) return;
    const recorded = await recordWorkflow(proposal.value, f.context);
    assert.equal(recorded.ok, false); if (!recorded.ok) assert.equal(recorded.error.code, 'STALE_STATE');
    assert.equal(f.git('rev-parse', 'HEAD'), f.prepared.base.head);
    assert.equal(fs.readFileSync(path.join(f.cwd, file), 'utf8'), f.original);
    assert.equal(fs.readFileSync(path.join(f.cwd, 'source.ts'), 'utf8'), 'intervening source edit'); f.assertLifecycleUnchanged();
  } finally { f.close(); }
});

for (const output of ['receipt', 'stdout'] as const) {
  test(`private ${output} tampering during finalized-content confirmation refuses before writing`, async () => {
    let mutate = () => {}, confirmations = 0;
    const execution: NonNullable<CoreContext['execution']> = { execute: async request => ({
      executable: process.execPath, exitCode: 0, signal: null,
      stdout: execFileSync(process.execPath, request.args, { cwd: request.checkout, env: request.env }), stderr: Buffer.alloc(0),
    }) };
    const f = await setup('spec-assist', 'assist', { confirm: async challenge => { confirmations++; mutate(); return { challengeId: challenge.challengeId, decision: 'confirm', interactionId: 'private-evidence-review' }; } }, execution);
    try {
      f.result.finalizedEdits = [{ spec, body: '# Finalized after inspection\n' }];
      const executed = await executeWorkflowTest({ requestId: f.prepared.requestId, criterionIds: [f.prepared.criteria[0].id], executable: 'node', args: ['--test-reporter=tap', '-e', "require('node:test').test('inspection',()=>{});"], reportFormat: 'node-tap-v13' }, f.context);
      assert.ok(executed.ok, JSON.stringify(executed)); if (!executed.ok) return;
      f.result.criterionEvidence[0].artifacts = [executed.value.artifact];
      const target = path.join(f.cwd, '.git/specplane-runtime/workflows', f.prepared.requestId, 'evidence', output === 'receipt' ? executed.value.artifact.path : `${executed.value.executionId}.stdout`);
      mutate = () => fs.writeFileSync(target, 'tampered private evidence');
      const proposal = await validateWorkflowResult(f.prepared, f.result, f.context);
      assert.ok(proposal.ok, JSON.stringify(proposal)); if (!proposal.ok) return;
      const recorded = await recordWorkflow(proposal.value, f.context);
      assert.equal(recorded.ok, false); if (!recorded.ok) assert.equal(recorded.error.code, 'INVALID_EVIDENCE');
      assert.equal(confirmations, 1); assert.equal(fs.readFileSync(target, 'utf8'), 'tampered private evidence');
      assert.equal(fs.readFileSync(path.join(f.cwd, file), 'utf8'), f.original);
      assert.equal(f.git('rev-parse', 'HEAD'), f.prepared.base.head); assert.equal(f.git('status', '--porcelain'), '');
      f.assertLifecycleUnchanged();
    } finally { f.close(); }
  });
}

test('removed execution evidence is reported unavailable while the recorded commit remains retryable', async () => {
  let confirmations = 0;
  const execution: NonNullable<CoreContext['execution']> = { execute: async request => ({
    executable: process.execPath, exitCode: 0, signal: null,
    stdout: execFileSync(process.execPath, request.args, { cwd: request.checkout, env: request.env }), stderr: Buffer.alloc(0),
  }) };
  const f = await setup('spec-assist', 'assist', { confirm: async challenge => { confirmations++; return { challengeId: challenge.challengeId, decision: 'confirm', interactionId: 'historical-evidence-review' }; } }, execution);
  try {
    f.result.finalizedEdits = [{ spec, body: '# Finalized after execution\n' }];
    const executed = await executeWorkflowTest({ requestId: f.prepared.requestId, criterionIds: [f.prepared.criteria[0].id], executable: 'node', args: ['--test-reporter=tap', '-e', "require('node:test').test('inspection',()=>{});"], reportFormat: 'node-tap-v13' }, f.context);
    assert.ok(executed.ok, JSON.stringify(executed)); if (!executed.ok) return;
    f.result.criterionEvidence[0].artifacts = [executed.value.artifact];
    const proposal = await validateWorkflowResult(f.prepared, f.result, f.context);
    assert.ok(proposal.ok, JSON.stringify(proposal)); if (!proposal.ok) return;
    const recorded = await recordWorkflow(proposal.value, f.context);
    assert.ok(recorded.ok, JSON.stringify(recorded)); if (!recorded.ok) return;
    fs.unlinkSync(path.join(f.cwd, '.git/specplane-runtime/workflows', f.prepared.requestId, 'evidence', executed.value.artifact.path));
    const inspection = inspectWorkflow(f.prepared.requestId, f.context);
    assert.ok(inspection.ok, JSON.stringify(inspection));
    if (inspection.ok) {
      assert.equal(inspection.value.recording?.commit, recorded.value.commit);
      assert.ok(inspection.value.recording?.limitations?.some(value => value.includes(executed.value.artifact.path) && value.includes('unavailable or changed')));
    }
    const retry = await recordWorkflow(proposal.value, f.context);
    assert.ok(retry.ok, JSON.stringify(retry));
    if (retry.ok) {
      assert.equal(retry.value.commit, recorded.value.commit);
      assert.ok(retry.value.limitations?.some(value => value.includes('historical validation, not fresh execution verification')));
    }
    assert.equal(f.git('rev-parse', 'HEAD'), recorded.value.commit); assert.equal(confirmations, 1);
  } finally { f.close(); }
});

test('non-plan returned files cannot set metadata or bypass dedicated creation operations', async () => {
  for (const create of [false, true]) {
    const f = await setup();
    try {
      const target = create ? 'specs/features/new.md' : file, before = create ? 'missing' : sha256(f.original);
      const after = create ? '---\nid: feature/new\ntitle: New\nstatus: approved\nauthor: llm\n---\n# New\n' : f.original.replace('author: user', 'author: mixed') + '\nBody edit\n';
      f.put(target, after); f.result.changes = [{ path: target, beforeDigest: before, afterDigest: sha256(after), purpose: 'attempt metadata or creation' }];
      const proposal = await validateWorkflowResult(f.prepared, f.result, f.context);
      assert.equal(proposal.ok, false); if (!proposal.ok) assert.equal(proposal.error.code, 'POLICY_DENIED');
      assert.equal(f.git('rev-parse', 'HEAD'), f.prepared.base.head); assert.equal(fs.readFileSync(path.join(f.cwd, target), 'utf8'), after);
    } finally { f.close(); }
  }
});
