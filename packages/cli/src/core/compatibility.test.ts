import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateCompatibility, type ExtensionManifest, type HostSelection } from './compatibility.js';
const info = { version: '0.1.0', protocol: 1, contractVersion: 1, docsVersion: '0.1.0' } as const;
const sha = (b: string) => createHash('sha256').update(b).digest('hex');
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'core-compat-'));
  const files = new Map<string, string>();
  const put = async (p: string, data: string) => { files.set(p, data); await mkdir(path.dirname(path.join(root, p)), { recursive: true }); await writeFile(path.join(root, p), data); return sha(data); };
  await put('core/index.js', 'runtime');
  const contract = '# Contract\n\n## Procedure\n';
  const contractHash = await put('contracts/test.md', contract);
  const blob = createHash('sha1').update(`blob ${Buffer.byteLength(contract)}\0`).update(contract).digest('hex');
  const orientationHash = await put('docs/orientation.md', 'orientation');
  const topics = await Promise.all(['getting-started', 'concepts', 'completion', 'workflows/plans', 'commands/spec-complete'].map(async id => ({ id, title: id, path: `topics/${id}.md`, sha256: await put(`docs/topics/${id}.md`, `# ${id}\n`), related: [] as string[], sources: [] as { id: string; path: string; sha256: string }[] })));
  const sourceHash = await put('docs/source.md', 'source');
  const docs = JSON.stringify({ format_version: 1, core_version: info.version, docs_version: info.docsVersion, contract_version: 1, orientation: { path: 'orientation.md', sha256: orientationHash }, topics: topics.map(topic => ({ ...topic, sources: [{ id: 'base:feature/test', path: 'source.md', sha256: sourceHash }] })) });
  const docsHash = await put('docs/manifest.json', docs);
  const report = JSON.stringify({ host: 'codex', version: '1.1.0', build: 'test', surface: 'cli', apis: ['nativeCommands', 'backgroundSessions'], results: [{ name: 'dispatch', passed: true }], date: '2026-01-01' });
  const reportHash = await put('reports/compat.json', report);
  const inventory = JSON.stringify({ root: '.', files: [...files].map(([path, data]) => ({ path, sha256: sha(data) })) });
  const coreHash = await put('core/inventory.json', inventory);
  const manifest: ExtensionManifest = { schemaVersion: 1, extension: { id: 'specplane-codex', version: info.version, host: 'codex' }, core: info, hostCompatibility: [{ surface: 'cli', minVersion: '1.0.0', maxVersionExclusive: '2.0.0', evidence: 'reports/compat.json' }], capabilities: { reasoning: true, nativeCommands: true, backgroundSessions: true }, procedures: [{ workflow: 'plan-step', contracts: [{ id: 'base:architecture/test', anchor: 'procedure', blob, sha256: contractHash, path: 'contracts/test.md' }] }], assets: [{ path: 'core/inventory.json', sha256: coreHash, kind: 'core' }, { path: 'docs/manifest.json', sha256: docsHash, kind: 'docs' }, { path: 'reports/compat.json', sha256: reportHash, kind: 'docs' }] };
  const host: HostSelection = { packageRoot: root, extensionId: 'specplane-codex', host: 'codex', version: '1.1.0', surface: 'cli', workflow: 'plan-step', probes: { nativeCommands: true, backgroundSessions: true } };
  const syncManifest = async (value: ExtensionManifest = manifest) => { await put('specplane-extension.json', JSON.stringify(value)); };
  await syncManifest();
  const reinventory = async () => { files.delete('core/inventory.json'); files.delete('specplane-extension.json'); const inventory = JSON.stringify({ root: '.', files: [...files].map(([path, data]) => ({ path, sha256: sha(data) })) }); manifest.assets[0].sha256 = await put('core/inventory.json', inventory); await syncManifest(); };
  return { root, manifest, host, put, reinventory, syncManifest };
}
test('verified matrix enables probed capabilities; unknown host disables them', async () => {
  const { manifest, host } = await fixture();
  const good = await validateCompatibility(manifest, host, info); assert.equal(good.ok, true);
  if (good.ok) assert.deepEqual(good.value, { reasoning: true, nativeCommands: true, backgroundSessions: true });
  const unknown = await validateCompatibility(manifest, { ...host, version: undefined }, info); assert.equal(unknown.ok, true);
  if (unknown.ok) { assert.equal(unknown.value.nativeCommands, false); assert.equal(unknown.value.backgroundSessions, false); assert.equal(unknown.notices[0].code, 'UNVERIFIED_SURFACE'); }
});
test('unknown fields, protocol changes, corrupt bytes, omitted runtime and bad blobs refuse', async () => {
  const { manifest, host, put, syncManifest } = await fixture();
  assert.equal((await validateCompatibility({ ...manifest, extra: true }, host, info)).ok, false);
  assert.equal((await validateCompatibility({ ...manifest, schemaVersion: 2 }, host, info)).ok, false);
  const badBlob = structuredClone(manifest); badBlob.procedures[0].contracts[0].blob = '0'.repeat(40); await syncManifest(badBlob);
  assert.equal((await validateCompatibility(badBlob, host, info)).ok, false);
  await syncManifest(); await put('core/unlisted.js', 'unlisted'); assert.equal((await validateCompatibility(manifest, host, info)).ok, false);
  const second = await fixture(); await second.put('docs/orientation.md', 'corrupt'); assert.equal((await validateCompatibility(second.manifest, second.host, info)).ok, false);
});
test('unsigned, malformed and failing report cannot enable host capabilities', async () => {
  const { manifest, host, put, reinventory, syncManifest } = await fixture();
  const noAsset = structuredClone(manifest); noAsset.assets.pop(); await syncManifest(noAsset); assert.equal((await validateCompatibility(noAsset, host, info)).ok, false);
  await syncManifest();
  const malformed = '{"foo":true}'; await put('reports/compat.json', malformed); manifest.assets[2].sha256 = sha(malformed); await reinventory();
  assert.equal((await validateCompatibility(manifest, host, info)).ok, false);
  const failed = JSON.stringify({ host: 'codex', version: '1.1.0', build: 'x', surface: 'cli', apis: ['nativeCommands'], results: [{ name: 'test', passed: false }], date: '2026-01-01' });
  await put('reports/compat.json', failed); manifest.assets[2].sha256 = sha(failed); await reinventory();
  assert.equal((await validateCompatibility(manifest, host, info)).ok, false);
});

