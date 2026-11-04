import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { InstallTransaction } from '../harness/containment.transaction.js';
import { blockHash, checkStanding, findBlock, upsertBlock, type ReleaseIdentity } from '../agents/standing.js';
import { assertInstallDestination, writeInstallFile } from '../harness/containment.js';
import { HARNESSES, templatesDir, type Harness } from '../harness/index.js';
import { loadReleasedDocs } from './operations.js';

/**
 * Freshness of Specplane-owned guidance (`architecture/agent-skills` § Shared documentation and completion guidance).
 * `checkGuidance` is read-only: no writes, no network. `refreshGuidance` is the only writer and is always explicit.
 */
export type GuidanceState = 'current' | 'stale' | 'missing' | 'malformed';
export interface GuidanceAsset { path: string; kind: 'standing-block' | 'harness-guidance'; state: GuidanceState; reasons: string[] }
export interface GuidanceOptions { registry?: Harness[]; bundleDirectory?: string }

const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const read = (file: string): string | null => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);

/** Release identity from the hash-verified bundle manifest. Throws `DocumentationBundleError` if the package is damaged. */
export function releaseIdentity(bundleDirectory?: string): ReleaseIdentity {
  const { manifest } = loadReleasedDocs(bundleDirectory);
  return { docs: manifest.docs_version, contract: manifest.contract_version };
}

/** Why the managed block in `content` is stale for this release; empty when current. */
export function standingBlockReasons(content: string | null, release: ReleaseIdentity, registry: Harness[] = HARNESSES): { state: GuidanceState; reasons: string[] } {
  const states = [checkStanding(content)];
  if (states[0] === 'missing') return { state: 'missing', reasons: ['managed block absent'] };
  if (states[0] === 'malformed') return { state: 'malformed', reasons: ['unbalanced or repeated begin/end markers'] };
  const reasons: string[] = [];
  if (!states.includes('ok')) reasons.push('managed text differs from the released text');
  const info = findBlock(content!);
  if (info !== null && info !== 'malformed' && info.meta) {
    if (info.meta.docs !== release.docs) reasons.push(`docs version ${info.meta.docs} is not the released ${release.docs}`);
    if (info.meta.contract !== release.contract) reasons.push(`contract version ${info.meta.contract} is not the released ${release.contract}`);
    if (info.meta.sha256 !== blockHash(info.text)) reasons.push('recorded hash does not match the block text (edited inside the managed block)');
  }
  return { state: reasons.length ? 'stale' : 'current', reasons };
}

function harnessAsset(root: string, h: Harness): GuidanceAsset {
  const file = path.join(root, h.rulesFile);
  const expected = fs.readFileSync(path.join(templatesDir(h.name), h.rulesTemplate!));
  if (!fs.existsSync(file)) return { path: h.rulesFile, kind: 'harness-guidance', state: 'missing', reasons: ['file absent'] };
  const actual = fs.readFileSync(file);
  if (actual.equals(expected)) return { path: h.rulesFile, kind: 'harness-guidance', state: 'current', reasons: [] };
  return { path: h.rulesFile, kind: 'harness-guidance', state: 'stale', reasons: [`sha256 ${sha256(actual)} differs from released ${sha256(expected)}`] };
}

/** Version and hash checks over owned guidance. Reads only; never writes, never fetches. */
export function checkGuidance(root: string, options: GuidanceOptions = {}): GuidanceAsset[] {
  const registry = options.registry ?? HARNESSES;
  const release = releaseIdentity(options.bundleDirectory);
  const block = standingBlockReasons(read(path.join(root, 'AGENTS.md')), release, registry);
  const assets: GuidanceAsset[] = [{ path: 'AGENTS.md', kind: 'standing-block', ...block }];
  for (const h of registry) if (h.rulesTemplate && h.detect(root)) assets.push(harnessAsset(root, h));
  return assets;
}

export type RefreshAction = 'created' | 'updated' | 'unchanged' | 'preserved';
export interface RefreshEntry { path: string; action: RefreshAction; detail: string }
export interface RefreshOptions extends GuidanceOptions {
  /** Report what would change without writing. */
  dryRun?: boolean;
  /**
   * SHA-256 digests of earlier released templates, keyed by repo-relative path. A differing file is replaced only when
   * its digest is listed here; anything else is customised or unrecognised and is preserved.
   */
  recognized?: Record<string, string[]>;
  /** Stage the writes in this open installation transaction (the caller commits) instead of writing directly. */
  transaction?: InstallTransaction;
}

/**
 * Explicit refresh from the reviewed release assets (harness templates and the verified docs manifest). Rewrites only
 * the managed block in `AGENTS.md` and recognised, unmodified harness guidance files; text outside the block and
 * customised files are preserved. Every destination is checked before the first write.
 */
export function refreshGuidance(root: string, options: RefreshOptions = {}): RefreshEntry[] {
  const registry = options.registry ?? HARNESSES;
  const release = releaseIdentity(options.bundleDirectory);
  const agents = path.join(root, 'AGENTS.md');
  const targets = registry.filter(h => h.rulesTemplate && h.detect(root));
  for (const destination of [agents, ...targets.map(h => path.join(root, h.rulesFile))]) assertInstallDestination(root, destination);

  const entries: RefreshEntry[] = [];
  const writes: [string, string | Buffer][] = [];
  const block = upsertBlock(read(agents), release);
  if (block.action === 'malformed') entries.push({ path: 'AGENTS.md', action: 'preserved', detail: 'malformed Specplane markers; fix the begin/end markers by hand' });
  else if (block.action === 'unchanged') entries.push({ path: 'AGENTS.md', action: 'unchanged', detail: 'managed block is current' });
  else {
    writes.push([agents, block.content]);
    entries.push({ path: 'AGENTS.md', action: block.action === 'updated' ? 'updated' : 'created', detail: block.action === 'appended' ? 'managed block appended; existing text kept' : 'managed block refreshed; text outside it kept' });
  }
  for (const h of targets) {
    const template = fs.readFileSync(path.join(templatesDir(h.name), h.rulesTemplate!));
    const file = path.join(root, h.rulesFile);
    if (!fs.existsSync(file)) {
      writes.push([file, template]);
      entries.push({ path: h.rulesFile, action: 'created', detail: 'released template installed' });
      continue;
    }
    const actual = fs.readFileSync(file);
    if (actual.equals(template)) entries.push({ path: h.rulesFile, action: 'unchanged', detail: 'matches the released template' });
    else if (options.recognized?.[h.rulesFile]?.includes(sha256(actual))) {
      writes.push([file, template]);
      entries.push({ path: h.rulesFile, action: 'updated', detail: 'recognised earlier release replaced' });
    } else entries.push({ path: h.rulesFile, action: 'preserved', detail: 'customised or unrecognised file kept; compare with the bundled template' });
  }
  if (!options.dryRun) {
    for (const [file, content] of writes) {
      if (options.transaction) options.transaction.stage(file, content, { owned: file !== agents });
      else writeInstallFile(root, file, content);
    }
  }
  return entries;
}
