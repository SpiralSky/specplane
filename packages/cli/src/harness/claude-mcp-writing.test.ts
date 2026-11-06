// End to end through the Claude MCP server: each writing workflow prepares, validates a done result that cites the file it
// creates or finalises, parks the core's confirmation, and writes and commits only after the user confirms. Fixtures only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fixture, repo } from '../core/workflow-test-fixture.js';
import { createWorkflowRunner } from '../core/workflow-runner.js';
import { sha256 } from '../core/workflow-preparation.js';
import { createClaudeMcpServer, createConfirmationBridge, qualifySpecIds } from './claude-mcp.js';

const NONCE = 'nonce-0123456789abcdef';
const rpc = (n: number, name: string, args: Record<string, unknown>) => ({ jsonrpc: '2.0', id: n, method: 'tools/call', params: { name, arguments: { nonce: NONCE, ...args } } });
async function call(server: ReturnType<typeof createClaudeMcpServer>, n: number, name: string, args: Record<string, unknown>) {
  const out: Array<Record<string, any>> = [];
  async function* input() { yield JSON.stringify(rpc(n, name, args)) + '\n'; }
  await server.serve({ input: input(), write: l => out.push(JSON.parse(l)) });
  const r = out[0]!.result;
  return { isError: r.isError as boolean, text: r.content[0].text as string, json: (() => { try { return JSON.parse(r.content[0].text); } catch { return undefined; } })() };
}

interface Case { workflow: string; specIds: string[]; input: string; file: string; body: string; extra: (requestId: string) => Record<string, unknown>; statusOf?: (text: string) => string | undefined }
const statusLine = (text: string) => /^status: (\S+)$/m.exec(text)?.[1];

async function session(c: Case) {
  const r = repo();
  r.put('.specplane/config.yaml', fs.readFileSync(path.join(r.cwd, '.specplane/config.yaml'), 'utf8') + 'specs:\n  feature:\n    llm_role: assist\n  architecture:\n    llm_role: draft\n');
  r.git('commit', '-am', 'set policy'); r.git('switch', '-c', `work/${c.workflow}`);
  const p = await fixture(c.workflow);
  const confirmations = createConfirmationBridge();
  const runner = createWorkflowRunner({
    checkout: r.cwd, extensionId: p.host.extensionId, compatibilityFor: () => ({ manifest: p.manifest, host: p.host }),
    context: { interaction: confirmations.port },
  });
  const server = createClaudeMcpServer(runner, { confirmations });
  await call(server, 1, 'bind', {});
  const prepared = await call(server, 2, 'prepare', { protocol: 1, workflow: c.workflow, extensionId: p.host.extensionId, checkout: r.cwd, mode: 'attended', selection: { specIds: c.specIds, input: c.input } });
  assert.equal(prepared.isError, false, prepared.text);
  const requestId = prepared.json.value.requestId as string;
  let json = '';
  for (let offset = 0; ;) {
    const page = (await call(server, 3, 'detail', { requestId, offset })).json.value;
    json += page.chunk; if (page.done) break; offset = page.next;
  }
  const request = JSON.parse(json);
  const result = {
    protocol: 1, requestId, baseDigest: request.base.digest, outcome: 'done', summary: 'save the finalised text', changes: [],
    criterionEvidence: request.criteria.map((criterion: { id: string }) => ({ criterionId: criterion.id, assessment: 'met', rationale: 'The user confirms exactly this text', artifacts: [] })),
    gaps: [], contextExpansion: [], contributionEvents: [], openIssues: '', nextKnows: 'Nothing further.',
    ...c.extra(requestId),
  };
  const head = r.git('rev-parse', 'HEAD');
  return { r, server, runner, requestId, result, head, file: path.join(r.cwd, c.file) };
}

