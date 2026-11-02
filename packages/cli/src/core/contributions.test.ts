import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import type { ContributionEvent } from './contracts.js';
import { carryContributions, contributionTrailer, deduplicateContributions, type ContributorSummary } from './contributions.js';
import { formatMessage } from '../git/commit.js';
const d = 'a'.repeat(64), e = 'b'.repeat(64);
function event(model?: string, session = 's'): ContributionEvent {
  return { eventId: randomUUID(), requestId: 'request', spec: 'base:architecture/foo', role: 'revise', source: 'declared', actor: { kind: 'model', ...(model && { provider: 'p', model_id: model }), session_id: session }, action: { kind: 'edit', evidencePath: 'evidence', evidenceDigest: d }, revision: { beforeDigest: d, afterDigest: e } };
}
test('models, sessions, subagent and unknown identities survive rewrite with references', () => {
  const a = event('A'), b = event('B'), c = event('C', 'later'), child = event('D', 'child'), unknown = event();
  child.actor.parentSessionId = 's';
  const input = deduplicateContributions([c, a, b, child, unknown, structuredClone(a)], () => true);
  assert.equal(input.length, 5);
  const summaries: ContributorSummary[] = [];
  const trailers = input.map(x => contributionTrailer(x, summaries, () => true));
  assert.equal(summaries.length, 5);
  const again = contributionTrailer(unknown, summaries, () => true);
  assert.equal(again.contributor, trailers.find(x => x.event_id === unknown.eventId)?.contributor);
  assert.equal(again.model_id, undefined);
  assert.equal(summaries.length, 5);
  const carried = carryContributions([{ commit: '1'.repeat(40), values: trailers.map(x => JSON.stringify(x)) }]);
  const restored = carried.map(x => JSON.parse(x));
  assert.deepEqual(restored.map(x => x.event_id), trailers.map(x => x.event_id));
  assert.equal(restored.find(x => x.event_id === child.eventId).parent_session_id, 's');
  assert.equal(restored.find(x => x.event_id === unknown.eventId).model_id, undefined);
  assert.deepEqual(restored[0].origin, { commit: '1'.repeat(40), ordinal: 0 });
  const message = formatMessage({ type: 'docs', summary: 'rewrite', trailers: { 'Co-Authored-By': 'Human <x@y>', 'Specplane-Contribution': carried } });
  assert.equal(message.match(/^Specplane-Contribution:/gm)?.length, 5);
  assert.ok(message.indexOf('Specplane-Contribution:') < message.indexOf('Co-Authored-By:'));
});
test('invalid, untrusted, empty and conflicting events fail closed', () => {
  const a = event('A');
  const summaries: ContributorSummary[] = [];
  assert.throws(() => contributionTrailer(a, summaries, () => false));
  assert.deepEqual(summaries, []);
  assert.throws(() => deduplicateContributions([a], () => false));
  assert.throws(() => deduplicateContributions([{ ...a, role: 'review' }], () => true));
  assert.throws(() => deduplicateContributions([{ ...a, revision: { beforeDigest: d, afterDigest: d } }], () => true));
  assert.throws(() => deduplicateContributions([a, { ...a, actor: { ...a.actor, model_id: 'B' } }], () => true));
  assert.throws(() => deduplicateContributions([{ ...a, eventId: 'bad' }], () => true));
});
test('legacy events and correction history survive; unresolved corrections refuse', () => {
  const legacy = { spec: 'base:architecture/foo', contributor: 'one', role: 'revise', source: 'declared' };
  const corrected = { ...legacy, contributor: 'two', corrects: { commit: '1'.repeat(40), ordinal: 0 } };
  const commits = [{ commit: '1'.repeat(40), values: [JSON.stringify(legacy)] }, { commit: '2'.repeat(40), values: [JSON.stringify(corrected)] }];
  assert.equal(carryContributions(commits).length, 2);
  assert.throws(() => carryContributions(commits.slice(1)));
  assert.throws(() => carryContributions([{ commit: '1'.repeat(40), values: ['bad'] }]));
  assert.throws(() => carryContributions([{ commit: '1'.repeat(40), values: [JSON.stringify({ ...legacy, session_id: 4 })] }]));
});
test('corrections targeting a rewritten commit survive subsequent rewrites', () => {
  const original = '1'.repeat(40), rewrite = '2'.repeat(40), correction = '3'.repeat(40), next = '4'.repeat(40);
  const legacy = { spec: 'base:architecture/foo', contributor: 'one', role: 'revise', source: 'declared' };
  const first = carryContributions([{ commit: original, values: [JSON.stringify(legacy)] }]);
  const corrected = { ...legacy, contributor: 'two', corrects: { commit: rewrite, ordinal: 0 } };
  const second = carryContributions([{ commit: rewrite, values: first }, { commit: correction, values: [JSON.stringify(corrected)] }]);
  assert.deepEqual(JSON.parse(second[1]).corrects, { commit: original, ordinal: 0 });
  const third = carryContributions([{ commit: next, values: second }]);
  assert.deepEqual(JSON.parse(third[1]).corrects, { commit: original, ordinal: 0 });
  assert.deepEqual(JSON.parse(third[1]).origin, { commit: correction, ordinal: 0 });
});
