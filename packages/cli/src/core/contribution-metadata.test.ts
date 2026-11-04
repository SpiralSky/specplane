import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { parseFrontmatter } from '../frontmatter.js';
import type { ContributionEvent } from './contracts.js';
import { prepareContributionMetadata, setFinalizedAssistAuthor } from './contribution-metadata.js';

const d = 'a'.repeat(64), e = 'b'.repeat(64);
const source = (extra = '', author = 'user') => `---\nid: architecture/test\ntitle: Test\nstatus: draft\nauthor: ${author}\n${extra}---\n# Body\nUnchanged body.\n`;
function event(model?: string, role: ContributionEvent['role'] = 'review', kind: 'human' | 'model' = 'model'): ContributionEvent {
  return { eventId: randomUUID(), requestId: 'request', spec: 'base:architecture/test', source: 'runtime', role,
    actor: { kind, display_name: 'same display', ...(model ? { provider: 'host', model_id: model } : {}) },
    action: { kind: role === 'review' ? 'review' : role === 'create' ? 'create' : 'edit', evidencePath: 'report.md', evidenceDigest: d },
    revision: role === 'review' ? { reviewedDigest: d } : { beforeDigest: d, afterDigest: e } };
}

test('known A/B models reuse stable summaries across actions and later revisions', () => {
  const a = event('A'), b = event('B'), secondA = event('A');
  secondA.actor.session_id = 'later';
  const input = [b, secondA, a, structuredClone(a)];
  const first = prepareContributionMetadata(source(), input);
  assert.deepEqual(prepareContributionMetadata(source(), input), first, 'proposal revalidation must be deterministic');
  const metadata = parseFrontmatter(first.text).data;
  const summaries = metadata.contributors as { id: string; model_id: string; roles: string[] }[];
  assert.equal(summaries.length, 2);
  const trailers = first.trailers.map(value => JSON.parse(value));
  assert.equal(trailers.length, 3);
  assert.deepEqual(trailers.map(t => t.event_id), [...new Set(input.map(e => e.eventId))].sort());
  assert.equal(new Set(trailers.filter(t => t.model_id === 'A').map(t => t.contributor)).size, 1);
  const later = prepareContributionMetadata(first.text, [event('A', 'revise'), event('C', 'revise')]);
  const after = parseFrontmatter(later.text).data.contributors as typeof summaries;
  assert.equal(after.length, 3);
  assert.equal(after.find(s => s.model_id === 'A')?.id, summaries.find(s => s.model_id === 'A')?.id);
  assert.deepEqual(after.find(s => s.model_id === 'A')?.roles, ['review', 'revise']);
  assert.equal(parseFrontmatter(later.text).data.author, 'mixed');
  assert.deepEqual(input, [b, secondA, a, structuredClone(a)], 'caller events stay immutable');
});

test('unknown models and humans with the same display name remain separate', () => {
  const events = [event(), event(), event(undefined, 'review', 'human'), event(undefined, 'review', 'human')];
  const result = prepareContributionMetadata(source(), events);
  const summaries = parseFrontmatter(result.text).data.contributors as { id: string; kind: string }[];
  assert.equal(summaries.length, 4);
  assert.deepEqual(summaries.map(s => s.id).sort(), events.map(e => e.eventId).sort());
  assert.equal(summaries.filter(s => s.kind === 'human').length, 2);
  assert.deepEqual(prepareContributionMetadata(result.text, events), result);
});

test('review preserves author while body contributions summarize prior and new actors', () => {
  for (const author of ['user', 'llm', 'mixed']) {
    assert.equal(parseFrontmatter(prepareContributionMetadata(source('', author), [event('A')]).text).data.author, author);
    for (const kind of ['human', 'model'] as const) {
      const actorAuthor = kind === 'human' ? 'user' : 'llm';
      const expected = author === actorAuthor ? author : 'mixed';
      for (const role of ['create', 'revise'] as const) assert.equal(parseFrontmatter(prepareContributionMetadata(source('', author), [event(undefined, role, kind)]).text).data.author, expected);
    }
  }
  const original = source('# untouched\n');
  assert.deepEqual(prepareContributionMetadata(original, []), { text: original, trailers: [] });
});

