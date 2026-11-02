import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateImplementation, fingerprintClosure, fingerprintSpec } from "./completion.js";
import { parseSpec } from "../spec/parse.js";

const base = 'id: feature/example\ntitle: Example\nstatus: draft\nauthor: user\n';
const spec = (extra = '', body = '# Body\n') => `---\n${base}${extra}---\n${body}`;
const hash = (s: string) => `spec-v1:sha256:${createHash('sha256').update(s).digest('hex')}`;

test('spec-v1 serializes sorted mappings, literal Unicode, numbers and exact normalized body', () => {
  const text = spec('z: [2, 1]\nextra: {"10": ten, "2": two, "😀": smile, "": private}\n', '# é\n\n');
  assert.equal(fingerprintSpec(text), hash('{"body":"# é\\n\\n","frontmatter":{"extra":{"10":"ten","2":"two","":"private","😀":"smile"},"id":"feature/example","title":"Example","z":[2,1]}}'));
  assert.equal(fingerprintSpec(text.replace(/\n/g, '\r\n')), fingerprintSpec(text));
  assert.notEqual(fingerprintSpec(text.replace('# é', '# é ')), fingerprintSpec(text));
  assert.notEqual(fingerprintSpec(text.replace('[2, 1]', '[1, 2]')), fingerprintSpec(text));
});

test('only the specified bookkeeping fields are excluded', () => {
  const original = spec('contributors: [one]\nbased_on: {x: abc}\nimplementation: {status: complete}\nunknown: value\n');
  const revised = original.replace('draft', 'approved').replace('author: user', 'author: llm').replace('[one]', '[two]').replace('abc', 'def').replace('status: complete', 'status: partial');
  assert.equal(fingerprintSpec(original), fingerprintSpec(revised));
  assert.notEqual(fingerprintSpec(original), fingerprintSpec(original.replace('unknown: value', 'unknown: changed')));
});

