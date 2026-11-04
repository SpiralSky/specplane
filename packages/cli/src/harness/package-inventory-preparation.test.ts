import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { coreInfo } from '../core/build-info.js';
import { validateCompatibility, type ExtensionManifest, type HostSelection } from '../core/compatibility.js';
import { loadDocumentationBundle, type DocumentationManifest } from '../docs/bundle.js';

// Preparation fixtures bind current package bytes, not committed release pins or
// host certification. Installer activation and complete runtime delivery remain
// separate acceptance work.
const docsAssets = fileURLToPath(new URL('../../assets/docs/', import.meta.url));
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const versions = { core_version: coreInfo.version, docs_version: coreInfo.docsVersion, contract_version: coreInfo.contractVersion };
function files(root: string, prefix = ''): string[] {
  return fs.readdirSync(path.join(root, prefix), { withFileTypes: true }).flatMap(entry => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? files(root, relative) : [relative];
  }).sort();
}
function snapshot(root: string): unknown {
  return files(root).map(relative => ({ path: relative, bytes: fs.readFileSync(path.join(root, relative)).toString('base64'), mode: fs.statSync(path.join(root, relative)).mode }));
}
function fixture(action: (value: ReturnType<typeof prepare>) => Promise<void>): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specplane-package-preparation-'));
  return (async () => {
    try { await action(prepare(root)); }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
  })();
}
function prepare(root: string) {
  const put = (relative: string, bytes: string) => {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), bytes);
    return sha(bytes);
  };
  fs.cpSync(docsAssets, path.join(root, 'docs'), { recursive: true });
  const docs = loadDocumentationBundle(path.join(root, 'docs'), versions).manifest;
  const source = docs.topics.flatMap(topic => topic.sources).find(entry => entry.id === 'base:architecture/reference-cli')!;
  assert.ok(source, 'package preparation requires the actual reference CLI source snapshot');
  const sourceBytes = fs.readFileSync(path.join(root, 'docs', source.path));
  const blob = createHash('sha1').update(`blob ${sourceBytes.length}\0`).update(sourceBytes).digest('hex');
  put('core/index.js', '// Fixture runtime; not an installed host runner.\n');
  put('instructions.md', `<!-- specplane-orientation: ${JSON.stringify({ docs_version: coreInfo.docsVersion, contract_version: coreInfo.contractVersion, sha256: docs.orientation.sha256 })} -->\n`);
  const manifest: ExtensionManifest = {
    schemaVersion: 1,
    extension: { id: 'specplane-codex', version: coreInfo.version, host: 'codex' },
    core: { ...coreInfo }, hostCompatibility: [],
    capabilities: { reasoning: true, nativeCommands: true, backgroundSessions: true },
    procedures: [{ workflow: 'plan-step', contracts: [{ id: source.id, anchor: 'Compatibility manifest and package delivery', blob, sha256: source.sha256, path: `docs/${source.path}` }] }],
    assets: [],
  };
  const host: HostSelection = { packageRoot: root, extensionId: manifest.extension.id, host: 'codex', surface: 'fixture', workflow: 'plan-step', probes: { nativeCommands: true, backgroundSessions: true } };
  const seal = () => {
    const inventory = files(root).filter(relative => !['core/inventory.json', 'specplane-extension.json'].includes(relative));
    const inventoryHash = put('core/inventory.json', JSON.stringify({ root: '.', files: inventory.map(relative => ({ path: relative, sha256: sha(fs.readFileSync(path.join(root, relative))) })) }));
    manifest.assets = [
      { path: 'core/inventory.json', sha256: inventoryHash, kind: 'core' },
      ...inventory.filter(relative => relative.startsWith('docs/')).map(relative => ({ path: relative, sha256: sha(fs.readFileSync(path.join(root, relative))), kind: 'docs' as const })),
      { path: 'instructions.md', sha256: sha(fs.readFileSync(path.join(root, 'instructions.md'))), kind: 'instructions' },
    ];
    put('specplane-extension.json', JSON.stringify(manifest));
  };
  const saveDocs = () => put('docs/manifest.json', JSON.stringify(docs));
  seal();
  return { root, manifest, host, docs, put, seal, saveDocs };
}
async function checkWithoutMutation(value: ReturnType<typeof prepare>) {
  const before = snapshot(value.root);
  const result = await validateCompatibility(value.manifest, value.host, coreInfo);
  assert.deepEqual(snapshot(value.root), before, 'compatibility lookup must preserve package bytes and file modes');
  return result;
}

