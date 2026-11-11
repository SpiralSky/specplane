import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { ESSENTIALS_LIMIT_BYTES } from './bundle.js';
import { loadEssentials } from './operations.js';
import { MANDATORY_NOTES, REQUIRED_TOPIC_IDS, checkRequiredTopics, collectRequiredInputs, type RequiredInputs } from './required.js';

// The hand-written source is in the repository, not in the package; skip when running from an unpacked package.
const userDocs = fileURLToPath(new URL('../../../../docs/user/', import.meta.url));
const available = fs.existsSync(userDocs);
const read = (): Map<string, string> => new Map(fs.readdirSync(userDocs).filter(n => n.endsWith('.md') && n !== 'orientation.md').map(n => [n.slice(0, -3), fs.readFileSync(path.join(userDocs, n), 'utf8')]));
const inputs: RequiredInputs = collectRequiredInputs();
const without = (docs: Map<string, string>, id: string, edit: (text: string) => string): Map<string, string> => new Map(docs).set(id, edit(docs.get(id)!));

test('required inputs cover the catalog, settings, adapters and every command', () => {
  assert.ok(inputs.permissions.includes('spec.approve') && inputs.settings.includes('audit.retention'));
  assert.deepEqual(inputs.harnesses.sort(), ['claude', 'codex']);
  for (const c of ['spec approve', 'plan start', 'docs', 'docs search', 'docs essentials', 'test run', 'init', 'validate']) assert.ok(inputs.commands.includes(c), c);
});

test('the user documentation documents every command, permission, key, note and harness capability', { skip: !available }, () => {
  assert.deepEqual(checkRequiredTopics(read(), inputs), []);
});

test('the check fails on a missing topic, command, permission, key, default, note or capability', { skip: !available }, () => {
  const docs = read();
  const fails = (changed: Map<string, string>, pattern: RegExp) => assert.ok(checkRequiredTopics(changed, inputs).some(e => pattern.test(e)), String(pattern));
  const missing = new Map(docs); missing.delete('plans');
  fails(missing, /missing topic `plans`/);
  fails(without(docs, 'commands', t => t.replace('### `plan start`\n', '### `plan begin`\n')), /command `plan start`/);
  fails(without(docs, 'permissions', t => t.replace('### `spec.approve`\n', '### `spec.accept`\n')), /permission `spec.approve`/);
  fails(without(docs, 'configuration', t => t.replace(/^\| `audit.retention` .*\n/m, '')), /key `audit.retention` is not documented/);
  fails(without(docs, 'configuration', t => t.replace(/^(\| `audit.retention` \| )[^|]*\|/m, '$1 |')), /key `audit.retention` is shown without its default/);
  for (const id of MANDATORY_NOTES) {
    const stripped = new Map([...docs].map(([k, v]) => [k, v.replace(`<!-- note: ${id} -->`, '')]));
    fails(stripped, new RegExp(`note \`${id}\` is missing`));
  }
  fails(without(docs, 'verification', t => t.replace(/<!-- note: audit-retention -->\n.*\n/, '<!-- note: audit-retention -->\n\n')), /note `audit-retention` has no text/);
  fails(without(docs, 'harnesses', t => t.replace(/usage measurement/gi, 'x')), /capability "usage measurement"/);
  fails(without(docs, 'harnesses', t => t.replace(/codex/gi, 'x')), /harness `codex`/);
  assert.ok(REQUIRED_TOPIC_IDS.length >= 9);
});

test('essentials stay under the size limit, name every topic and carry the mandatory notes', () => {
  const text = loadEssentials();
  assert.ok(Buffer.byteLength(text) <= ESSENTIALS_LIMIT_BYTES, `${Buffer.byteLength(text)} bytes`);
  const bundle = JSON.parse(fs.readFileSync(new URL('../../assets/docs/manifest.json', import.meta.url), 'utf8')) as { topics: { id: string }[] };
  for (const t of bundle.topics) assert.ok(text.includes(`\`${t.id}\``), t.id);
  assert.match(text, /docs\.search/);
  assert.match(text, /Group approval/);
});

test('essentials refuse a changed or oversized file', () => {
  const source = fileURLToPath(new URL('../../assets/ai-docs/', import.meta.url));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specplane-ai-docs-'));
  try {
    fs.cpSync(source, root, { recursive: true });
    fs.writeFileSync(path.join(root, 'essentials.md'), 'tampered');
    assert.throws(() => loadEssentials(root), /digest mismatch/);
    const big = 'x'.repeat(ESSENTIALS_LIMIT_BYTES + 1);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    manifest.essentials.sha256 = require_sha(big);
    fs.writeFileSync(path.join(root, 'essentials.md'), big);
    fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest));
    assert.throws(() => loadEssentials(root), /size limit/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
import { createHash } from 'node:crypto';
function require_sha(text: string): string { return createHash('sha256').update(text).digest('hex'); }
