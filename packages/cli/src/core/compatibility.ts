import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { lazyValidator } from '../lazy-validator.js';
import { hasAnchor } from '../spec/slug.js';
import { manifestSchema } from './schemas.js';
import type { Result } from './contracts.js';

export interface ExtensionManifest {
  schemaVersion: 1;
  extension: { id: string; version: string; host: string };
  core: { version: string; protocol: 1; contractVersion: number; docsVersion: string };
  hostCompatibility: { surface: string; minVersion: string; maxVersionExclusive: string; evidence: string }[];
  capabilities: { reasoning: boolean; nativeCommands: boolean; backgroundSessions: boolean };
  procedures: { workflow: string; contracts: { id: string; anchor: string; blob: string; sha256: string; path: string }[] }[];
  assets: { path: string; sha256: string; kind: 'core'|'reasoning'|'hook'|'instructions'|'docs'|'contract' }[];
}
export interface HostSelection {
  packageRoot: string; extensionId: string; host: string; version?: string; surface: string;
  probes: { nativeCommands: boolean; backgroundSessions: boolean };
  workflow: string;
}
export interface BuildInfo { readonly version: string; readonly protocol: 1; readonly contractVersion: number; readonly docsVersion: string }
export interface Capabilities { reasoning: boolean; nativeCommands: boolean; backgroundSessions: boolean }
const validManifest = lazyValidator(manifestSchema, { allErrors: true });
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const isHash = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
function compare(a: string, b: string): number {
  const x = a.split('.').map(BigInt), y = b.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) { if (x[i] < y[i]) return -1; if (x[i] > y[i]) return 1; }
  return 0;
}
function fail(message: string): never { throw new Error(message); }
async function contained(root: string, relative: string): Promise<Uint8Array> {
  if (!relative || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some((c) => !c || c === '.' || c === '..')) fail(`Invalid package path: ${relative}`);
  let current = root;
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) fail('Package root is not a regular directory');
  const components = relative.split('/');
  for (const [i, part] of components.entries()) {
    current = path.join(current, part);
    const entry = await lstat(current);
    if (entry.isSymbolicLink() || (i === components.length - 1 ? !entry.isFile() : !entry.isDirectory())) fail(`Invalid package component: ${relative}`);
  }
  return readFile(current);
}
async function verified(root: string, relative: string, expected: string): Promise<Uint8Array> {
  const bytes = await contained(root, relative);
  if (hash(bytes) !== expected) fail(`Invalid asset digest: ${relative}`);
  return bytes;
}
async function inventoryPaths(root: string, dir: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
    const name = dir === '.' ? entry.name : `${dir}/${entry.name}`;
    if (entry.isSymbolicLink()) fail(`Link in core inventory: ${name}`);
    if (entry.isDirectory()) result.push(...await inventoryPaths(root, name));
    else if (entry.isFile()) result.push(name);
    else fail(`Nonregular core inventory entry: ${name}`);
  }
  return result;
}
function json(bytes: Uint8Array): unknown { return JSON.parse(Buffer.from(bytes).toString('utf8')); }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!record(value) || Object.keys(value).some(k => !keys.includes(k)) || keys.some(k => !(k in value))) fail('Invalid closed package metadata');
}
/** Validates package inputs without mutating the package or host. */
export async function validateCompatibility(manifest: unknown, host: HostSelection, info: BuildInfo): Promise<Result<Capabilities>> {
  try {
    if (!validManifest(manifest)) fail('Invalid extension manifest');
    exact(host, ['packageRoot', 'extensionId', 'host', 'version', 'surface', 'probes', 'workflow'].filter(k => k !== 'version' || Object.hasOwn(host, 'version')));
    exact(host.probes, ['nativeCommands', 'backgroundSessions']);
    if ([host.packageRoot, host.extensionId, host.host, host.surface, host.workflow].some(x => typeof x !== 'string' || !x) || typeof host.probes.nativeCommands !== 'boolean' || typeof host.probes.backgroundSessions !== 'boolean' || (host.version !== undefined && typeof host.version !== 'string')) fail('Invalid host selection');
    const m = manifest as unknown as ExtensionManifest;
    if (m.extension.id !== host.extensionId || m.extension.host !== host.host) fail('Extension host identity mismatch');
    if (m.core.version !== info.version || m.core.docsVersion !== info.docsVersion || m.core.protocol !== info.protocol || m.core.contractVersion !== info.contractVersion) fail(`Core version mismatch; upgrade ${m.extension.id}`);
    if (!path.isAbsolute(host.packageRoot) || await realpath(host.packageRoot) !== path.resolve(host.packageRoot)) fail('Package root must be an absolute non-link path');
    // The manifest hashes this inventory, so it is checked independently rather than included in its own digest graph.
    const diskManifest = json(await contained(host.packageRoot, 'specplane-extension.json'));
    if (!isDeepStrictEqual(diskManifest, manifest)) fail('On-disk extension manifest does not match supplied manifest');
    const seen = new Set<string>();
    for (const asset of m.assets) {
      if (seen.has(asset.path)) fail(`Duplicate asset: ${asset.path}`);
      seen.add(asset.path);
      await verified(host.packageRoot, asset.path, asset.sha256);
    }
    const core = m.assets.filter(a => a.kind === 'core');
    const docs = m.assets.filter(a => a.kind === 'docs' && a.path.endsWith('/manifest.json'));
    if (core.length !== 1 || docs.length !== 1) fail('Missing core inventory or documentation manifest');
    const inventory = json(await verified(host.packageRoot, core[0].path, core[0].sha256));
    exact(inventory, ['root', 'files']);
    if (inventory.root !== '.') fail('Build inventory must cover the entire package');
    if (!Array.isArray(inventory.files) || inventory.files.length === 0) fail('Empty build inventory');
    const files = new Set<string>();
    for (const entry of inventory.files) {
      exact(entry, ['path', 'sha256']);
      if (typeof entry.path !== 'string' || !isHash(entry.sha256) || files.has(entry.path)) fail('Invalid build inventory entry');
      if (entry.path === core[0].path || entry.path === 'specplane-extension.json') fail('Build inventory cannot include self-referential metadata');
      files.add(entry.path);
      await verified(host.packageRoot, entry.path, entry.sha256);
    }
    const actualFiles = (await inventoryPaths(host.packageRoot, inventory.root)).filter(name => name !== core[0].path && name !== 'specplane-extension.json');
    if (actualFiles.length !== files.size || actualFiles.some(name => !files.has(name))) fail('Incomplete build inventory');
    const applicable = m.procedures.filter(p => p.workflow === host.workflow);
    if (!applicable.length) fail('No applicable procedure');
    for (const procedure of m.procedures) for (const contract of procedure.contracts) {
      if (!/^[^:]+:(?:architecture|feature)\//.test(contract.id)) fail('Procedure contract ID must be root-qualified');
      const bytes = await verified(host.packageRoot, contract.path, contract.sha256);
      const gitBlob = createHash(contract.blob.length === 40 ? 'sha1' : 'sha256').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      if (gitBlob !== contract.blob) fail(`Invalid contract blob: ${contract.path}`);
      if (!hasAnchor(Buffer.from(bytes).toString('utf8'), contract.anchor)) fail(`Missing procedure heading: ${contract.path}#${contract.anchor}`);
    }
    // Documentation metadata has its own closed format and paths relative to its bundle.
    const docsAsset = docs[0];
    const bundlePath = path.posix.dirname(docsAsset.path);
    const document = json(await verified(host.packageRoot, docsAsset.path, docsAsset.sha256));
    exact(document, ['format_version', 'core_version', 'docs_version', 'contract_version', 'orientation', 'topics']);
    if (document.format_version !== 1 || document.core_version !== info.version || document.docs_version !== info.docsVersion || document.contract_version !== info.contractVersion) fail('Documentation version mismatch');
    const verifyDocFile = async (entry: unknown) => {
      exact(entry, ['path', 'sha256']);
      if (typeof entry.path !== 'string' || !isHash(entry.sha256)) fail('Invalid documentation asset');
      await verified(host.packageRoot, `${bundlePath}/${entry.path}`, entry.sha256);
    };
    await verifyDocFile(document.orientation);
    const orientation = document.orientation as Record<string, unknown>;
    for (const instruction of m.assets.filter(a => a.kind === 'instructions')) {
      const content = Buffer.from(await verified(host.packageRoot, instruction.path, instruction.sha256)).toString('utf8');
      const metadata = content.match(/<!-- specplane-orientation: (\{[^\n]*\}) -->/);
      if (!metadata) fail('Missing managed instruction orientation metadata');
      const fields: unknown = JSON.parse(metadata[1]);
      exact(fields, ['docs_version', 'contract_version', 'sha256']);
      if (fields.docs_version !== info.docsVersion || fields.contract_version !== info.contractVersion || fields.sha256 !== orientation.sha256) fail('Managed instruction orientation metadata mismatch');
    }

    if (!Array.isArray(document.topics) || !document.topics.length) fail('Empty documentation index');
    const ids = new Set<string>(), paths = new Set<string>();
    for (const topic of document.topics) {
      exact(topic, ['id', 'title', 'path', 'sha256', 'related', 'sources']);
      if (typeof topic.id !== 'string' || !topic.id || ids.has(topic.id) || typeof topic.title !== 'string' || !topic.title || typeof topic.path !== 'string' || paths.has(topic.path) || !isHash(topic.sha256) || !Array.isArray(topic.related) || !Array.isArray(topic.sources)) fail('Invalid documentation topic');
      ids.add(topic.id); paths.add(topic.path);
      await verified(host.packageRoot, `${bundlePath}/${topic.path}`, topic.sha256);
      for (const source of topic.sources) {
        if (!record(source) || !Object.keys(source).every(k => ['id', 'anchor', 'path', 'sha256'].includes(k)) || typeof source.id !== 'string' || typeof source.path !== 'string' || !isHash(source.sha256) || (source.anchor !== undefined && typeof source.anchor !== 'string')) fail('Invalid documentation source');
        await verified(host.packageRoot, `${bundlePath}/${source.path}`, source.sha256);
      }
    }
    for (const topic of document.topics) {
      if (!record(topic) || !Array.isArray(topic.related) || topic.related.some(id => typeof id !== 'string' || !ids.has(id))) fail('Invalid related topic');
    }
    const reports = new Map<string, { version: string; apis: string[] }>();
    for (const entry of m.hostCompatibility) {
      if (compare(entry.minVersion, entry.maxVersionExclusive) >= 0) fail('Invalid host version interval');
      const evidence = m.assets.find(asset => asset.path === entry.evidence);
      if (!evidence) fail('Compatibility report is not a hashed asset');
      const report = json(await verified(host.packageRoot, evidence.path, evidence.sha256));
      exact(report, ['host', 'version', 'build', 'surface', 'apis', 'results', 'date']);
      if (report.host !== m.extension.host || report.surface !== entry.surface || typeof report.version !== 'string' || !stableVersion.test(report.version) || compare(report.version, entry.minVersion) < 0 || compare(report.version, entry.maxVersionExclusive) >= 0 || typeof report.build !== 'string' || !report.build || !Array.isArray(report.apis) || !report.apis.length || report.apis.some(x => typeof x !== 'string' || !x) || !Array.isArray(report.results) || !report.results.length || typeof report.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(report.date) || Number.isNaN(Date.parse(report.date))) fail('Invalid compatibility report');
      reports.set(entry.evidence, { version: report.version as string, apis: report.apis as string[] });
      for (const result of report.results) {
        exact(result, ['name', 'passed']);
        if (typeof result.name !== 'string' || !result.name || result.passed !== true) fail('Unsuccessful compatibility report');
      }
    }
    const known = typeof host.version === 'string' && stableVersion.test(host.version);
    const matched = known ? m.hostCompatibility.filter(e => e.surface === host.surface && compare(host.version!, e.minVersion) >= 0 && compare(host.version!, e.maxVersionExclusive) < 0) : [];
    const supports = (capability: string) => matched.some(e => reports.get(e.evidence)?.apis.includes(capability));
    const notices = matched.length ? [] : [{ code: 'UNVERIFIED_SURFACE', message: 'Host surface/version is not verified; native and background capabilities are disabled.' }];
    return { protocol: 1, ok: true, value: { reasoning: m.capabilities.reasoning, nativeCommands: supports('nativeCommands') && m.capabilities.nativeCommands && host.probes.nativeCommands, backgroundSessions: supports('backgroundSessions') && m.capabilities.backgroundSessions && host.probes.backgroundSessions }, notices };
  } catch (error) {
    return { protocol: 1, ok: false, error: { code: 'INCOMPATIBLE', message: error instanceof Error ? error.message : 'Package validation failed', retryable: false, details: null }, notices: [] };
  }
}
