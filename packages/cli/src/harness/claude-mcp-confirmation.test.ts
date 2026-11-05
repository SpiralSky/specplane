// PROVISIONAL (D17 option A, awaiting approval of the proposal's A6): the server parks the core's confirmation
// challenge and a second `record` call answers it. Fixtures only; the real runner and core, no host.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fixture, repo } from '../core/workflow-test-fixture.js';
import { createWorkflowRunner } from '../core/workflow-runner.js';
import { createClaudeMcpServer, createConfirmationBridge } from './claude-mcp.js';

const NONCE = 'nonce-0123456789abcdef';
const SPEC = 'base:feature/test';
const FILE = 'specs/features/test.md';
const BODY = '# Test\n\nFinalized feature content approved for writing.\n';

const rpc = (n: number, name: string, args: Record<string, unknown>) => ({ jsonrpc: '2.0', id: n, method: 'tools/call', params: { name, arguments: { nonce: NONCE, ...args } } });
async function call(server: ReturnType<typeof createClaudeMcpServer>, n: number, name: string, args: Record<string, unknown>) {
  const out: Array<Record<string, any>> = [];
  async function* input() { yield JSON.stringify(rpc(n, name, args)) + '\n'; }
  await server.serve({ input: input(), write: l => out.push(JSON.parse(l)) });
  const r = out[0]!.result;
  return { isError: r.isError as boolean, text: r.content[0].text as string, json: (() => { try { return JSON.parse(r.content[0].text); } catch { return undefined; } })() };
}

async function setup(now?: () => number) {
  const r = repo();
  r.put('.specplane/config.yaml', fs.readFileSync(path.join(r.cwd, '.specplane/config.yaml'), 'utf8') + 'specs:\n  feature:\n    llm_role: assist\n');
  r.git('commit', '-am', 'set policy'); r.git('switch', '-c', 'work/non-plan');
  const p = await fixture('spec-assist');
  const confirmations = createConfirmationBridge();
  const runner = createWorkflowRunner({
    checkout: r.cwd, extensionId: p.host.extensionId, compatibilityFor: () => ({ manifest: p.manifest, host: p.host }),
    context: { interaction: confirmations.port },
  });
  const server = createClaudeMcpServer(runner, { confirmations, ...(now ? { now } : {}) });
  await call(server, 1, 'bind', {});
  const prepared = await call(server, 2, 'prepare', { protocol: 1, workflow: 'spec-assist', extensionId: p.host.extensionId, checkout: r.cwd, mode: 'attended', selection: { specIds: [SPEC], input: 'Review the requested content' } });
  assert.equal(prepared.isError, false, prepared.text);
  const requestId = prepared.json.value.requestId as string;
  let json = '';
  for (let offset = 0; ;) {
    const page = (await call(server, 3, 'detail', { requestId, offset })).json.value;
    json += page.chunk; if (page.done) break; offset = page.next;
  }
  const request = JSON.parse(json);
  const result = {
    protocol: 1, requestId, baseDigest: request.base.digest, outcome: 'blocked', summary: 'record reviewed content', changes: [],
    criterionEvidence: request.criteria.map((c: { id: string }) => ({ criterionId: c.id, assessment: 'uncertain', rationale: 'Semantic acceptance remains unverified without a reviewed mapping', artifacts: [] })),
    gaps: [], contextExpansion: [], contributionEvents: [], openIssues: 'BLOCKED: acceptance review remains uncertain', nextKnows: 'Inspect this limitation before declaring completion.',
    finalizedEdits: [{ spec: SPEC, body: BODY }],
  };
  const validated = await call(server, 4, 'validate', { requestId, result });
  assert.equal(validated.isError, false, validated.text);
  const proposal = validated.json.value as Record<string, unknown>;
  const original = fs.readFileSync(path.join(r.cwd, FILE), 'utf8');
  const parkedChallenge = async () => {
    const first = await call(server, 5, 'record', proposal);
    assert.equal(first.isError, true);
    assert.equal(first.json.error.code, 'CONFIRMATION_REQUIRED');
    return first.json.error.details.challenge as { challengeId: string; summary: string; expiresAt: string; targets: string[] };
  };
  const answer = (challengeId: string, decision: 'confirm' | 'decline', interactionId = 'mod-dialog-1', extra: Record<string, unknown> = {}) =>
    call(server, 6, 'record', { ...proposal, ...extra, confirmation: { challengeId, decision, interactionId } });
  const lease = async () => (await call(server, 7, 'inspect', { requestId })).json?.value?.lease;
  return { r, server, runner, requestId, proposal, original, parkedChallenge, answer, lease };
}

test('D17 A: the first record parks the challenge, the second record with confirm writes the spec', async () => {
  const f = await setup();
  const challenge = await f.parkedChallenge();
  assert.deepEqual(challenge.targets, [FILE]);
  assert.ok(challenge.summary.includes(f.original) && challenge.summary.includes(BODY), 'summary carries the exact before and after');
  assert.equal(fs.readFileSync(path.join(f.r.cwd, FILE), 'utf8'), f.original, 'nothing is written while the challenge is parked');
  const done = await f.answer(challenge.challengeId, 'confirm');
  assert.equal(done.isError, false, done.text);
  assert.ok(fs.readFileSync(path.join(f.r.cwd, FILE), 'utf8').includes('Finalized feature content approved for writing.'));
});