test('extension inventory resolves the current docs bundle outside Git and retains unknown-host capability limits', () => fixture(async value => {
  const result = await checkWithoutMutation(value);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (result.ok) {
    assert.deepEqual(result.value, { reasoning: true, nativeCommands: false, backgroundSessions: false });
    assert.ok(result.notices.some(notice => notice.code === 'UNVERIFIED_SURFACE'));
  }
  const bundle = loadDocumentationBundle(path.join(value.root, 'docs'), versions);
  assert.equal(bundle.orientation, fs.readFileSync(path.join(docsAssets, bundle.manifest.orientation.path), 'utf8'));
  assert.equal(fs.existsSync(path.join(value.root, '.git')), false);
  assert.equal(fs.existsSync(path.join(value.root, '.specplane')), false);
}));

test('package validation refuses changed docs assets and omitted dependency inventory without mutation', async () => {
  for (const role of ['orientation', 'topic', 'source', 'dependency'] as const) await fixture(async value => {
    const relative = role === 'orientation' ? value.docs.orientation.path : role === 'topic' ? value.docs.topics[0].path : value.docs.topics[0].sources[0].path;
    if (role === 'dependency') value.put('node_modules/fixture/index.js', '// omitted dependency\n');
    else value.put(`docs/${relative}`, 'tampered documentation\n');
    const result = await checkWithoutMutation(value);
    assert.equal(result.ok, false, role);
    if (!result.ok) assert.equal(result.error.code, 'INCOMPATIBLE');
  });
});

test('resealed semantic corruption refuses under both docs loading and extension compatibility', async () => {
  const edits: [string, (docs: DocumentationManifest) => void][] = [
    ['missing minimum topic', docs => { docs.topics.pop(); docs.topics.forEach(topic => { topic.related = topic.related.filter(id => docs.topics.some(candidate => candidate.id === id)); }); }],
    ['empty source references', docs => { docs.topics[0].sources = []; }],
    ['reserved topic ID', docs => { const old = docs.topics[0].id; docs.topics[0].id = 'search'; docs.topics.forEach(topic => { topic.related = topic.related.map(id => id === old ? 'search' : id); }); }],
    ['unqualified source ID', docs => { docs.topics[0].sources[0].id = 'architecture/reference-cli'; }],
    ['orientation reused as topic', docs => { docs.topics[0].path = docs.orientation.path; docs.topics[0].sha256 = docs.orientation.sha256; }],
  ];
  for (const [name, edit] of edits) await fixture(async value => {
    edit(value.docs); value.saveDocs(); value.seal();
    assert.throws(() => loadDocumentationBundle(path.join(value.root, 'docs'), versions), { code: 'DOCS_BUNDLE_INVALID' }, name);
    const result = await checkWithoutMutation(value);
    assert.equal(result.ok, false, name);
    if (!result.ok) assert.equal(result.error.code, 'INCOMPATIBLE');
  });
});

test('resealed docs version drift and instruction orientation drift refuse without mutation', async () => {
  for (const role of ['core_version', 'docs_version', 'contract_version', 'orientation'] as const) await fixture(async value => {
    if (role === 'orientation') {
      value.docs.orientation.sha256 = value.put(`docs/${value.docs.orientation.path}`, '# A changed release orientation\n');
    } else if (role === 'contract_version') value.docs.contract_version++;
    else value.docs[role] = '999.0.0';
    value.saveDocs(); value.seal();
    const result = await checkWithoutMutation(value);
    assert.equal(result.ok, false, role);
    if (!result.ok) assert.equal(result.error.code, 'INCOMPATIBLE');
  });
});
