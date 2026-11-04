import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { assertInstallDestination, InstallationPathError } from './containment.js';

/**
 * Journaled installation transaction (`architecture/reference-cli` § Explicit upgrade transaction).
 *
 * Writers stage whole files; nothing is mutated until `commit()`. Commit holds a repository installation lock,
 * rechecks every preimage and the containment of every destination, copies backups and writes a recovery journal
 * under private Git coordination data, then replaces files by rename (a rename never follows a link at the final
 * component). Opening a transaction first reconciles any journal left by an interrupted run.
 *
 * Limits: writers are cooperative. A parent directory swapped for a link inside the window between the final
 * containment recheck and the rename is narrowed, not eliminated, because Node has no openat().
 */

export class InstallationConflictError extends InstallationPathError {}
export class InstallationLockError extends InstallationPathError {}

/** Thrown by test hooks to model process death: no rollback and no lock release happen. */
export class SimulatedCrash extends Error {}

/** Points at which `testHooks.interrupt` is called: prepared, before-apply:<i>, after-apply:<i>, committed. */
export const testHooks: { interrupt?: (point: string) => void } = {};

const ABSENT = 'absent';
const held = new Set<string>();
const sha = (data: Uint8Array): string => crypto.createHash('sha256').update(data).digest('hex');

interface Entry {
  path: string; // repo-relative POSIX
  pre: string; // digest or 'absent'
  preMode: number | null;
  post: string;
  mode: number | null;
  backup: string | null; // file name under backup dir
  temp: string; // repo-relative temporary sibling
  state: 'pending' | 'applied';
}
interface Journal {
  version: 1;
  token: string;
  phase: 'applying' | 'committed';
  entries: Entry[];
  dirs: string[]; // directories this transaction created, repo-relative
  ledger: Record<string, string>;
}
interface Staged { content: Buffer; mode: number | null; owned: boolean; pre: string; preMode: number | null }

export interface InstallPaths { dir: string; lock: string; journal: string; backups: string; ledger: string }

/** Private coordination directory: the checkout's own git dir; a hashed temp location for a non-git directory. */
export function installPaths(root: string): InstallPaths {
  const real = fs.realpathSync(root);
  let base: string | null = null;
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: real, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
    if (fs.realpathSync(top) === real) {
      base = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: real, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
    }
  } catch { /* not a git checkout */ }
  base ??= path.join(os.tmpdir(), `specplane-install-${sha(Buffer.from(real)).slice(0, 16)}`);
  const dir = path.join(base, 'specplane-runtime', 'install');
  return { dir, lock: path.join(dir, 'lock'), journal: path.join(dir, 'journal.json'), backups: path.join(dir, 'backup'), ledger: path.join(dir, 'ownership.json') };
}

const rel = (root: string, abs: string): string => path.relative(path.resolve(root), path.resolve(abs)).split(path.sep).join('/');
const abs = (root: string, r: string): string => path.join(path.resolve(root), ...r.split('/'));

function digestOf(file: string): string {
  let st: fs.Stats;
  try { st = fs.lstatSync(file); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return ABSENT; throw e; }
  if (!st.isFile()) return `unsafe:${st.isSymbolicLink() ? 'link' : 'type'}`;
  return sha(fs.readFileSync(file));
}

function atomicJson(file: string, value: unknown): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}

function readLedger(paths: InstallPaths): Record<string, string> {
  try {
    const v = JSON.parse(fs.readFileSync(paths.ledger, 'utf8')) as { files?: Record<string, string> };
    return v.files && typeof v.files === 'object' ? v.files : {};
  } catch { return {}; }
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

function acquireLock(paths: InstallPaths, token: string): void {
  fs.mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const fd = fs.openSync(paths.lock, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
      try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token })); } finally { fs.closeSync(fd); }
      held.add(token);
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    let owner: { pid?: number; token?: string } = {};
    try { owner = JSON.parse(fs.readFileSync(paths.lock, 'utf8')); } catch { /* unreadable: treat as stale */ }
    const live = typeof owner.pid === 'number' && alive(owner.pid) && !(owner.pid === process.pid && !(owner.token && held.has(owner.token)));
    if (live) throw new InstallationLockError('Another Specplane installation holds the repository installation lock; retry when it finishes.');
    try {
      const again = JSON.parse(fs.readFileSync(paths.lock, 'utf8')) as { token?: string };
      if (again.token === owner.token) fs.unlinkSync(paths.lock);
    } catch { /* lock changed or vanished: retry */ }
  }
  throw new InstallationLockError('Could not acquire the repository installation lock.');
}

function releaseLock(paths: InstallPaths, token: string): void {
  held.delete(token);
  try {
    const owner = JSON.parse(fs.readFileSync(paths.lock, 'utf8')) as { token?: string };
    if (owner.token === token) fs.unlinkSync(paths.lock);
  } catch { /* already gone */ }
}

