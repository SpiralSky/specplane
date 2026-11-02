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
interface Worker { pid: number; token: string; checkout: string; step: number; keysDigest: string; state: 'active' | 'stopped' | 'consumed' | 'uncertain' }
interface RecordData { version: 1; kind: Kind; identity: string; pid: number; generation: string; requestId: string; token: string; worker: Worker | null }
/** Private transport: never put this value in prompts, commits, or public receipts. */
export interface WorkerDelegation { commonDir: string; keys: readonly Key[]; requestId: string; generation: string; token: string; checkout: string; step: number; pid: number }
export interface DelegatedLease { assertOwned(): void; consume(): void }

export interface LeaseRequest { checkouts: string[]; plans?: string[]; repository?: boolean; requestId: string }
export interface WriterLease { readonly keys: readonly Key[]; readonly reclaimed: boolean; assertOwned(): void; delegate(input: { checkout: string; step: number; pid: number }): WorkerDelegation; acknowledgeStop(result: 'stopped' | 'uncertain'): void; release(): void }
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const fileFor = (dir: string, key: Key) => path.join(dir, `${key.kind}-${hash(key.identity)}.json`);
const delegationMarker = (dir: string, generation: string) => path.join(dir, `delegation-${hash(generation)}.marker`);
const nonempty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
function validWorker(w: any): w is Worker | null {
  return w === null || (!!w && typeof w === 'object' && !Array.isArray(w) &&
    Object.keys(w).sort().join(',') === 'checkout,keysDigest,pid,state,step,token' &&
    Number.isSafeInteger(w.pid) && w.pid > 0 && nonempty(w.token) && nonempty(w.checkout) &&
    Number.isSafeInteger(w.step) && w.step > 0 && nonempty(w.keysDigest) &&
    ['active', 'stopped', 'consumed', 'uncertain'].includes(w.state));
}
function readRecord(file: string, key: Key): RecordData {
  let v: any;
  try {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      if (!fs.fstatSync(fd).isFile()) throw new Error('Not a regular file');
      v = JSON.parse(fs.readFileSync(fd, 'utf8'));
    } finally { fs.closeSync(fd); }
  } catch { throw new LeaseRefused(`Unreadable or nonregular coordination record ${file}; inspect manually.`, 'RECOVERY_REQUIRED'); }
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join(',') !== 'generation,identity,kind,pid,requestId,token,version,worker' || v.version !== 1 || v.kind !== key.kind || v.identity !== key.identity || !Number.isSafeInteger(v.pid) || v.pid < 1 || !nonempty(v.generation) || !nonempty(v.requestId) || !nonempty(v.token) || !validWorker(v.worker))
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
          if (prior.worker !== null || exists(delegationMarker(dir, prior.generation))) throw new LeaseRefused(`${key.kind} lease has delegated worker evidence; explicit recovery is required.`, 'RECOVERY_REQUIRED');
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
  const readAll = () => keys.map(key => readRecord(fileFor(dir, key), key));
  const updateWorker = (worker: Worker) => {
    for (const [i, key] of keys.entries()) {
      const record = readAll()[i];
      fs.writeFileSync(fileFor(dir, key), JSON.stringify({ ...record, worker }));
    }
  };
  const sameWorker = (records: RecordData[]) => {
    const first = records[0].worker;
    if (!first || records.some(r => JSON.stringify(r.worker) !== JSON.stringify(first)))
      throw new LeaseRefused('Delegation state is missing or inconsistent; inspect coordination state.', 'RECOVERY_REQUIRED');
    return first;
  };
  return { keys: publicKeys, reclaimed, assertOwned: () => guard(dir, () => {
    verify();
    if (exists(delegationMarker(dir, generation)) || readAll().some(r => r.worker !== null)) throw new LeaseRefused('Delegated lease cannot be used by its owner.', 'LOCKED');
  }), delegate: input => {
    const checkout = checkoutIdentity(input.checkout);
    if (checkout.commonDir !== commonDir || !keys.some(k => k.kind === 'checkout' && k.identity === checkout.gitDir) ||
        !Number.isSafeInteger(input.step) || input.step < 1 || !Number.isSafeInteger(input.pid) || input.pid < 1)
      throw new Error('Delegation requires a held checkout, step and worker PID.');
    return guard(dir, () => {
      verify();
      if (exists(delegationMarker(dir, generation)) || readAll().some(r => r.worker !== null)) throw new LeaseRefused('Lease is already delegated.', 'LOCKED');
      const worker: Worker = { pid: input.pid, token: randomUUID(), checkout: checkout.gitDir, step: input.step, keysDigest: hash(JSON.stringify(keys)), state: 'active' };
      // Create the generation marker first: an interrupted multi-record update must never be reclaimed as undelegated.
      const marker = fs.openSync(delegationMarker(dir, generation), 'wx', 0o600);
      fs.closeSync(marker);
      updateWorker(worker);
      return { commonDir, keys: publicKeys, requestId, generation, token: worker.token, checkout: worker.checkout, step: worker.step, pid: worker.pid };
    });
  }, acknowledgeStop: result => guard(dir, () => {
    verify();
    const worker = sameWorker(readAll());
    if (worker.state !== 'active' && worker.state !== 'uncertain') throw new LeaseRefused('Worker is already stopped or recorded.', 'RECOVERY_REQUIRED');
    if (result !== 'stopped' && result !== 'uncertain') throw new Error('A stopped or uncertain acknowledgment is required.');
    updateWorker({ ...worker, state: result });
  }), release: () => guard(dir, () => {
    verify();
    const records = readAll();
    if (records.some(r => r.worker !== null)) {
      const worker = sameWorker(records);
      if (worker.state !== 'stopped' && worker.state !== 'consumed') throw new LeaseRefused('Worker stop is unproved; recovery is required.', 'RECOVERY_REQUIRED');
    } else if (exists(delegationMarker(dir, generation))) {
      throw new LeaseRefused('Incomplete delegation requires recovery.', 'RECOVERY_REQUIRED');
    }
    for (const key of [...keys].reverse()) fs.unlinkSync(fileFor(dir, key));
    if (exists(delegationMarker(dir, generation))) fs.unlinkSync(delegationMarker(dir, generation));
    released = true;
  }) };
}