test('host input and all procedure references are validated and certified intervals use probes', async () => {
  const { manifest, host, syncManifest } = await fixture();
  assert.equal((await validateCompatibility(manifest, { ...host, probes: { nativeCommands: 'yes', backgroundSessions: true } } as unknown as HostSelection, info)).ok, false);
  const unused = structuredClone(manifest); unused.procedures.push({ workflow: 'other', contracts: [{ ...unused.procedures[0].contracts[0], blob: '0'.repeat(40) }] }); await syncManifest(unused);
  assert.equal((await validateCompatibility(unused, host, info)).ok, false);
  await syncManifest();
  const newer = await validateCompatibility(manifest, { ...host, version: '1.2.0' }, info);
  assert.equal(newer.ok, true); if (newer.ok) assert.equal(newer.value.nativeCommands, true);
});
test('instruction orientation metadata is bound to the documentation release', async () => {
  const { manifest, host, put, reinventory } = await fixture();
  const orientation = manifest.assets.find(a => a.path === 'docs/manifest.json')!;
  assert.ok(orientation);
  const correct = `<!-- specplane-orientation: ${JSON.stringify({ docs_version: info.docsVersion, contract_version: info.contractVersion, sha256: sha('orientation') })} -->`;
  manifest.assets.push({ path: 'instruction.md', sha256: await put('instruction.md', correct), kind: 'instructions' }); await reinventory();
  assert.equal((await validateCompatibility(manifest, host, info)).ok, true);
  const wrong = `<!-- specplane-orientation: ${JSON.stringify({ docs_version: '9.0.0', contract_version: 1, sha256: sha('orientation') })} -->`;
  manifest.assets[3].sha256 = await put('instruction.md', wrong); await reinventory();
  assert.equal((await validateCompatibility(manifest, host, info)).ok, false);
});