function removeTemp(root: string, e: Entry): void {
  try { fs.unlinkSync(abs(root, e.temp)); } catch { /* not created */ }
}

/** Restore only preimages that still match this transaction's own writes; report what must be resolved by hand. */
function rollback(root: string, paths: InstallPaths, j: Journal): { restored: string[]; recoveryRequired: string[]; kept: string | null } {
  const restored: string[] = [], recoveryRequired: string[] = [];
  for (const e of [...j.entries].reverse()) {
    removeTemp(root, e);
    const dest = abs(root, e.path);
    const now = digestOf(dest);
    if (now === e.pre) continue;
    if (now !== e.post) { recoveryRequired.push(e.path); continue; }
    if (e.pre === ABSENT) { fs.unlinkSync(dest); restored.push(e.path); continue; }
    const back = path.join(paths.backups, j.token, e.backup!);
    const tmp = `${dest}.specplane-restore-${j.token.slice(0, 8)}`;
    fs.copyFileSync(back, tmp);
    if (e.preMode !== null) fs.chmodSync(tmp, e.preMode);
    fs.renameSync(tmp, dest);
    restored.push(e.path);
  }
  for (const d of [...j.dirs].reverse()) { try { fs.rmdirSync(abs(root, d)); } catch { /* not empty or gone */ } }
  let kept: string | null = null;
  const backupDir = path.join(paths.backups, j.token);
  if (recoveryRequired.length > 0) {
    kept = path.join(paths.dir, `recovery-${j.token}`);
    try { fs.renameSync(backupDir, kept); } catch { kept = null; }
  } else fs.rmSync(backupDir, { recursive: true, force: true });
  return { restored, recoveryRequired, kept };
}

function writeLedger(paths: InstallPaths, updates: Record<string, string>): void {
  atomicJson(paths.ledger, { version: 1, files: { ...readLedger(paths), ...updates } });
}

/** Reconcile an interrupted run. Returns report lines. */
function recover(root: string, paths: InstallPaths): string[] {
  let j: Journal;
  try { j = JSON.parse(fs.readFileSync(paths.journal, 'utf8')) as Journal; }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') { fs.rmSync(paths.backups, { recursive: true, force: true }); return []; }
    throw new InstallationConflictError(`Installation journal is unreadable; resolve ${paths.journal} by hand before installing.`);
  }
  const lines: string[] = [];
  if (j.phase === 'committed') {
    writeLedger(paths, j.ledger);
    for (const e of j.entries) removeTemp(root, e);
    fs.rmSync(path.join(paths.backups, j.token), { recursive: true, force: true });
    lines.push(`Completed interrupted installation (${j.entries.length} files were already replaced)`);
  } else {
    const r = rollback(root, paths, j);
    lines.push(`Recovered interrupted installation: restored ${r.restored.length} files, nothing partially activated`);
    for (const p of r.recoveryRequired) lines.push(`Recovery required: ${p} changed after the interrupted installation; left as is${r.kept ? ` (preimage kept in ${r.kept})` : ''}`);
  }
  fs.unlinkSync(paths.journal);
  return lines;
}

export class InstallTransaction {
  /** Report lines produced by journal recovery when this transaction was opened. */
  readonly notes: string[] = [];
  private readonly staged = new Map<string, Staged>();
  private readonly adopted = new Map<string, string>();
  private closed = false;
  private constructor(readonly root: string, private readonly paths: InstallPaths, private readonly token: string) {}

  static open(root: string): InstallTransaction {
    const paths = installPaths(root);
    const token = crypto.randomBytes(12).toString('hex');
    acquireLock(paths, token);
    const tx = new InstallTransaction(path.resolve(root), paths, token);
    try { tx.notes.push(...recover(tx.root, paths)); }
    catch (e) { releaseLock(paths, token); throw e; }
    return tx;
  }