/** Worker-side access reuses the held set; it never acquires another lease. */
export function useDelegatedLease(delegation: WorkerDelegation): DelegatedLease {
  const { commonDir, requestId, generation, token, checkout, step, pid } = delegation;
  const keys = delegation.keys.map(k => ({ kind: k.kind, identity: k.identity }));
  const dir = path.join(commonDir, 'specplane-runtime');
  const verify = () => {
    if (process.pid !== pid || keys.length === 0) throw new LeaseRefused('Delegation belongs to another worker.', 'RECOVERY_REQUIRED');
    const records = keys.map(k => readRecord(fileFor(dir, k), k));
    const worker = records[0].worker;
    if (!exists(delegationMarker(dir, generation)) || !worker || worker.state !== 'active' || worker.pid !== pid || worker.token !== token || worker.checkout !== checkout || worker.step !== step || worker.keysDigest !== hash(JSON.stringify(keys)) ||
        !keys.some(k => k.kind === 'checkout' && k.identity === checkout) ||
        records.some(r => r.generation !== generation || r.requestId !== requestId || JSON.stringify(r.worker) !== JSON.stringify(worker)))
      throw new LeaseRefused('Delegation is stale or does not match the complete lease set.', 'RECOVERY_REQUIRED');
    return records;
  };
  return { assertOwned: () => guard(dir, () => { verify(); }), consume: () => guard(dir, () => {
    const records = verify();
    for (const [i, key] of keys.entries()) fs.writeFileSync(fileFor(dir, key), JSON.stringify({ ...records[i], worker: { ...records[i].worker!, state: 'consumed' } }));
  }) };
}

/** Recovery requires proof both processes stopped and inspection before invalidating the generation. */
export function recoverDelegatedLease(delegation: WorkerDelegation, inspect: () => void): void {
  const keys = delegation.keys.map(k => ({ kind: k.kind, identity: k.identity }));
  const dir = path.join(delegation.commonDir, 'specplane-runtime');
  guard(dir, () => {
    if (!keys.length) throw new LeaseRefused('Empty recovery set.', 'RECOVERY_REQUIRED');
    const records = keys.map(k => readRecord(fileFor(dir, k), k));
    const worker = records[0].worker;
    if (!worker || worker.keysDigest !== hash(JSON.stringify(keys)) || worker.token !== delegation.token || worker.pid !== delegation.pid || worker.checkout !== delegation.checkout || worker.step !== delegation.step ||
        records.some(r => r.generation !== delegation.generation || r.requestId !== delegation.requestId || r.pid !== records[0].pid || JSON.stringify(r.worker) !== JSON.stringify(worker)) ||
        !dead(records[0].pid) || !dead(worker.pid))
      throw new LeaseRefused('Cannot prove the owner and delegated worker stopped; inspect coordination state.', 'RECOVERY_REQUIRED');
    inspect();
    const after = keys.map(k => readRecord(fileFor(dir, k), k));
    if (JSON.stringify(after) !== JSON.stringify(records) || !dead(records[0].pid) || !dead(worker.pid))
      throw new LeaseRefused('Coordination state changed during recovery; inspect again.', 'RECOVERY_REQUIRED');
    for (const key of [...keys].reverse()) fs.unlinkSync(fileFor(dir, key));
    if (exists(delegationMarker(dir, delegation.generation))) fs.unlinkSync(delegationMarker(dir, delegation.generation));
  });
}
