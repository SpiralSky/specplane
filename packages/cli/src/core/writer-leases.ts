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
/** Private recovery transport; only the trusted embedding lifecycle may retain it. */
export interface HostLeaseBinding { commonDir: string; keys: readonly Key[]; requestId: string; generation: string; token: string; evidenceDigest?: string }

export interface LeaseRequest { checkouts: string[]; plans?: string[]; repository?: boolean; requestId: string }
export interface WriterLease { readonly keys: readonly Key[]; readonly reclaimed: boolean; assertOwned(): void; /** Mark host work before exposing a request. */ retainHostWorker(): void; recoveryBinding(): HostLeaseBinding; bindRecoveryEvidence(digest: string): void; /** Trusted embedding only, after all host workers stop. */ releaseStoppedHost(): void; delegate(input: { checkout: string; step: number; pid: number }): WorkerDelegation; acknowledgeStop(result: 'stopped' | 'uncertain'): void; release(): void }
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const fileFor = (dir: string, key: Key) => path.join(dir, `${key.kind}-${hash(key.identity)}.json`);
const delegationMarker = (dir: string, generation: string) => path.join(dir, `delegation-${hash(generation)}.marker`);
const hostMarker = (dir: string, generation: string) => path.join(dir, `host-${hash(generation)}.marker`);
const completedHostMarker = (dir: string, generation: string) => path.join(dir, `completed-host-${hash(generation)}.marker`);
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
    const before = fs.lstatSync(file);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw new Error('Not a regular file with one link');
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const opened = fs.fstatSync(fd);
      if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino) throw new Error('Not the same regular file with one link');
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
/** Read-only contention check for previews. The result is advisory: another
 * writer may acquire a lease after inspection, so execution must acquire it. */
export function inspectWriterLease(request: LeaseRequest): void {
  if (!nonempty(request.requestId) || !request.checkouts.length || request.checkouts.some(c => !nonempty(c)) || request.plans?.some(p => !nonempty(p))) throw new Error('A request identity, checkout and valid plan IDs are required.');
  const identities = request.checkouts.map(checkoutIdentity);
  const commonDir = identities[0].commonDir;
  if (identities.some(i => i.commonDir !== commonDir)) throw new Error('All checkouts must belong to the same repository.');
  const keys: Key[] = [
    ...(request.repository ? [{ kind: 'repository' as const, identity: commonDir }] : []),
    ...[...new Set(request.plans ?? [])].sort().map(identity => ({ kind: 'plan' as const, identity })),
    ...[...new Set(identities.map(i => i.gitDir))].sort().map(identity => ({ kind: 'checkout' as const, identity })),
  ];
  const dir = path.join(commonDir, 'specplane-runtime');
  if (!exists(dir)) return;
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new LeaseRefused('Runtime directory is not a real directory; inspect manually.', 'RECOVERY_REQUIRED');
  if (exists(path.join(dir, 'writer.guard'))) throw new LeaseRefused('Writer guard exists; contention or recovery requires inspection.', 'LOCKED');
  for (const key of keys) {
    const file = fileFor(dir, key);
    if (!exists(file)) continue;
    const prior = readRecord(file, key);
    if (prior.worker !== null || exists(delegationMarker(dir, prior.generation))) throw new LeaseRefused(`${key.kind} lease has delegated worker evidence; explicit recovery is required.`, 'RECOVERY_REQUIRED');
    if (!dead(prior.pid)) throw new LeaseRefused(`${key.kind} lease is held by a live or inaccessible owner.`, 'LOCKED');
    if (exists(hostMarker(dir, prior.generation))) throw new LeaseRefused(`${key.kind} lease has host worker evidence; explicit recovery is required.`, 'RECOVERY_REQUIRED');
  }
  if (exists(path.join(dir, 'writer.guard'))) throw new LeaseRefused('Writer guard exists; contention or recovery requires inspection.', 'LOCKED');
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
          if (exists(hostMarker(dir, prior.generation))) throw new LeaseRefused(`${key.kind} lease has host worker evidence; explicit recovery is required.`, 'RECOVERY_REQUIRED');
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
  return leaseHandle(commonDir, keys, requestId, generation, token, reclaimed);
}

