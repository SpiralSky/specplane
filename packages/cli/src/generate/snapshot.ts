import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { CONFIG_PATH, parseConfigText } from '../config.js';
import type { Config, Warning } from '../types.js';

export type SnapshotSource = 'head' | 'staged' | 'working';
export interface SnapshotFile { path: string; bytes: Buffer }
export interface PlanSnapshot {
  source: SnapshotSource | 'prospective'; identity: string; digest: string;
  configBytes: Buffer | null; config: Config; warnings: Warning[]; plans: SnapshotFile[];
  outputPath: string; outputUnmerged: boolean; excluded: string[]; preimage: string;
}
type Entry = { path: string; mode: string; oid: string; stage: number };
const hash = (v: string | Buffer): string => createHash('sha256').update(v).digest('hex');
function git(root: string, args: string[]): Buffer {
  return execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
}
function entries(root: string, source: 'head' | 'staged', head: string): Entry[] {
  const raw = source === 'head' ? git(root, ['ls-tree', '-rz', '--full-tree', head]) : git(root, ['ls-files', '--stage', '-z']);
  return raw.toString('utf8').split('\0').filter(Boolean).map(line => {
    const tab = line.indexOf('\t'), fields = line.slice(0, tab).split(' ');
    return source === 'head' ? { mode: fields[0], oid: fields[2], stage: 0, path: line.slice(tab + 1) }
      : { mode: fields[0], oid: fields[1], stage: Number(fields[2]), path: line.slice(tab + 1) };
  });
}
function safeDir(dir: string): string {
  const n = path.posix.normalize(dir.replaceAll('\\', '/'));
  if (!dir || path.posix.isAbsolute(n) || n === '..' || n.startsWith('../')) throw new Error('plans.dir must be inside the repository');
  return n === '.' ? '' : n.replace(/\/$/, '');
}
function isPlan(file: string, dir: string): boolean {
  const prefix = dir ? `${dir}/` : '';
  if (!file.startsWith(prefix)) return false;
  const p = file.slice(prefix.length).split('/');
  return (p.length === 2 && p[0] !== 'archive' && p[1] === 'PLAN.md') || (p.length === 3 && p[0] === 'archive' && p[2] === 'PLAN.md');
}
function readSafe(root: string, rel: string): Buffer | null {
  let current = root;
  for (const part of rel.split('/')) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Symlink in snapshot path: ${rel}`); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
  }
  try { return fs.readFileSync(current); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
}
function operation(root: string): string {
  function state(file: string): unknown {
    try {
      const s = fs.lstatSync(file);
      if (s.isDirectory()) return fs.readdirSync(file).sort().map(n => [n, state(path.join(file, n))]);
      return s.isFile() ? hash(fs.readFileSync(file)) : `mode:${s.mode}`;
    } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
  }
  return JSON.stringify(['HEAD', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'REBASE_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer'].map(n => [n, state(git(root, ['rev-parse', '--path-format=absolute', '--git-path', n]).toString().trim())]));
}
function digest(config: Buffer | null, files: SnapshotFile[]): string {
  const h = createHash('sha256');
  h.update(config === null ? 'missing\0' : `config:${config.length}\0`).update(config ?? Buffer.alloc(0));
  for (const f of files) h.update(`${Buffer.byteLength(f.path)}:${f.path}:${f.bytes.length}\0`).update(f.bytes);
  return h.digest('hex');
}
function snapshot(root: string, source: SnapshotSource): PlanSnapshot {
  if (!['head', 'staged', 'working'].includes(source)) throw new Error(`Unknown snapshot source: ${source}`);
  let head = '';
  try { head = git(root, ['rev-parse', '--verify', 'HEAD^{commit}']).toString().trim(); } catch { if (source === 'head') throw new Error('Unborn HEAD: select --source staged or --source working explicitly.'); }
  const index = entries(root, 'staged', head), selected = source === 'head' ? entries(root, 'head', head) : index;
  const unmerged = index.filter(e => e.stage !== 0).map(e => e.path);
  if (source !== 'head' && unmerged.includes(CONFIG_PATH)) throw new Error(`Unresolved config input: ${CONFIG_PATH}`);
  const readEntry = (e: Entry | undefined): Buffer | null => {
    if (!e) return null;
    if (e.mode !== '100644' && e.mode !== '100755') throw new Error(`Unsupported snapshot input mode at ${e.path}`);
    return git(root, ['cat-file', 'blob', e.oid]);
  };
  const configBytes = source === 'working' ? readSafe(root, CONFIG_PATH) : readEntry(selected.find(e => e.path === CONFIG_PATH && e.stage === 0));
  const { config, warnings } = parseConfigText(configBytes?.toString('utf8') ?? null, root, { checkSpecRoots: false, snapshot: true });
  const dir = safeDir(config.plans.dir);
  if (source !== 'head' && unmerged.some(p => isPlan(p, dir))) throw new Error('Unresolved plan input; resolve and stage plan/config inputs first.');
  const candidates = source === 'working' ? git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).toString('utf8').split('\0').filter(Boolean) : selected.filter(e => e.stage === 0).map(e => e.path);
  const plans: SnapshotFile[] = [];
  for (const p of [...new Set(candidates)].filter(p => isPlan(p, dir)).sort()) {
    const bytes = source === 'working' ? readSafe(root, p) : readEntry(selected.find(e => e.path === p && e.stage === 0));
    if (bytes !== null) plans.push({ path: p, bytes });
  }
  const outputPath = dir ? `${dir}/PLANS.md` : 'PLANS.md', output = readSafe(root, outputPath);
  const names = (args: string[]): string[] => git(root, args).toString('utf8').split('\0').filter(Boolean);
  const pending = source === 'working' ? [] : [
    ...names(['diff', '--name-only', '--no-renames', '-z']),
    ...names(['ls-files', '--others', '--exclude-standard', '-z']),
    ...(source === 'head' ? names(['diff', '--cached', '--name-only', '--no-renames', '-z']) : []),
  ];
  // Config may select different plan directories in each source; retain all
  // pending PLAN.md paths so callers can report exclusions across those paths.
  const excluded = [...new Set(pending.filter(p => p === CONFIG_PATH || p.endsWith('/PLAN.md')))].sort();
  const identity = source === 'head' ? head : hash(JSON.stringify(selected)), contentDigest = digest(configBytes, plans);
  const discovery = source === 'working' ? git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']) : Buffer.alloc(0);
  const ignores = source === 'working' ? [...new Set(discovery.toString('utf8').split('\0').filter(p => p === '.gitignore' || p.endsWith('/.gitignore')))].sort().map(p => [p, readSafe(root, p)?.toString('base64') ?? null]) : [];
  const excludePath = git(root, ['rev-parse', '--path-format=absolute', '--git-path', 'info/exclude']).toString().trim();
  const infoExclude = source === 'working' && fs.existsSync(excludePath) ? hash(fs.readFileSync(excludePath)) : null;
  let globalExclude: string | null = null;
  if (source === 'working') {
    let file = '';
    try { file = git(root, ['config', '--path', '--get', 'core.excludesFile']).toString().trim(); }
    catch { /* no configured global excludes */ }
    if (file) {
      const absolute = path.resolve(root, file);
      globalExclude = JSON.stringify([absolute, fs.existsSync(absolute) ? hash(fs.readFileSync(absolute)) : null]);
    }
  }
  const preimage = hash(JSON.stringify([head, hash(git(root, ['ls-files', '--stage', '-z'])), operation(root), output === null ? null : hash(output), contentDigest, hash(discovery), ignores, infoExclude, globalExclude]));
  return { source, identity, digest: contentDigest, configBytes, config, warnings, plans, outputPath, outputUnmerged: unmerged.includes(outputPath), excluded, preimage };
}
export function capturePlanSnapshot(root: string, source: SnapshotSource = 'head'): PlanSnapshot { return snapshot(root, source); }
/** Invoke while holding the writer lease, immediately before replacing the output. */
export function recheckPlanSnapshot(root: string, captured: PlanSnapshot): void {
  if (captured.source === 'prospective') throw new Error('Recheck the authoritative snapshot before writing prospective output.');
  if (snapshot(root, captured.source).preimage !== captured.preimage) throw new Error('Snapshot inputs, index, Git operation or output changed; retry generation.');
}
/** Construct an in-memory authoritative-head overlay; edits are explicit repository paths. */
export function prospectivePlanSnapshot(root: string, base: PlanSnapshot, edits: ReadonlyMap<string, Buffer | null>): PlanSnapshot {
  if (base.source !== 'head') throw new Error('Prospective snapshot requires captured authoritative HEAD.');
  const configBytes = edits.has(CONFIG_PATH) ? edits.get(CONFIG_PATH)! : base.configBytes;
  const { config, warnings } = parseConfigText(configBytes?.toString('utf8') ?? null, root, { checkSpecRoots: false, snapshot: true });
  const dir = safeDir(config.plans.dir);
  if (dir !== safeDir(base.config.plans.dir)) throw new Error('Prospective config changes to plans.dir require a full authoritative tree capture.');
  const files = new Map(base.plans.map(f => [f.path, f.bytes]));
  for (const [p, bytes] of edits) {
    if (p === CONFIG_PATH) continue;
    if (!isPlan(p, dir)) throw new Error(`Unauthorized prospective input: ${p}`);
    if (bytes === null) files.delete(p); else files.set(p, bytes);
  }
  const plans = [...files].sort(([a], [b]) => a.localeCompare(b)).map(([p, bytes]) => ({ path: p, bytes }));
  return { ...base, source: 'prospective', configBytes, config, warnings, plans, digest: digest(configBytes, plans), identity: `${base.identity}+${digest(configBytes, plans)}` };
}