  /** Current bytes of a destination (validated first), or null when absent. Staged content is not visible. */
  read(dest: string): Buffer | null {
    assertInstallDestination(this.root, dest);
    try { return fs.readFileSync(dest); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
  }

  /** absent | current (bytes equal template) | owned-stale (unmodified since the recorded install) | customized. */
  classify(dest: string, template: Uint8Array): 'absent' | 'current' | 'owned-stale' | 'customized' {
    const cur = this.read(dest);
    if (cur === null) return 'absent';
    const digest = sha(cur);
    if (digest === sha(template)) { this.adopted.set(rel(this.root, dest), digest); return 'current'; }
    return readLedger(this.paths)[rel(this.root, dest)] === digest ? 'owned-stale' : 'customized';
  }

  /** Stage a full-file replacement. Records the preimage now; commit refuses if it changed. */
  stage(dest: string, content: string | Uint8Array, opts: { mode?: number; owned?: boolean } = {}): void {
    if (this.closed) throw new Error('Installation transaction is closed');
    assertInstallDestination(this.root, dest);
    const st = (() => { try { return fs.lstatSync(dest); } catch { return null; } })();
    const buf = Buffer.from(content);
    this.staged.set(rel(this.root, dest), {
      content: buf, mode: opts.mode ?? null, owned: opts.owned ?? false,
      pre: st ? digestOf(dest) : ABSENT, preMode: st ? st.mode & 0o777 : null,
    });
  }

  /** Discard without writing. */
  release(): void {
    if (this.closed) return;
    this.closed = true;
    releaseLock(this.paths, this.token);
  }

  commit(): void {
    if (this.closed) throw new Error('Installation transaction is closed');
    const { root, paths, token } = this;
    const hook = (point: string): void => testHooks.interrupt?.(point);
    let journal: Journal | null = null;
    try {
      const entries: Entry[] = [...this.staged.entries()].map(([p, s], i) => ({
        path: p, pre: s.pre, preMode: s.preMode, post: sha(s.content), mode: s.mode, backup: s.pre === ABSENT ? null : String(i),
        temp: `${p}.specplane-new-${token.slice(0, 8)}`, state: 'pending' as const,
      }));
      // 1. Recheck containment and every preimage before any mutation.
      for (const e of entries) this.recheck(e);
      // 2. Backups, then the journal, then directories and temporary files.
      fs.mkdirSync(path.join(paths.backups, token), { recursive: true, mode: 0o700 });
      for (const e of entries) if (e.backup) fs.copyFileSync(abs(root, e.path), path.join(paths.backups, token, e.backup));
      const dirs: string[] = [];
      for (const e of entries) {
        const parts = path.posix.dirname(e.path).split('/').filter((x) => x && x !== '.');
        for (let k = 1; k <= parts.length; k++) {
          const d = parts.slice(0, k).join('/');
          if (!dirs.includes(d) && !fs.existsSync(abs(root, d))) dirs.push(d);
        }
      }
      const ledger: Record<string, string> = Object.fromEntries(this.adopted);
      for (const e of entries) if (this.staged.get(e.path)!.owned) ledger[e.path] = e.post;
      journal = { version: 1, token, phase: 'applying', entries, dirs, ledger };
      atomicJson(paths.journal, journal);
      for (const d of dirs) { assertInstallDestination(root, abs(root, d) + '/x'); fs.mkdirSync(abs(root, d), { mode: 0o777 }); }
      for (const e of entries) {
        const s = this.staged.get(e.path)!;
        const fd = fs.openSync(abs(root, e.temp), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o666);
        try { fs.writeFileSync(fd, s.content); } finally { fs.closeSync(fd); }
        if (e.mode !== null || e.preMode !== null) fs.chmodSync(abs(root, e.temp), (e.mode ?? e.preMode)!);
      }
      hook('prepared');
      // 3. Replace in staging order (so an installed manifest staged last is written last).
      entries.forEach((e, i) => {
        hook(`before-apply:${i}`);
        this.recheck(e);
        if (digestOf(abs(root, e.temp)) !== e.post) throw new InstallationConflictError(`Staged file changed: ${e.temp}`);
        fs.renameSync(abs(root, e.temp), abs(root, e.path));
        e.state = 'applied';
        atomicJson(paths.journal, journal);
        hook(`after-apply:${i}`);
      });
      journal.phase = 'committed';
      atomicJson(paths.journal, journal);
      hook('committed');
      writeLedger(paths, journal.ledger);
      fs.rmSync(path.join(paths.backups, token), { recursive: true, force: true });
      fs.unlinkSync(paths.journal);
      this.closed = true;
      releaseLock(paths, token);
    } catch (error) {
      if (error instanceof SimulatedCrash) { held.delete(token); this.closed = true; throw error; }
      if (journal) {
        const r = rollback(root, paths, journal);
        try { fs.unlinkSync(paths.journal); } catch { /* ignore */ }
        if (r.recoveryRequired.length > 0) {
          (error as Error).message += ` Recovery required for: ${r.recoveryRequired.join(', ')}`;
        }
      }
      this.closed = true;
      releaseLock(paths, token);
      throw error;
    }
  }

  private recheck(e: Entry): void {
    const dest = abs(this.root, e.path);
    assertInstallDestination(this.root, dest);
    if (digestOf(dest) !== e.pre) throw new InstallationConflictError(`Installation destination changed since it was inspected: ${e.path}`);
  }
}

/** Open, run, commit; always releases the lock. Recovery notes are passed to `notes`. */
export function runInstallTransaction<T>(root: string, fn: (tx: InstallTransaction) => T, notes?: string[]): T {
  const tx = InstallTransaction.open(root);
  try {
    notes?.push(...tx.notes);
    const result = fn(tx);
    tx.commit();
    return result;
  } finally { tx.release(); }
}