function leaseHandle(commonDir: string, keys: Key[], requestId: string, generation: string, token: string, reclaimed: boolean, hostRetained = false, evidenceDigest?: string): WriterLease {
  const dir = path.join(commonDir, 'specplane-runtime');
  let released = false;
  const binding = (): HostLeaseBinding => ({ commonDir, keys: keys.map(k => ({ ...k })), requestId, generation, token, ...(evidenceDigest ? { evidenceDigest } : {}) });
  const verify = () => {
    if (released) throw new LeaseRefused('Lease has already been released.', 'RECOVERY_REQUIRED');
    if (hostRetained && !exists(hostMarker(dir, generation))) throw new LeaseRefused('Host worker evidence is missing; inspect coordination state.', 'RECOVERY_REQUIRED');
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
  const release = (hostStopped = false) => guard(dir, () => {
    verify();
    if (exists(hostMarker(dir, generation)) && !hostStopped) throw new LeaseRefused('Host worker stop is unproved; recovery is required.', 'RECOVERY_REQUIRED');
    const records = readAll();
    if (records.some(r => r.worker !== null)) {
      const worker = sameWorker(records);
      if (worker.state !== 'stopped' && worker.state !== 'consumed') throw new LeaseRefused('Worker stop is unproved; recovery is required.', 'RECOVERY_REQUIRED');
    } else if (exists(delegationMarker(dir, generation))) {
      throw new LeaseRefused('Incomplete delegation requires recovery.', 'RECOVERY_REQUIRED');
    }
    if (hostStopped && hostRetained && evidenceDigest) {
      if (JSON.stringify(readHostBinding(dir, generation)) !== JSON.stringify(binding())) throw new LeaseRefused('Host recovery binding changed before completion.', 'RECOVERY_REQUIRED');
      const completed = completedHostMarker(dir, generation), content = JSON.stringify({ version: 1, ...binding() });
      try {
        const fd = fs.openSync(completed, 'wx', 0o600);
        try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        if (JSON.stringify(readLeaseBinding(completed)) !== JSON.stringify(binding())) throw new LeaseRefused('Existing completed host proof differs from the released lease.', 'RECOVERY_REQUIRED');
      }
    }
    for (const key of [...keys].reverse()) fs.unlinkSync(fileFor(dir, key));
    if (exists(delegationMarker(dir, generation))) fs.unlinkSync(delegationMarker(dir, generation));
    if (exists(hostMarker(dir, generation))) fs.unlinkSync(hostMarker(dir, generation));
    released = true;
  });
  return { keys: publicKeys, reclaimed, assertOwned: () => guard(dir, () => {
    verify();
    if (exists(delegationMarker(dir, generation)) || readAll().some(r => r.worker !== null)) throw new LeaseRefused('Delegated lease cannot be used by its owner.', 'LOCKED');
  }), retainHostWorker: () => guard(dir, () => {
    verify();
    if (exists(delegationMarker(dir, generation)) || readAll().some(r => r.worker !== null)) throw new LeaseRefused('Lease is already delegated.', 'LOCKED');
    // Persist before the prepared request can escape to a host turn. Unknown
    // host process trees require trusted acknowledgment, never PID inference.
    const fd = fs.openSync(hostMarker(dir, generation), 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify({ version: 1, ...binding() })); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    hostRetained = true;
  }), recoveryBinding: () => guard(dir, () => {
    verify();
    if (!hostRetained || JSON.stringify(readHostBinding(dir, generation)) !== JSON.stringify(binding())) throw new LeaseRefused('Host recovery binding is unavailable or changed.', 'RECOVERY_REQUIRED');
    if (exists(delegationMarker(dir, generation)) || readAll().some(r => r.worker !== null)) throw new LeaseRefused('Delegated lease cannot recover as host work.', 'RECOVERY_REQUIRED');
    return binding();
  }), bindRecoveryEvidence: digest => guard(dir, () => {
    verify();
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new LeaseRefused('Invalid recovery evidence digest.', 'RECOVERY_REQUIRED');
    if (!hostRetained || JSON.stringify(readHostBinding(dir, generation)) !== JSON.stringify(binding())) throw new LeaseRefused('Host recovery binding is unavailable or changed.', 'RECOVERY_REQUIRED');
    if (evidenceDigest && evidenceDigest !== digest) throw new LeaseRefused('Recovery evidence was already bound to different bytes.', 'RECOVERY_REQUIRED');
    if (evidenceDigest === digest) return;
    const fd = fs.openSync(hostMarker(dir, generation), fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW);
    try {
      fs.ftruncateSync(fd, 0); fs.writeFileSync(fd, JSON.stringify({ version: 1, ...binding(), evidenceDigest: digest })); fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    evidenceDigest = digest;
  }), delegate: input => {
    const checkout = checkoutIdentity(input.checkout);
    if (checkout.commonDir !== commonDir || !keys.some(k => k.kind === 'checkout' && k.identity === checkout.gitDir) ||
        !Number.isSafeInteger(input.step) || input.step < 1 || !Number.isSafeInteger(input.pid) || input.pid < 1)
      throw new Error('Delegation requires a held checkout, step and worker PID.');
    return guard(dir, () => {
      verify();
      if (exists(hostMarker(dir, generation)) || exists(delegationMarker(dir, generation)) || readAll().some(r => r.worker !== null)) throw new LeaseRefused('Lease is already delegated.', 'LOCKED');
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
  }), release: () => release(), releaseStoppedHost: () => release(true) };
}

/** Empty legacy host markers still block reclamation, but cannot establish recovery identity. */
function readHostBinding(dir: string, generation: string): HostLeaseBinding { return readLeaseBinding(hostMarker(dir, generation)); }
function readLeaseBinding(file: string): HostLeaseBinding {
  try {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    let v: any;
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1) throw new Error('Nonregular host marker');
      v = JSON.parse(fs.readFileSync(fd, 'utf8'));
    } finally { fs.closeSync(fd); }
    if (!v || Object.keys(v).filter(k => k !== 'evidenceDigest').sort().join(',') !== 'commonDir,generation,keys,requestId,token,version' || v.version !== 1 ||
        ![v.commonDir, v.generation, v.requestId, v.token].every(nonempty) || !Array.isArray(v.keys) || !v.keys.length ||
        (v.evidenceDigest !== undefined && (typeof v.evidenceDigest !== 'string' || !/^[a-f0-9]{64}$/.test(v.evidenceDigest))) ||
        v.keys.some((k: any) => !k || Object.keys(k).sort().join(',') !== 'identity,kind' || !['repository', 'plan', 'checkout'].includes(k.kind) || !nonempty(k.identity))) throw new Error('Malformed host marker');
    return { commonDir: v.commonDir, keys: v.keys, requestId: v.requestId, generation: v.generation, token: v.token, ...(v.evidenceDigest ? { evidenceDigest: v.evidenceDigest } : {}) };
  } catch { throw new LeaseRefused('Host recovery marker is unavailable or malformed; inspect manually.', 'RECOVERY_REQUIRED'); }
}

/** Read-only proof that an evidence-bound host lease was released after trusted
 * stopping. This never grants writer rights or makes the journal a verified execution.
 * Callers must still inspect the exact intended commit and current checkout state.
 */
export function verifyCompletedHostLease(binding: HostLeaseBinding): void {
  if (!binding || ![binding.commonDir, binding.requestId, binding.generation, binding.token].every(nonempty) || !/^[a-f0-9]{64}$/.test(binding.evidenceDigest ?? '') || !Array.isArray(binding.keys) || !binding.keys.length)
    throw new LeaseRefused('Invalid completed host recovery binding.', 'RECOVERY_REQUIRED');
  const dir = path.join(binding.commonDir, 'specplane-runtime');
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(binding.commonDir) !== binding.commonDir) throw new LeaseRefused('Nonregular completed host recovery directory.', 'RECOVERY_REQUIRED');
  const expected = readLeaseBinding(completedHostMarker(dir, binding.generation));
  if (expected.commonDir !== binding.commonDir || expected.requestId !== binding.requestId || expected.generation !== binding.generation || expected.token !== binding.token || expected.evidenceDigest !== binding.evidenceDigest || JSON.stringify(expected.keys.map(k => [k.kind, k.identity])) !== JSON.stringify(binding.keys.map(k => [k.kind, k.identity])) || new Set(binding.keys.map(k => JSON.stringify(k))).size !== binding.keys.length || !binding.keys.some(k => k.kind === 'checkout'))
    throw new LeaseRefused('Completed host recovery binding changed.', 'RECOVERY_REQUIRED');
  for (const key of binding.keys) {
    const file = fileFor(dir, key);
    if (exists(file) && readRecord(file, key).generation === binding.generation) throw new LeaseRefused('Host lease release is incomplete; reconcile coordination records.', 'RECOVERY_REQUIRED');
  }
}