test('D17 A: a decline writes nothing and closes the request', async () => {
  const f = await setup();
  const challenge = await f.parkedChallenge();
  const done = await f.answer(challenge.challengeId, 'decline');
  assert.equal(done.isError, true);
  assert.equal(fs.readFileSync(path.join(f.r.cwd, FILE), 'utf8'), f.original);
  assert.deepEqual(f.runner.tracked(), []);
});

test('D17 A: a mismatched challengeId ends the parked call; nothing is written and the request is closed', async () => {
  const f = await setup();
  await f.parkedChallenge();
  const done = await f.answer('not-the-challenge', 'confirm');
  assert.equal(done.isError, true);
  assert.match(done.text, /different challenge/);
  assert.equal(fs.readFileSync(path.join(f.r.cwd, FILE), 'utf8'), f.original);
  assert.deepEqual(f.runner.tracked(), []);
});

test('D17 A: a replay of an answered confirmation is refused and writes nothing more', async () => {
  const f = await setup();
  const challenge = await f.parkedChallenge();
  assert.equal((await f.answer(challenge.challengeId, 'confirm')).isError, false);
  const after = fs.readFileSync(path.join(f.r.cwd, FILE), 'utf8');
  const replay = await f.answer(challenge.challengeId, 'confirm');
  assert.equal(replay.isError, true);
  assert.match(replay.text, /No confirmation is pending/);
  assert.equal(fs.readFileSync(path.join(f.r.cwd, FILE), 'utf8'), after);
});

test('D17 A: a confirmation with no parked challenge is refused without forwarding anything', async () => {
  const f = await setup();
  const done = await f.answer('invented', 'confirm');
  assert.equal(done.isError, true);
  assert.match(done.text, /No confirmation is pending/);
  assert.equal(fs.readFileSync(path.join(f.r.cwd, FILE), 'utf8'), f.original);
});

test('D17 A: an expired challenge refuses the answer', async () => {
  let clock = Date.now();
  const f = await setup(() => clock);
  const challenge = await f.parkedChallenge();
  clock = Date.parse(challenge.expiresAt) + 1;
  const done = await f.answer(challenge.challengeId, 'confirm');
  assert.equal(done.isError, true);
  assert.match(done.text, /expired/);
  assert.equal(fs.readFileSync(path.join(f.r.cwd, FILE), 'utf8'), f.original);
  assert.deepEqual(f.runner.tracked(), []);
});

test('D17 A: a different proposal in the second call, or a malformed response, ends the parked call', async () => {
  for (const variant of ['proposal', 'malformed'] as const) {
    const f = await setup();
    const challenge = await f.parkedChallenge();
    const done = variant === 'proposal'
      ? await f.answer(challenge.challengeId, 'confirm', 'mod-dialog-1', { summary: 'a different proposal summary' })
      : await call(f.server, 6, 'record', { ...f.proposal, confirmation: { challengeId: challenge.challengeId, decision: 'maybe', interactionId: '' } });
    assert.equal(done.isError, true, variant);
    assert.equal(fs.readFileSync(path.join(f.r.cwd, FILE), 'utf8'), f.original, variant);
    assert.deepEqual(f.runner.tracked(), [], variant);
  }
});

test('D17 A: close while a challenge is parked ends it as a refusal and releases the lease', async () => {
  const f = await setup();
  await f.parkedChallenge();
  const closed = await call(f.server, 8, 'close', { requestId: f.requestId });
  assert.equal(closed.isError, false, closed.text);
  assert.deepEqual(f.runner.tracked(), []);
  assert.equal(fs.readFileSync(path.join(f.r.cwd, FILE), 'utf8'), f.original);
});

test('D17 A: a second record without confirmation while one is parked ends the first', async () => {
  const f = await setup();
  await f.parkedChallenge();
  const again = await call(f.server, 9, 'record', f.proposal);
  assert.equal(again.isError, true);
  assert.match(again.text, /already pending/);
  assert.deepEqual(f.runner.tracked(), []);
});

test('D17 A: without a bridge, finalized content is refused as before (D17 B stays reachable)', async () => {
  const r = repo();
  r.put('.specplane/config.yaml', fs.readFileSync(path.join(r.cwd, '.specplane/config.yaml'), 'utf8') + 'specs:\n  feature:\n    llm_role: assist\n');
  r.git('commit', '-am', 'set policy'); r.git('switch', '-c', 'work/non-plan');
  const p = await fixture('spec-assist');
  const runner = createWorkflowRunner({ checkout: r.cwd, extensionId: p.host.extensionId, compatibilityFor: () => ({ manifest: p.manifest, host: p.host }) });
  const server = createClaudeMcpServer(runner);
  await call(server, 1, 'bind', {});
  const prepared = await call(server, 2, 'prepare', { protocol: 1, workflow: 'spec-assist', extensionId: p.host.extensionId, checkout: r.cwd, mode: 'attended', selection: { specIds: [SPEC], input: 'x' } });
  assert.equal(prepared.isError, false, prepared.text);
  const unconfirmed = await call(server, 3, 'record', { requestId: prepared.json.value.requestId, confirmation: { challengeId: 'c', decision: 'confirm', interactionId: 'i' } });
  assert.equal(unconfirmed.isError, true);
  assert.equal(fs.readFileSync(path.join(r.cwd, FILE), 'utf8').includes('Finalized'), false);
});
