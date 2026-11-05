import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { type ExtensionManifest, type HostSelection } from './compatibility.js';
import * as fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const info = { version: '0.1.0', protocol: 1, contractVersion: 1, docsVersion: '0.1.0' } as const;
const sha = (b: string) => createHash('sha256').update(b).digest('hex');
export async function fixture(workflow = 'plan-step', procedure = '# Contract\n\n## Procedure\n') {
  const root = await mkdtemp(path.join(tmpdir(), 'core-compat-'));
  const files = new Map<string, string>();
  const put = async (p: string, data: string) => { files.set(p, data); await mkdir(path.dirname(path.join(root, p)), { recursive: true }); await writeFile(path.join(root, p), data); return sha(data); };
  await put('core/index.js', 'runtime');
  const contract = procedure;
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
  const manifest: ExtensionManifest = { schemaVersion: 1, extension: { id: 'specplane-codex', version: info.version, host: 'codex' }, core: info, hostCompatibility: [{ surface: 'cli', minVersion: '1.0.0', maxVersionExclusive: '2.0.0', evidence: 'reports/compat.json' }], capabilities: { reasoning: true, nativeCommands: true, backgroundSessions: true }, procedures: [{ workflow, contracts: [{ id: 'base:architecture/test', anchor: 'procedure', blob, sha256: contractHash, path: 'contracts/test.md' }] }], assets: [{ path: 'core/inventory.json', sha256: coreHash, kind: 'core' }, { path: 'docs/manifest.json', sha256: docsHash, kind: 'docs' }, { path: 'reports/compat.json', sha256: reportHash, kind: 'docs' }] };
  const host: HostSelection = { packageRoot: root, extensionId: 'specplane-codex', host: 'codex', version: '1.1.0', surface: 'cli', workflow, probes: { nativeCommands: true, backgroundSessions: true } };
  const syncManifest = async (value: ExtensionManifest = manifest) => { await put('specplane-extension.json', JSON.stringify(value)); };
  await syncManifest();
  const reinventory = async () => { files.delete('core/inventory.json'); files.delete('specplane-extension.json'); const inventory = JSON.stringify({ root: '.', files: [...files].map(([path, data]) => ({ path, sha256: sha(data) })) }); manifest.assets[0].sha256 = await put('core/inventory.json', inventory); await syncManifest(); };
  return { root, manifest, host, put, reinventory, syncManifest };
}

export const id = '2026-11-03-test';
export const stepFile = `plans/${id}/steps/01-test.md`;
export function repo(extraConfig = '') {
 const cwd = fs.mkdtempSync(path.join(tmpdir(), 'prepare-workflow-'));
 const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
 const put = (p: string, text: string) => { const f = path.join(cwd,p); fs.mkdirSync(path.dirname(f),{recursive:true}); fs.writeFileSync(f,text); };
 git('init','-b','main'); git('config','user.name','Test'); git('config','user.email','test@example.com'); git('config','core.autocrlf','false');
 put('.specplane/config.yaml', 'spec_roots:\n  - name: base\n    path: specs\nplans:\n  forge: none\n  require_approved_specs: none\nexecution:\n  backend: branch\n' + extraConfig);
 put('specs/features/test.md','---\nid: feature/test\ntitle: Test\nstatus: approved\nauthor: user\n---\n# Test\n\n## Acceptance criteria\n\n- [ ] Observable feature behavior\n');
 put(`plans/${id}/PLAN.md`, `---\nid: ${id}\ntitle: Test\nstatus: ready\nspecs: [base:feature/test]\n---\n# Plan\n`);
 put(stepFile, `---\nplan: ${id}\nstep: 1\ntitle: Test\nstatus: pending\ncontext:\n  - file: source.ts\n---\n# Step\n\n## Acceptance criteria\n\n- [ ] Expected behavior\n`);
 put('source.ts','original'); git('add','.');git('commit','-m','base');const base=git('rev-parse','HEAD');git('switch','-c',`plan/${id}`);
 put(`plans/${id}/PLAN.md`, `---\nid: ${id}\ntitle: Test\nstatus: ready\nspecs: [base:feature/test]\nexecution:\n  target_branch: main\n  start_target_branch: main\n  start_base: ${base}\n---\n# Plan\n`);git('commit','-am','bind');
 return {cwd,git,put};
}