/** INTERNAL trusted lifecycle only: call after independently proving all prior host
 * workers stopped. A dead owner is an additional condition, never that proof.
 * Inspection must verify the durable workflow journal and checkout before adoption.
 */
function hostRecoveryIdentity(input: HostLeaseBinding) {
  const binding = structuredClone(input);
  if (!binding || ![binding.commonDir, binding.requestId, binding.generation, binding.token].every(nonempty) || !Array.isArray(binding.keys) || !binding.keys.length)
    throw new LeaseRefused('Invalid host recovery binding.', 'RECOVERY_REQUIRED');
  const dir = path.join(binding.commonDir, 'specplane-runtime');
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(binding.commonDir) !== binding.commonDir) throw new LeaseRefused('Nonregular host recovery directory.', 'RECOVERY_REQUIRED');
  const keys = binding.keys.map(k => ({ kind: k.kind, identity: k.identity }));
  return { binding, dir, keys };
}
function retainedHostRecords(binding: HostLeaseBinding, dir: string, keys: Key[]) {
  const { commonDir, requestId, generation, token } = binding;
  const expected = readHostBinding(dir, generation);
  if (JSON.stringify(expected) !== JSON.stringify({ commonDir, keys, requestId, generation, token, ...(binding.evidenceDigest ? { evidenceDigest: binding.evidenceDigest } : {}) }) ||
      new Set(keys.map(k => JSON.stringify(k))).size !== keys.length || !keys.some(k => k.kind === 'checkout') || exists(delegationMarker(dir, generation)))
    throw new LeaseRefused('Host recovery does not match the complete retained lease set.', 'RECOVERY_REQUIRED');
  const records = keys.map(k => readRecord(fileFor(dir, k), k));
  if (records.some(r => r.requestId !== requestId || r.generation !== generation || r.token !== token || r.pid !== records[0].pid || r.worker !== null) || !dead(records[0].pid))
    throw new LeaseRefused('Host recovery owner is live, inconsistent or delegated.', 'RECOVERY_REQUIRED');
  return { expected, records };
}
/** Refuse live or mismatched owners before consulting a host stop port. This
 * preflight grants no rights; adoption repeats every check after stopping. */