test('gray-matter closing delimiter suffix remains body content', () => {
  const content = `---\n${base}--- # comment\nhello\n`;
  assert.equal(fingerprintSpec(content), hash('{"body":" # comment\\nhello\\n","frontmatter":{"id":"feature/example","title":"Example"}}'));
  const dir = mkdtempSync(join(tmpdir(), 'completion-delimiter-'));
  try {
    const file = join(dir, 'spec.md');
    writeFileSync(file, content);
    assert.equal(parseSpec(file).body, ' # comment\nhello\n');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('metadata schema accepts manual and future-version records, rejects malformed records without modifying files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'completion-'));
  const file = join(dir, 'spec.md');
  try {
    for (const entry of ['implementation: {status: complete}', `implementation: {status: complete, assessed_spec_hash: future:sha256:${'a'.repeat(64)}}`]) {
      writeFileSync(file, spec(`${entry}\n`)); assert.equal(parseSpec(file).frontmatter.implementation?.status, 'complete');
    }
    writeFileSync(file, spec(`implementation: {status: complete, assessed_dependencies: {"docs root:feature/other": "spec-v1:sha256:${'a'.repeat(64)}"}}\n`));
    assert.ok(parseSpec(file).frontmatter.implementation?.assessed_dependencies?.['docs root:feature/other']);
    for (const entry of ['implementation: {status: unknown}', 'implementation: {status: complete, extra: 1}', 'implementation: {status: complete, evidence: [""]}', 'implementation: {status: complete, assessed_spec_hash: bad}', `implementation: {status: complete, assessed_dependencies: {"feature/other": "spec-v1:sha256:${'a'.repeat(64)}"}}`, 'implementation: {status: complete, status: partial}', 'implementation: {status: complete, assessed_dependencies: {"base:feature/other#part": bad}}']) {
      const input = spec(`${entry}\n`); writeFileSync(file, input); assert.throws(() => parseSpec(file), entry); assert.equal(readFileSync(file, 'utf8'), input);
    }
    for (const extra of ['foo: .inf\n', '42: value\n', 'foo: !custom value\n', 'foo: one\nfoo: two\n']) assert.throws(() => fingerprintSpec(spec(extra)), extra);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('closure accepts identities in configured roots containing spaces', () => {
  const root = { id: 'docs root:feature/example', content: spec('extends: feature/other\n') };
  const result = fingerprintClosure(root, { resolve(ref, fromRoot) {
    assert.equal(fromRoot, 'docs root');
    return { id: `${fromRoot}:${ref}`, content: spec() };
  } });
  assert.deepEqual(Object.keys(result.assessed_dependencies), ['docs root:feature/other']);
});

test('closure resolves anchored edges from each declaring root, deduplicates cycles and records membership', () => {
  const nodes: Record<string, string> = {
    'alpha:feature/root': spec('extends: beta:feature/other#heading\n'),
    'beta:feature/other': spec('extends: feature/third#anchor\n'),
    'beta:feature/third': spec('extends: alpha:feature/root\n'),
  };
  const calls: string[] = [];
  const snapshot = { resolve(ref: string, from: string) { calls.push(`${from}:${ref}`); const id = ref.includes(':') ? ref : `${from}:${ref}`; if (!(id in nodes)) throw new Error('unavailable'); return { id, content: nodes[id] }; } };
  const root = { id: 'alpha:feature/root', content: nodes['alpha:feature/root'] };
  const first = fingerprintClosure(root, snapshot);
  assert.deepEqual(Object.keys(first.assessed_dependencies).sort(), ['beta:feature/other', 'beta:feature/third']);
  assert.deepEqual(calls, ['alpha:beta:feature/other', 'beta:feature/third', 'beta:alpha:feature/root']);
  nodes['beta:feature/other'] = spec();
  const second = fingerprintClosure(root, snapshot);
  assert.deepEqual(Object.keys(second.assessed_dependencies), ['beta:feature/other']);
  assert.notEqual(first.assessed_dependencies['beta:feature/other'], second.assessed_dependencies['beta:feature/other']);
  delete nodes['beta:feature/other']; assert.throws(() => fingerprintClosure(root, snapshot), /unavailable/);
});

test('assessment preserves known changes with unavailable and unsupported dependencies', () => {
  const nodes: Record<string, string> = { 'base:feature/other': spec('', '# Other\n'), 'base:feature/extra': spec('', '# Extra\n') };
  const snapshot = { resolve(ref: string, from: string) { const id = ref.includes(':') ? ref : `${from}:${ref}`; if (!nodes[id]) throw new Error('missing'); return { id, content: nodes[id] }; } };
  const plain = spec('extends: [feature/other, feature/extra]\n');
  const root = { id: 'base:feature/example', content: plain };
  const fp = fingerprintClosure(root, snapshot);
  const withImpl = (fields: object) => ({ ...root, content: plain.replace('---\n# Body', `implementation: ${JSON.stringify(fields)}\n---\n# Body`) });
  assert.equal(evaluateImplementation(withImpl({ status: 'complete', ...fp }), snapshot).assessment_status, 'current');
  assert.equal(evaluateImplementation(withImpl({ status: 'partial', ...fp }), snapshot).assessment_status, 'unrecorded');
  assert.equal(evaluateImplementation(withImpl({ status: 'complete' }), snapshot).assessment_status, 'unrecorded');
  assert.equal(evaluateImplementation(withImpl({ status: 'complete', assessed_spec_hash: fp.assessed_spec_hash }), snapshot).assessment_reasons[0].code, 'coverage_unrecorded');
  nodes['base:feature/other'] += 'changed\n';
  delete nodes['base:feature/extra'];
  const assessed = evaluateImplementation(withImpl({ status: 'complete', ...fp, assessed_spec_hash: `future:sha256:${'a'.repeat(64)}` }), snapshot);
  assert.equal(assessed.assessment_status, 'unverifiable');
  assert.deepEqual(assessed.assessment_reasons.map(r => r.code), ['dependency_changed', 'dependency_unavailable', 'unsupported_version']);
  assert.throws(() => evaluateImplementation(withImpl({ status: 'complete', assessed_spec_hash: 'bad' }), snapshot), /Invalid spec metadata/);
});

test('assessment reports membership and root changes in deterministic order', () => {
  const nodes: Record<string, string> = { 'base:feature/old': spec(), 'base:feature/new': spec() };
  const snapshot = { resolve(ref: string, from: string) { const id = ref.includes(':') ? ref : `${from}:${ref}`; if (!nodes[id]) throw Error('missing'); return { id, content: nodes[id] }; } };
  const original = { id: 'base:feature/example', content: spec('extends: feature/old\n') };
  const fp = fingerprintClosure(original, snapshot);
  const changed = spec(`extends: feature/new\nimplementation: ${JSON.stringify({ status: 'complete', ...fp })}\n`);
  const assessment = evaluateImplementation({ ...original, content: changed }, snapshot);
  assert.equal(assessment.assessment_status, 'reassessment_needed');
  assert.deepEqual(assessment.assessment_reasons.map(r => r.code), ['root_changed', 'dependency_added', 'dependency_removed']);
});
