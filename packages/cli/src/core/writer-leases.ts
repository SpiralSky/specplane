import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { run } from '../git/exec.js';

/** Internal coordination primitive. Callers must acquire the complete set before mutation. */
export class LeaseRefused extends Error {
  constructor(message: string, readonly code: 'LOCKED' | 'RECOVERY_REQUIRED') { super(message); }
}
export interface CheckoutIdentity { commonDir: string; gitDir: string }
export function checkoutIdentity(checkout: string): CheckoutIdentity {
  const resolve = (flag: string) => fs.realpathSync(run('git', ['rev-parse', '--path-format=absolute', flag], { cwd: checkout }).trim());
  return { commonDir: resolve('--git-common-dir'), gitDir: resolve('--absolute-git-dir') };
}
type Kind = 'repository' | 'plan' | 'checkout';
interface Key { kind: Kind; identity: string }
interface RecordData { version: 1; kind: Kind; identity: string; pid: number; generation: string; requestId: string; token: string; worker: null }
export interface LeaseRequest { checkouts: string[]; plans?: string[]; repository?: boolean; requestId: string }
export interface WriterLease { readonly keys: readonly Key[]; readonly reclaimed: boolean; assertOwned(): void; release(): void }
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const fileFor = (dir: string, key: Key) => path.join(dir, `${key.kind}-${hash(key.identity)}.json`);
const nonempty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
function readRecord(file: string, key: Key): RecordData {
  let v: any;
  try {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      if (!fs.fstatSync(fd).isFile()) throw new Error('Not a regular file');
      v = JSON.parse(fs.readFileSync(fd, 'utf8'));
    } finally { fs.closeSync(fd); }
  } catch { throw new LeaseRefused(`Unreadable or nonregular coordination record ${file}; inspect manually.`, 'RECOVERY_REQUIRED'); }
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join(',') !== 'generation,identity,kind,pid,requestId,token,version,worker' || v.version !== 1 || v.kind !== key.kind || v.identity !== key.identity || !Number.isSafeInteger(v.pid) || v.pid < 1 || !nonempty(v.generation) || !nonempty(v.requestId) || !nonempty(v.token) || v.worker !== null)
    throw new LeaseRefused(`Malformed or delegated coordination record ${file}; inspect manually.`, 'RECOVERY_REQUIRED');
  return v as RecordData;
}
function dead(pid: number): boolean {
  try { process.kill(pid, 0); return false; } catch (e) { return (e as NodeJS.ErrnoException).code === 'ESRCH'; }
}
function exists(file: string): boolean {
  try { fs.lstatSync(file); return true; } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw new LeaseRefused(`Cannot inspect coordination record ${file}; inspect manually.`, 'RECOVERY_REQUIRED');
  }
}
function guard<T>(dir: string, fn: () => T): T {
  const file = path.join(dir, 'writer.guard');
  let fd: number;
  try { fd = fs.openSync(file, 'wx', 0o600); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new LeaseRefused('Writer guard exists; contention or recovery requires inspection.', 'LOCKED');
    throw e;
  }
  try { return fn(); } finally { fs.closeSync(fd); fs.unlinkSync(file); }
}
/** No waiting or lock upgrades: contention releases the subset before returning. */
export function acquireWriterLease(request: LeaseRequest): WriterLease {
  if (!nonempty(request.requestId) || !Array.isArray(request.checkouts) || request.checkouts.length === 0 || request.checkouts.some(c => !nonempty(c)) || (request.plans && (!Array.isArray(request.plans) || request.plans.some(p => !nonempty(p))))) throw new Error('A request identity, checkout and valid plan IDs are required.');
  const requestId = request.requestId;
  const identities = request.checkouts.map(checkoutIdentity);
  const commonDir = identities[0].commonDir;
  if (identities.some(i => i.commonDir !== commonDir)) throw new Error('All checkouts must belong to the same repository.');
  const keys: Key[] = [
    ...(request.repository ? [{ kind: 'repository' as const, identity: commonDir }] : []),
    ...[...new Set(request.plans ?? [])].sort().map(identity => ({ kind: 'plan' as const, identity })),
    ...[...new Set(identities.map(i => i.gitDir))].sort().map(identity => ({ kind: 'checkout' as const, identity })),
  ];
  const dir = path.join(commonDir, 'specplane-runtime');
  try { fs.mkdirSync(dir, { mode: 0o700 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  const runtimeStat = fs.lstatSync(dir);
  if (!runtimeStat.isDirectory() || runtimeStat.isSymbolicLink()) throw new LeaseRefused('Runtime directory is not a real directory; inspect manually.', 'RECOVERY_REQUIRED');
  const token = randomUUID(), generation = randomUUID();
  let reclaimed = false;
  guard(dir, () => {
    const acquired: Key[] = [];
    try {
      for (const key of keys) {
        const file = fileFor(dir, key);
        if (exists(file)) {
          const prior = readRecord(file, key);
          if (!dead(prior.pid)) throw new LeaseRefused(`${key.kind} lease is held by a live or inaccessible owner.`, 'LOCKED');
          fs.unlinkSync(file); reclaimed = true;
        }
        const record: RecordData = { version: 1, kind: key.kind, identity: key.identity, pid: process.pid, generation, requestId, token, worker: null };
        const fd = fs.openSync(file, 'wx', 0o600);
        acquired.push(key);
        try { fs.writeFileSync(fd, JSON.stringify(record)); } finally { fs.closeSync(fd); }
      }
    } catch (e) {
      for (const key of acquired.reverse()) fs.unlinkSync(fileFor(dir, key));
      throw e;
    }
  });
  let released = false;
  const verify = () => {
    if (released) throw new LeaseRefused('Lease has already been released.', 'RECOVERY_REQUIRED');
    for (const key of keys) {
      const record = readRecord(fileFor(dir, key), key);
      if (record.pid !== process.pid || record.token !== token || record.generation !== generation || record.requestId !== requestId) throw new LeaseRefused('Lease ownership changed; inspect coordination state.', 'RECOVERY_REQUIRED');
    }
  };
  const publicKeys = Object.freeze(keys.map(key => Object.freeze({ ...key })));
  return { keys: publicKeys, reclaimed, assertOwned: () => guard(dir, verify), release: () => guard(dir, () => {
    verify();
    for (const key of [...keys].reverse()) fs.unlinkSync(fileFor(dir, key));
    released = true;
  }) };
}
