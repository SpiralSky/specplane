import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { coreInfo } from '../core/build-info.js';
import { validateCompatibility } from '../core/compatibility.js';
import { buildExtensionPackage, type PackageBuildOptions } from './package-builder.js';

const docsDir = fileURLToPath(new URL('../../assets/docs/', import.meta.url));
const SOURCE = 'base:architecture/reference-cli';
const ANCHOR = 'Compatibility manifest and package delivery';

function withTmp(action: (tmp: string, options: PackageBuildOptions) => Promise<void>) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'specplane-builder-'));
  const src = path.join(tmp, 'src');
  fs.mkdirSync(path.join(src, 'runtime/node_modules/dep'), { recursive: true });
  fs.writeFileSync(path.join(src, 'runtime/index.js'), '// runtime\n');
  fs.writeFileSync(path.join(src, 'runtime/node_modules/dep/index.js'), '// dependency\n');
  fs.writeFileSync(path.join(src, 'instructions.md'), 'Use Specplane.\n');
  fs.writeFileSync(path.join(src, 'skill.md'), 'reasoning\n');
  const options: PackageBuildOptions = {
    outDir: path.join(tmp, 'out'), extension: { id: 'specplane-codex', host: 'codex' },
    capabilities: { reasoning: true, nativeCommands: false, backgroundSessions: false },
    docsDir, runtime: [{ from: path.join(src, 'runtime'), to: 'core/runtime' }],
    assets: [{ from: path.join(src, 'skill.md'), to: 'skills/plan-step.md', kind: 'reasoning' }],
    instructions: { from: path.join(src, 'instructions.md'), to: 'instructions.md' },
    procedures: [{ workflow: 'plan-step', contracts: [{ sourceId: SOURCE, anchor: ANCHOR }] }],
  };
  return action(tmp, options).finally(() => fs.rmSync(tmp, { recursive: true, force: true }));
}
const host = (root: string) => ({ packageRoot: fs.realpathSync(root), extensionId: 'specplane-codex', host: 'codex', surface: 's', workflow: 'plan-step', probes: { nativeCommands: true, backgroundSessions: true } });

test('builder covers runtime, dependency, docs, procedure and instruction assets and the result validates', () => withTmp(async (_tmp, options) => {
  const manifest = await buildExtensionPackage(options);
  const inventory = JSON.parse(fs.readFileSync(path.join(options.outDir, 'core/inventory.json'), 'utf8'));
  const listed = inventory.files.map((entry: { path: string }) => entry.path);
  assert.ok(listed.includes('core/runtime/index.js') && listed.includes('core/runtime/node_modules/dep/index.js'));
  assert.ok(listed.includes('docs/manifest.json') && listed.includes('skills/plan-step.md'));
  assert.deepEqual(manifest.hostCompatibility, [], 'builder certifies no host and records no pin');
  assert.equal(manifest.procedures[0].contracts[0].id, SOURCE);
  assert.ok(manifest.assets.some(asset => asset.kind === 'instructions'));
  const result = await validateCompatibility(manifest, host(options.outDir), coreInfo);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (result.ok) assert.deepEqual(result.value, { reasoning: true, nativeCommands: false, backgroundSessions: false });
}));

test('builder refuses unresolved procedures, missing headings, non-empty output and links without leaving a package', async () => {
  const cases: [string, (options: PackageBuildOptions, tmp: string) => void][] = [
    ['unresolved contract', o => { o.procedures[0].contracts[0].sourceId = 'base:architecture/missing'; }],
    ['missing heading', o => { o.procedures[0].contracts[0].anchor = 'No such heading'; }],
    ['no procedures', o => { o.procedures = []; }],
    ['non-empty outDir', o => { fs.mkdirSync(o.outDir); fs.writeFileSync(path.join(o.outDir, 'keep'), 'x'); }],
    ['link input', (o, tmp) => { fs.symlinkSync(path.join(tmp, 'src/skill.md'), path.join(tmp, 'src/link.md')); o.assets![0].from = path.join(tmp, 'src/link.md'); }],
    ['traversal path', o => { o.runtime[0].to = '../escape'; }],
  ];
  for (const [name, edit] of cases) await withTmp(async (tmp, options) => {
    edit(options, tmp);
    await assert.rejects(buildExtensionPackage(options), /Package build refused/, name);
    if (name === 'non-empty outDir') assert.deepEqual(fs.readdirSync(options.outDir), ['keep']);
    else assert.equal(fs.existsSync(options.outDir), false, name);
    assert.equal(fs.existsSync(path.join(tmp, 'escape')), false);
  });
});

test('builder output refuses after tampering and does not write outside outDir', () => withTmp(async (tmp, options) => {
  const manifest = await buildExtensionPackage(options);
  assert.deepEqual(fs.readdirSync(tmp).sort(), ['out', 'src']);
  fs.appendFileSync(path.join(options.outDir, 'core/runtime/node_modules/dep/index.js'), '// tampered\n');
  const result = await validateCompatibility(manifest, host(options.outDir), coreInfo);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'INCOMPATIBLE');
}));
