import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { run } from '../git/exec.js';
import { GitError } from '../errors.js';
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
  return run('git', args, { cwd: root, binary: true });
}
const comparePath = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));
function canonicalPath(p: string): boolean {
  return !!p && !p.includes('\\') && !path.posix.isAbsolute(p) && !/^[A-Za-z]:/.test(p) && p.split('/').every(part => !!part && part !== '.' && part !== '..');
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
  if (!dir || /^[A-Za-z]:/.test(dir) || path.posix.isAbsolute(n) || n === '..' || n.startsWith('../')) throw new Error('plans.dir must be inside the repository');
  return n === '.' ? '' : n.replace(/\/$/, '');
}
function isPlan(file: string, dir: string): boolean {
  if (!canonicalPath(file)) return false;
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
  for (const p of [...new Set(candidates)].filter(p => isPlan(p, dir)).sort(comparePath)) {
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
  // Git can apply an untracked .gitignore even when the rule file is itself ignored.
  // Only inspect directories Git can discover, plus ancestors of tracked plans.
  const ignorePaths = new Set<string>();
  if (source === 'working') {
    const trackedPlans = index.filter(e => isPlan(e.path, dir)).map(e => e.path);
    const hasTrackedPlan = (p: string): boolean => trackedPlans.some(file => file.startsWith(`${p}/`));
    const ignored = (p: string): boolean => {
      // Git exits 1 without stderr when no path matches. A negated pattern
      // describes an included path, despite being a matching pattern.
      const args = ['check-ignore', '--no-index', '-z', '-v', '-n', '--stdin'];
      let result: string;
      try { result = run('git', args, { cwd: root, input: `${p}/\0` }); }
      catch (e) {
        const command = `git ${args.join(' ')}`;
        if (e instanceof GitError && e.message === `Git command failed: \`${command}\`: Command failed: ${command}`) return false;
        throw e;
      }
      const fields = result.split('\0');
      return !!fields[2] && !fields[2].startsWith('!');
    };
    let parent = '';
    ignorePaths.add('.gitignore');
    let discoverable = true;
    for (const part of dir.split('/').filter(Boolean)) {
      parent = parent ? `${parent}/${part}` : part;
      try { if (fs.lstatSync(path.join(root, parent)).isSymbolicLink()) throw new Error(`Symlink in snapshot path: ${parent}`); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      discoverable = discoverable && !ignored(parent);
      if (discoverable || hasTrackedPlan(parent)) ignorePaths.add(`${parent}/.gitignore`);
    }
    const walk = (rel: string, depth: number, visible: boolean): void => {
      const absolute = path.join(root, rel);
      let st: fs.Stats;
      try { st = fs.lstatSync(absolute); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
      if (st.isSymbolicLink()) throw new Error(`Symlink in snapshot path: ${rel}`);
      if (!st.isDirectory()) return;
      for (const name of fs.readdirSync(absolute)) {
        if (!rel && name === '.git') continue;
        const child = rel ? `${rel}/${name}` : name;
        const entry = fs.lstatSync(path.join(root, child));
        // Plan files are one directory down, or two below archive/.
        if (entry.isDirectory() && depth === 0) {
          const childVisible = visible && !ignored(child);
          if (childVisible || hasTrackedPlan(child)) {
            ignorePaths.add(`${child}/.gitignore`);
            if (name === 'archive') walk(child, 1, childVisible);
          }
        } else if (entry.isDirectory() && depth === 1) {
          const childVisible = visible && !ignored(child);
          if (childVisible || hasTrackedPlan(child)) ignorePaths.add(`${child}/.gitignore`);
        }
      }
    };
    if (discoverable || (dir && hasTrackedPlan(dir))) walk(dir, 0, discoverable);
  }
  const ignores = [...ignorePaths].sort(comparePath).map(p => {
    // Git does not follow symlinked .gitignore files.
    try { if (fs.lstatSync(path.join(root, p)).isSymbolicLink()) return [p, null]; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    return [p, readSafe(root, p)?.toString('base64') ?? null];
  });
  const excludePath = git(root, ['rev-parse', '--path-format=absolute', '--git-path', 'info/exclude']).toString().trim();
  const infoExclude = source === 'working' && fs.existsSync(excludePath) ? hash(fs.readFileSync(excludePath)) : null;
  let globalExclude: string | null = null;
  if (source === 'working') {
    let file = '';
    try { file = git(root, ['config', '--path', '--get', 'core.excludesFile']).toString().trim(); }
    catch { /* no configured global excludes */ }
    if (!file) file = path.join(process.env.XDG_CONFIG_HOME || path.join(process.env.HOME || '', '.config'), 'git', 'ignore');
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
  const plans = [...files].sort(([a], [b]) => comparePath(a, b)).map(([p, bytes]) => ({ path: p, bytes }));
  return { ...base, source: 'prospective', configBytes, config, warnings, plans, digest: digest(configBytes, plans), identity: `${base.identity}+${digest(configBytes, plans)}` };
}
