import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { DocumentationBundleError, type DocumentationManifest } from './bundle.js';
import { DocsUsageError, docsIndex, docsSearch, docsTopic } from './operations.js';
import * as core from '../core/index.js';

const assetRoot = fileURLToPath(new URL('../../assets/docs/', import.meta.url));
const cli = fileURLToPath(new URL('../cli.js', import.meta.url));
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
function withBundle(action: (root: string, edit: (id: string, content: string) => void) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specplane-docs-ops-'));
  try {
    fs.cpSync(assetRoot, root, { recursive: true });
    const edit = (id: string, content: string) => {
      const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')) as DocumentationManifest;
      const topic = manifest.topics.find(t => t.id === id)!;
      fs.writeFileSync(path.join(root, topic.path), content);
      topic.sha256 = sha(content);
      fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest));
    };
    action(root, edit);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
const runCli = (args: string[], cwd: string, env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env } });

test('index, topic and search agree on versions, order and content', () => {
  const index = docsIndex();
  assert.deepEqual(index.items.map(i => i.topic_id), ['getting-started', 'concepts', 'completion', 'workflows/plans', 'commands/spec-complete']);
  assert.match(index.orientation, /plans are optional/);
  const topic = docsTopic('concepts');
  assert.equal(topic.version, index.version);
  assert.equal(topic.docs_version, index.docs_version);
  assert.deepEqual(topic.related, index.items.find(i => i.topic_id === 'concepts')!.related);
  assert.ok(topic.source_references.length > 0 && topic.content.length > 0);
  assert.equal(docsSearch('plan').version, index.version);
  assert.deepEqual(Object.keys(topic), ['topic_id', 'title', 'version', 'docs_version', 'source_references', 'related', 'content']);
  assert.equal(core.docsTopic, docsTopic);
});

test('CLI and core output agree, outside Git, without config or network, with no warnings', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'specplane-docs-cwd-'));
  try {
    const env = { HOME: cwd, GIT_DIR: path.join(cwd, 'nope'), http_proxy: 'http://127.0.0.1:9', https_proxy: 'http://127.0.0.1:9' };
    const idx = runCli(['docs', '--json'], cwd, env);
    assert.equal(idx.status, 0); assert.equal(idx.stderr, '');
    assert.deepEqual(JSON.parse(idx.stdout), docsIndex());
    const top = runCli(['docs', 'workflows/plans', '--json'], cwd, env);
    assert.deepEqual(JSON.parse(top.stdout), docsTopic('workflows/plans'));
    const found = runCli(['docs', 'search', 'plans', '--json'], cwd, env);
    assert.equal(found.stderr, '');
    assert.deepEqual(JSON.parse(found.stdout), docsSearch('plans'));
    const human = runCli(['docs'], cwd, env);
    assert.equal(human.status, 0); assert.match(human.stdout, /commands\/spec-complete/); assert.equal(human.stderr, '');
    assert.equal(runCli(['docs', 'concepts'], cwd, env).stdout.startsWith(docsTopic('concepts').content.trimEnd()), true);
    // multi-word query is one literal phrase
    assert.deepEqual(JSON.parse(runCli(['docs', 'search', 'optional', 'plans', '--json'], cwd, env).stdout), docsSearch('optional plans'));
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});

test('unknown and traversal-like IDs are unknown topics with discovery guidance; search is not a topic', () => {
  for (const id of ['nope', '../manifest', '..\\x', '/etc/passwd', 'concepts/../completion', 'concepts.md', 'search', 'CONCEPTS', '']) {
    assert.throws(() => docsTopic(id), (e: unknown) => e instanceof DocsUsageError && e.code === 'DOCS_UNKNOWN_TOPIC' && /specplane docs/.test(e.message), id);
  }
  const cwd = os.tmpdir();
  for (const id of ['nope', '../manifest', 'concepts/../completion']) {
    const r = runCli(['docs', id], cwd);
    assert.equal(r.status, 1); assert.equal(r.stdout, ''); assert.match(r.stderr, /Unknown documentation topic/); assert.match(r.stderr, /specplane docs search/);
  }
});

test('empty and whitespace-only queries are refused with exit 1', () => {
  for (const q of ['', '   ', '\t\n']) assert.throws(() => docsSearch(q), (e: unknown) => e instanceof DocsUsageError && e.code === 'DOCS_EMPTY_QUERY');
  for (const q of ['', '  ']) {
    const r = runCli(['docs', 'search', q], os.tmpdir());
    assert.equal(r.status, 1); assert.equal(r.stdout, ''); assert.match(r.stderr, /Search text must not be empty/);
  }
});

test('search is case-insensitive and literal, sorted by topic ID, limited to three excerpts, with line numbers', () => withBundle((root, edit) => {
  edit('concepts', '# Concepts\n\nNeedle one\nneedle TWO\n  NEEDLE three  \nneedle four\nregex a.c (x+) chars\n');
  edit('completion', '# Completion\nOne needle here\n');
  const result = docsSearch('NeEdLe', root);
  assert.deepEqual(result.items.map(i => i.topic_id), ['completion', 'concepts']);
  assert.deepEqual(result.items[1].excerpts, [{ line: 3, text: 'Needle one' }, { line: 4, text: 'needle TWO' }, { line: 5, text: 'NEEDLE three' }]);
  assert.deepEqual(result.items[0].excerpts, [{ line: 2, text: 'One needle here' }]);
  assert.deepEqual(docsSearch('a.c (x+)', root).items.map(i => i.topic_id), ['concepts']);
  assert.deepEqual(docsSearch('a.c (x+)', root), docsSearch('a.c (x+)', root));
  assert.deepEqual(docsSearch('a.*c', root).items, []);
}));

test('no results is a successful empty item list, human and JSON', () => {
  assert.deepEqual(docsSearch('zzzq-no-such-text').items, []);
  const json = runCli(['docs', 'search', 'zzzq-no-such-text', '--json'], os.tmpdir());
  assert.equal(json.status, 0);
  assert.deepEqual(JSON.parse(json.stdout), { version: docsIndex().version, docs_version: docsIndex().docs_version, items: [] });
  const human = runCli(['docs', 'search', 'zzzq-no-such-text'], os.tmpdir());
  assert.equal(human.status, 0); assert.equal(human.stderr, '');
});

test('title-only match returns the topic with an empty excerpt list (D7)', () => withBundle((root, edit) => {
  edit('completion', '# Heading differs\n\nNothing relevant.\n');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')) as DocumentationManifest;
  const title = manifest.topics.find(t => t.id === 'completion')!.title;
  const result = docsSearch(title.toUpperCase(), root);
  assert.deepEqual(result.items.find(i => i.topic_id === 'completion'), { topic_id: 'completion', title, excerpts: [] });
}));

test('corrupt or missing bundle bytes fail with package-repair guidance and no repository fallback', () => withBundle(root => {
  fs.writeFileSync(path.join(root, 'topics/concepts.md'), 'tampered');
  for (const run of [() => docsIndex(root), () => docsTopic('concepts', root), () => docsSearch('x', root)]) {
    assert.throws(run, (e: unknown) => e instanceof DocumentationBundleError && /Repair or reinstall/.test(e.message));
  }
  fs.rmSync(path.join(root, 'manifest.json'));
  assert.throws(() => docsIndex(root), (e: unknown) => e instanceof DocumentationBundleError);
}));