export function inspectHostLeaseRecovery(input: HostLeaseBinding): void {
  const { binding, dir, keys } = hostRecoveryIdentity(input);
  guard(dir, () => { retainedHostRecords(binding, dir, keys); });
}
/** Trusted lifecycle only, after independent proof that all prior host workers stopped. */
export function recoverHostLease(input: HostLeaseBinding, inspect: () => void): WriterLease {
  const { binding, dir, keys } = hostRecoveryIdentity(input);
  const { commonDir, requestId, generation, token } = binding;
  guard(dir, () => {
    const { expected, records } = retainedHostRecords(binding, dir, keys);
    inspect();
    if (JSON.stringify(readHostBinding(dir, generation)) !== JSON.stringify(expected) || JSON.stringify(keys.map(k => readRecord(fileFor(dir, k), k))) !== JSON.stringify(records) || !dead(records[0].pid) || exists(delegationMarker(dir, generation)))
      throw new LeaseRefused('Coordination state changed during host recovery.', 'RECOVERY_REQUIRED');
    // Keep the old generation and marker throughout adoption. Any interrupted
    // multi-record write remains protected and requires manual reconciliation.
    for (const [i, key] of keys.entries()) {
      const fd = fs.openSync(fileFor(dir, key), fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW);
      try { fs.ftruncateSync(fd, 0); fs.writeFileSync(fd, JSON.stringify({ ...records[i], pid: process.pid })); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
    }
  });
  return leaseHandle(commonDir, keys, requestId, generation, token, true, true, binding.evidenceDigest);
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