test('source spans preserve unrelated metadata comments body delimiters and line endings', () => {
  const a = event('A', 'revise');
  for (const form of ['block', 'flow', 'explicit', 'indented', 'crlf', 'cr'] as const) {
    let text = form === 'flow'
      ? '---\n{id: architecture/test, title: "quoted title", status: draft, author: user, custom: {key: value}}\n--- # delimiter\n# Body\n'
      : form === 'explicit'
      ? source('? contributors\n: []\n# preserved comment\ncustom: {key: value}\n')
      : source('contributors:\n  - id: prior\n    kind: human\n    roles: [review]\n# preserved comment\ncustom: {key: value}\n');
    if (form === 'indented') { const close = text.indexOf('---', 4); text = text.slice(0, 4) + text.slice(4, close).replace(/^/gm, '  ').replace(/  $/, '') + text.slice(close); }
    if (form === 'crlf') text = text.replace(/\n/g, '\r\n');
    if (form === 'cr') text = text.replace(/\n/g, '\r');
    const before = parseFrontmatter(text), result = prepareContributionMetadata(text, [a]);
    const after = parseFrontmatter(result.text);
    assert.equal(after.body, before.body, form);
    assert.deepEqual(after.data.custom, before.data.custom, form);
    assert.equal(after.data.title, before.data.title, form);
    if (text.includes('# preserved comment')) assert.ok(result.text.includes('# preserved comment'), form);
    if (text.includes('--- # delimiter')) assert.ok(result.text.includes('--- # delimiter'), form);
    if (form === 'crlf') assert.equal(result.text.replace(/\r\n/g, '').includes('\n'), false);
    if (form === 'cr') assert.equal(result.text.includes('\n'), false);
  }
});

test('malformed summaries ambiguous identities conflicting IDs and wrong specs refuse', () => {
  const invalid = [
    'contributors: null\n', 'contributors: {}\n', 'contributors: [{id: x, kind: model, roles: []}]\n',
    'contributors: [{id: x, kind: model, roles: [review], extra: no}]\n',
    'contributors: [{id: x, kind: model, roles: [review, review]}]\n',
    'contributors: [{id: x, kind: human, roles: [review]}, {id: x, kind: model, roles: [review]}]\n',
    'contributors: [{id: x, kind: model, provider: host, model_id: A, roles: [review]}, {id: y, kind: model, provider: host, model_id: A, roles: [revise]}]\n',
  ];
  for (const extra of invalid) assert.throws(() => prepareContributionMetadata(source(extra), [event('A')]), Error, extra);
  const a = event('A');
  assert.throws(() => prepareContributionMetadata(source(), [a, { ...a, actor: { kind: 'human' } }]));
  assert.throws(() => prepareContributionMetadata(source(), [{ ...a, spec: 'base:architecture/other' }]));
  assert.throws(() => prepareContributionMetadata(source(), [a, { ...event('B'), spec: 'other:architecture/test' }]));
  assert.throws(() => prepareContributionMetadata(source(), [{ ...a, role: 'revise' }]));
  assert.throws(() => prepareContributionMetadata(source(`contributors: [{id: ${a.eventId}, kind: human, roles: [review]}]\n`), [a]));
});

test('shared aliases refuse if attribution replacement would alter other metadata', () => {
  for (const text of [
    source('contributors: &old [{id: prior, kind: human, roles: [review]}]\nother: *old\n'),
    source('other: &old [{id: prior, kind: human, roles: [review]}]\ncontributors: *old\n'),
    source('other: *old\n', '&old user'),
  ]) {
    assert.throws(() => prepareContributionMetadata(text, [event('A', 'revise')]));
  }
});


test('finalized assist authorship changes only author while preserving exact body and metadata bytes', () => {
  for (const eol of ['\n', '\r\n', '\r']) {
    const text = source('# retained comment\ncustom: {key: value}\n').replace(/\n/g, eol);
    const result = setFinalizedAssistAuthor(text);
    assert.equal(result, text.replace('author: user', 'author: mixed'));
    assert.equal(parseFrontmatter(result).body, parseFrontmatter(text).body);
    assert.equal(setFinalizedAssistAuthor(result), result);
    assert.equal(parseFrontmatter(result).data.contributors, undefined, 'authorship does not synthesize contribution evidence');
  }
  const flow = '---\n{id: architecture/test, title: Test, status: draft, author: llm, other: keep}\n---\n# Body\n';
  assert.equal(setFinalizedAssistAuthor(flow), flow.replace('author: llm', 'author: mixed'));
});

test('finalized assist refuses anchored author metadata instead of changing aliases', () => {
  for (const text of [source('other: *old\n', '&old user'), source().replace('author: user', 'other: &old user\nauthor: *old')]) {
    assert.throws(() => setFinalizedAssistAuthor(text));
  }
});