async function drive(c: Case, decision: 'confirm' | 'decline') {
  const f = await session(c);
  const validated = await call(f.server, 4, 'validate', { requestId: f.requestId, result: f.result });
  assert.equal(validated.isError, false, validated.text);
  const proposal = validated.json.value as Record<string, unknown>;
  assert.equal(proposal.requiresConfirmation, true);
  const existing = c.workflow === 'spec-assist' && c.specIds.length > 0;
  if (!existing) assert.equal(fs.existsSync(f.file), false, 'validation writes nothing');
  else assert.ok(!fs.readFileSync(f.file, 'utf8').includes('finalised'), 'validation writes nothing');
  const first = await call(f.server, 5, 'record', proposal);
  assert.equal(first.isError, true);
  assert.equal(first.json.error.code, 'CONFIRMATION_REQUIRED');
  const challenge = first.json.error.details.challenge as { challengeId: string; summary: string; targets: string[] };
  assert.ok(challenge.targets.includes(c.file), `targets ${challenge.targets}`);
  assert.ok(challenge.summary.includes(c.body.trim()), 'the dialog carries the exact content');
  assert.equal(f.r.git('rev-parse', 'HEAD'), f.head, 'nothing is committed while the challenge is parked');
  const answered = await call(f.server, 6, 'record', { ...proposal, confirmation: { challengeId: challenge.challengeId, decision, interactionId: 'mod-dialog-1' } });
  return { ...f, challenge, answered };
}

const cases: Record<string, Case> = {
  'spec-assist (new spec)': {
    workflow: 'spec-assist', specIds: [], input: 'Write the export feature', file: 'specs/features/export.md', body: '# Export\n\nUsers export their data.\n',
    extra: () => ({ creation: { operation: 'spec.new', arguments: { type: 'feature', slug: 'export', title: 'Export' }, body: '# Export\n\nUsers export their data.\n' } }),
    statusOf: statusLine,
  },
  'spec-assist (finalised edit)': {
    workflow: 'spec-assist', specIds: ['base:feature/test'], input: 'Revise the test spec', file: 'specs/features/test.md', body: '# Test\n\n## Acceptance criteria\n\n- [ ] Observable feature behavior, finalised\n',
    extra: () => ({ finalizedEdits: [{ spec: 'base:feature/test', body: '# Test\n\n## Acceptance criteria\n\n- [ ] Observable feature behavior, finalised\n' }] }),
    statusOf: statusLine,
  },
  'spec-draft-architecture': {
    workflow: 'spec-draft-architecture', specIds: ['base:feature/test'], input: 'base:feature/test', file: 'specs/architecture/test-design.md', body: '# Test design\n\nThe design.\n',
    extra: () => ({ creation: { operation: 'spec.new', arguments: { type: 'architecture', slug: 'test-design', title: 'Test design', implements: ['base:feature/test'] }, body: '# Test design\n\nThe design.\n' } }),
    statusOf: statusLine,
  },
  'plan-create': {
    workflow: 'plan-create', specIds: ['base:feature/test'], input: 'Plan the test feature', file: 'plans/2026-11-04-created/PLAN.md', body: '# Created plan\n\n## Goal\n\nImplement the feature.\n',
    extra: () => ({ creation: { operation: 'plan.new', arguments: { id: '2026-11-04-created', title: 'Created plan', specs: ['base:feature/test'] }, body: '# Created plan\n\n## Goal\n\nImplement the feature.\n', steps: [{ title: 'Implement', context: [{ spec: 'base:feature/test' }], body: '## Goal\n\nImplement.\n\n## Acceptance criteria\n\n- [ ] Works\n' }] } }),
    statusOf: statusLine,
  },
  'decision-new': {
    workflow: 'decision-new', specIds: [], input: 'Use SQLite for the index', file: 'docs/decisions/0001-use-sqlite.md', body: '# Use SQLite\n\n## Decision\n\nWe use SQLite for the index.\n',
    extra: () => ({ creation: { operation: 'decision.new', arguments: { title: 'Use SQLite' }, body: '# Use SQLite\n\n## Decision\n\nWe use SQLite for the index.\n' } }),
    statusOf: statusLine,
  },
};

for (const [name, c] of Object.entries(cases)) {
  test(`${name}: confirm writes and commits the file, reaches done, and approves nothing`, async () => {
    const f = await drive(c, 'confirm');
    assert.equal(f.answered.isError, false, f.answered.text);
    assert.equal(f.answered.json.value.outcome, 'done');
    assert.ok(f.answered.json.value.commit, 'a commit is recorded');
    assert.equal(f.r.git('status', '--porcelain'), '');
    assert.notEqual(f.r.git('rev-parse', 'HEAD'), f.head);
    assert.ok(f.r.git('show', '--name-only', '--format=', 'HEAD').split('\n').includes(c.file), 'the commit holds the file');
    const text = fs.readFileSync(f.file, 'utf8');
    assert.ok(text.includes(c.body.trim().split('\n').pop()!), 'the confirmed text is on disk');
    const status = c.statusOf!(text);
    if (name !== 'spec-assist (finalised edit)') assert.notEqual(status, 'approved', 'confirmation approves nothing');
    if (name === 'decision-new') assert.equal(status, 'proposed');
    else if (name === 'spec-assist (finalised edit)') assert.equal(status, 'approved', 'the existing spec keeps its status');
    else assert.equal(status, 'draft');
    const trailers = f.r.git('log', '-1', '--format=%(trailers:only,unfold)');
    assert.match(trailers, /Specplane-Workflow: (spec|plan-create|decision-new)/);
    assert.equal((await call(f.server, 8, 'close', { requestId: f.requestId })).isError, false);
    assert.deepEqual(f.runner.tracked(), []);
  });

  test(`${name}: decline writes nothing and commits nothing`, async () => {
    const f = await drive(c, 'decline');
    assert.equal(f.answered.isError, true);
    assert.equal(f.r.git('rev-parse', 'HEAD'), f.head);
    assert.equal(f.r.git('status', '--porcelain'), '');
    if (name === 'spec-assist (finalised edit)') assert.ok(!fs.readFileSync(f.file, 'utf8').includes('finalised'));
    else assert.equal(fs.existsSync(f.file), false);
    assert.deepEqual(f.runner.tracked(), []);
  });
}

test('a spec selected by its plain id can be finalised', async () => {
  const f = await drive({ ...cases['spec-assist (finalised edit)']!, specIds: ['feature/test'] }, 'confirm');
  assert.ok(fs.readFileSync(f.file, 'utf8').includes('finalised'));
});

test('a plain spec id no root holds is refused and nothing is prepared', async () => {
  await assert.rejects(session({ ...cases['spec-assist (finalised edit)']!, specIds: ['feature/absent'] }), /absent/);
});

test('a plan-create goal that mentions a path no root holds is prepared without it, and the real spec stays selected', async () => {
  const r = repo();
  const ask = (workflow: string) => ({ workflow, checkout: r.cwd, selection: { specIds: ['feature/test', 'feature/flags'], input: 'enable feature/flags for feature/test' } });
  assert.deepEqual((qualifySpecIds(ask('plan-create')).selection as { specIds: string[] }).specIds, ['base:feature/test']);
  assert.throws(() => qualifySpecIds(ask('spec-draft-architecture')), /flags/);
});

test('a done result with nothing for the user to confirm still needs file evidence', async () => {
  const f = await session({ ...cases['decision-new']!, extra: () => ({}) });
  const refused = await call(f.server, 4, 'validate', { requestId: f.requestId, result: f.result });
  assert.equal(refused.isError, true);
  assert.match(refused.text, /file evidence/);
});

test('a done result citing a file the request does not create is refused before any prompt', async () => {
  const c = cases['decision-new']!;
  const f = await session({ ...c, file: 'docs/decisions/0001-use-sqlite.md' });
  const bad = JSON.parse(JSON.stringify(f.result));
  for (const e of bad.criterionEvidence) e.artifacts = [{ path: 'docs/decisions/0001-use-sqlite.md', digest: sha256('different text'), kind: 'file' }];
  const refused = await call(f.server, 4, 'validate', { requestId: f.requestId, result: bad });
  assert.equal(refused.isError, true);
  assert.match(refused.text, /proposed content/);
  assert.equal(fs.existsSync(f.file), false);
});
