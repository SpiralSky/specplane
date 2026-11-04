/** Explicit reconciliation rolls back recognized core writes; it never resumes a workflow. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { run } from '../git/exec.js';
import { lazyValidator } from '../lazy-validator.js';
import { validateRecordingSet, type RecordingSet } from '../plan/recording-set.js';
import { readContainedFile } from './contained-files.js';
import { canonical, sha256, assertPreparedIdentity, preparedActivity, finishStoppedPreparation, type PreparedState } from './workflow-preparation.js';
import { checkoutIdentity, inspectHostLeaseRecovery, recoverHostLease, verifyCompletedHostLease, type HostLeaseBinding, type WriterLease } from './writer-leases.js';
import { workflowRequestSchema, recordingProposalSchema } from './schemas.js';
import type { CoreContext, Result, WorkflowRequest, RecordingProposal } from './contracts.js';

export interface RecoveryTransaction {
  manifest: RecordingSet;
  generated: { path: string; before: string | null; after: string; beforeMode: number | null; afterMode: number }[];
  indexBeforeDigest: string | 'missing';
  temporaryIndexBasename: string;
  indexLock: { dev: string; ino: string };
  creation?: { files: { path: string; scaffold: string }[] };
}
interface PendingIntent {
  version: 1; request: WorkflowRequest; extensionId: string; proposal: RecordingProposal;
  commit: { head: string; branch: string; tree: string; message: string; transaction: RecoveryTransaction };
}
interface Durable { intent: PendingIntent; binding: HostLeaseBinding; digest: string }
export interface PendingReconciliation { requestId: string; state: 'rolled-back'; preservedPaths: string[]; limitations: string[] }
const requestValid = lazyValidator(workflowRequestSchema), proposalValid = lazyValidator(recordingProposalSchema);
const digest = /^(?:[a-f0-9]{64}|missing)$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const adopted = new Map<string, { durable: Durable; lease: WriterLease }>();
function fail(message: string, code = 'RECOVERY_REQUIRED'): never { throw Object.assign(new Error(message), { code }); }
function same(a: unknown, b: unknown): boolean { return canonical(a) === canonical(b); }
function contained(cwd: string, file: string): Buffer | null {
  try { return readContainedFile(cwd, file); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
}
function read(cwd: string, requestId: string): Durable {
  const identity = checkoutIdentity(cwd), prefix = `specplane-runtime/workflows/${requestId}/`;
  let bytes: Buffer;
  try { bytes = readContainedFile(identity.commonDir, prefix + 'recording-intent.json'); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') fail('No durable prewrite recording intent is available. Pending captures and process-local read-only receipts cannot authorize automatic reconciliation; preserve private evidence and inspect manually.');
    throw e;
  }
  const intent = JSON.parse(bytes.toString()) as PendingIntent;
  const binding = JSON.parse(readContainedFile(identity.commonDir, prefix + 'recovery-binding.json').toString()) as HostLeaseBinding;
  if (!intent || intent.version !== 1 || !requestValid(intent.request) || !proposalValid(intent.proposal) || intent.request.requestId !== requestId || intent.proposal.requestId !== requestId || intent.request.checkout !== cwd || intent.request.extensionId !== intent.extensionId || intent.commit?.head !== intent.request.base.head || intent.commit?.branch !== intent.request.base.branch || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(intent.commit?.tree) || typeof intent.commit.message !== 'string') fail('Malformed pending recording intent.');
  const t = intent.commit.transaction;
  if (!t || !t.manifest || t.manifest.protocol !== 1 || t.manifest.head !== intent.commit.head || t.manifest.branch !== intent.commit.branch || !Array.isArray(t.manifest.changes) || !Array.isArray(t.generated) || !digest.test(t.indexBeforeDigest) || !/^specplane-(?:step|content)-[a-f0-9-]+\.index$/.test(t.temporaryIndexBasename) || !t.indexLock || !/^\d+$/.test(t.indexLock.dev) || !/^\d+$/.test(t.indexLock.ino) || new Set(t.generated.map(c => c.path)).size !== t.generated.length) fail('Pending recovery requires an intact prewrite transaction.');
  for (const c of t.generated) if (!c || typeof c.path !== 'string' || (c.before !== null && typeof c.before !== 'string') || typeof c.after !== 'string' || (c.beforeMode !== null && (!Number.isInteger(c.beforeMode) || c.beforeMode < 0 || c.beforeMode > 0o777)) || !Number.isInteger(c.afterMode) || c.afterMode < 0 || c.afterMode > 0o777 || (c.before === null) !== (c.beforeMode === null)) fail('Malformed generated preimage in pending transaction.');
  if (t.creation && (!Array.isArray(t.creation.files) || new Set(t.creation.files.map(f => f.path)).size !== t.creation.files.length || t.creation.files.some(f => !f || typeof f.scaffold !== 'string' || !t.generated.some(c => c.path === f.path && c.before === null)))) fail('Malformed pending creation scaffold evidence.');
  if (!binding || binding.requestId !== requestId || binding.commonDir !== identity.commonDir || !Array.isArray(binding.keys) || !binding.keys.some(k => k.kind === 'checkout' && k.identity === identity.gitDir) || binding.evidenceDigest !== sha256(bytes)) fail('Pending intent is not bound to its retained lease.');
  return { intent, binding, digest: sha256(bytes) };
}
function recheck(durable: Durable): void {
  const again = read(durable.intent.request.checkout, durable.intent.request.requestId);
  if (again.digest !== durable.digest || !same(again.binding, durable.binding)) fail('Pending evidence changed during reconciliation.');
}
function completed(binding: HostLeaseBinding): boolean {
  const marker = contained(binding.commonDir, `specplane-runtime/completed-host-${sha256(binding.generation)}.marker`);
  if (marker === null) return false;
  verifyCompletedHostLease(binding); return true;
}
function statMode(cwd: string, file: string): number | null { const bytes = contained(cwd, file); return bytes === null ? null : fs.lstatSync(path.join(cwd, file)).mode & 0o777; }
function checkState(durable: Durable, restored = false): void {
  recheck(durable);
  const { intent } = durable, cwd = intent.request.checkout, t = intent.commit.transaction, identity = checkoutIdentity(cwd);
  if (run('git', ['rev-parse', 'HEAD'], { cwd }).trim() !== intent.commit.head || run('git', ['branch', '--show-current'], { cwd }).trim() !== intent.commit.branch) fail('HEAD or branch changed; pending reconciliation never replays a commit.');
  const index = contained(identity.gitDir, 'index');
  if ((index === null ? 'missing' : sha256(index)) !== t.indexBeforeDigest) fail('Real index differs from the prewrite snapshot.');
  const lock = contained(identity.gitDir, 'index.lock');
  if (lock !== null) {
    const st = fs.lstatSync(path.join(identity.gitDir, 'index.lock'), { bigint: true });
    if (restored || String(st.dev) !== t.indexLock.dev || String(st.ino) !== t.indexLock.ino || lock.length !== 0) fail('Index lock ownership or contents changed; preserve it for inspection.');
  }
  const effective: RecordingSet = { ...t.manifest, changes: t.manifest.changes.filter(c => !t.generated.some(g => g.path === c.path)).map(c => ({ ...c })) };
  for (const change of t.generated) {
    const current = contained(cwd, change.path), mode = statMode(cwd, change.path);
    const before = change.before === null ? null : Buffer.from(change.before);
    const matchesBefore = current === null ? before === null : before !== null && current.equals(before);
    const scaffold = t.creation?.files.find(f => f.path === change.path)?.scaffold;
    const matchesAfter = current !== null && (current.equals(Buffer.from(change.after)) || (!restored && scaffold !== undefined && current.equals(Buffer.from(scaffold))));
    if (matchesBefore ? mode !== change.beforeMode : restored || !matchesAfter || mode !== change.afterMode) fail(`Generated path is outside its recognized prewrite/after/scaffold states: ${change.path}`);
    const original = t.manifest.changes.find(c => c.path === change.path);
    const beforeDigest = original?.beforeDigest ?? (change.before === null ? 'missing' : sha256(change.before));
    const afterDigest = current === null ? 'missing' : sha256(current);
    if (beforeDigest !== afterDigest) effective.changes.push({ path: change.path, beforeDigest, afterDigest, purpose: original?.purpose ?? 'recognized core-generated state' });
  }
  validateRecordingSet(effective, cwd, null, [], effective.changes.map(c => `${c.path}:${c.purpose}`), 'done', new Map(t.manifest.changes.map(c => [c.path, c.afterDigest])));
}
function verifyState(durable: Durable, restored = false): void {
  const optionalLocks = process.env.GIT_OPTIONAL_LOCKS;
  process.env.GIT_OPTIONAL_LOCKS = '0';
  try { checkState(durable, restored); }
  finally { if (optionalLocks === undefined) delete process.env.GIT_OPTIONAL_LOCKS; else process.env.GIT_OPTIONAL_LOCKS = optionalLocks; }
}
function removeLock(durable: Durable): void {
  const cwd = checkoutIdentity(durable.intent.request.checkout).gitDir;
  const current = contained(cwd, 'index.lock');
  if (current === null) return;
  const stat = fs.lstatSync(path.join(cwd, 'index.lock'), { bigint: true }), expected = durable.intent.commit.transaction.indexLock;
  if (String(stat.dev) !== expected.dev || String(stat.ino) !== expected.ino || current.length) fail('Stale index lock changed before removal.');
  fs.unlinkSync(path.join(cwd, 'index.lock'));
}
function rollback(durable: Durable, lease: WriterLease): void {
  const cwd = durable.intent.request.checkout;
  verifyState(durable); lease.assertOwned();
  for (const change of durable.intent.commit.transaction.generated) {
    verifyState(durable); lease.assertOwned();
    const current = contained(cwd, change.path);
    if (change.before === null) {
      if (current !== null) fs.unlinkSync(path.join(cwd, change.path));
    } else if (current !== null && !current.equals(Buffer.from(change.before))) {
      const file = path.join(cwd, change.path), before = fs.lstatSync(file, { bigint: true });
      const fd = fs.openSync(file, fs.constants.O_RDWR | (fs.constants.O_NOFOLLOW ?? 0));
      try {
        const opened = fs.fstatSync(fd, { bigint: true });
        if (!opened.isFile() || opened.nlink !== 1n || opened.dev !== before.dev || opened.ino !== before.ino) fail('Generated path changed before restoring its preimage.');
        fs.ftruncateSync(fd, 0); fs.writeFileSync(fd, change.before); fs.fchmodSync(fd, change.beforeMode!); fs.fsyncSync(fd);
      } finally { fs.closeSync(fd); }
    }
  }
  verifyState(durable); removeLock(durable); verifyState(durable, true); lease.assertOwned();
}
function result(durable: Durable): PendingReconciliation {
  return { requestId: durable.intent.request.requestId, state: 'rolled-back', preservedPaths: durable.intent.commit.transaction.manifest.changes.map(c => c.path).sort(), limitations: ['Only recognized core-generated bytes were restored; caller edits and private evidence were preserved.', 'No commit, workflow execution, lifecycle outcome or execution proof was replayed or reconstructed.', 'Private index artifacts and recovery journals are retained; empty created directories may remain.'] };
}
/** Explicit action for the original prepared owner or an orphaned durable request. */
export async function reconcileWorkflowRecording(requestId: string, context: CoreContext): Promise<Result<PendingReconciliation>> {
  context = { ...context }; let state: PreparedState | undefined, reserved = false;
  try {
    if (!uuid.test(requestId) || !context.checkout || !path.isAbsolute(context.checkout) || !context.extensionId) fail('Reconciliation requires a request UUID, checkout and extension identity.', 'INVALID_EVIDENCE');
    const cwd = fs.realpathSync(context.checkout), durable = read(cwd, requestId), key = `${checkoutIdentity(cwd).gitDir}:${requestId}`;
    if (durable.intent.extensionId !== context.extensionId) fail('Pending request belongs to another extension.', 'STALE_STATE');
    try { state = assertPreparedIdentity(requestId, context); }
    catch (e) { if ((e as any)?.code !== 'STALE_STATE') throw e; }
    if (completed(durable.binding)) { verifyState(durable, true); return { protocol: 1, ok: true, value: result(durable), notices: [] }; }
    if (state) {
      if (state.leaseReleased) fail('Released preparation lacks matching completed recovery proof.');
      if (preparedActivity(requestId) !== 'idle' || state.cancellationPending) fail('Prepared workflow has an active phase or cancellation.', 'LOCKED');
      if (!same(state.lease.recoveryBinding(), durable.binding)) fail('Prepared lease differs from the durable prewrite binding.');
      if (!state.stopWorker) fail('Prepared host has no trusted stopped-worker acknowledgment port.', 'UNSUPPORTED_CAPABILITY');
      state.cancellationPending = true; reserved = true; state.cancellation.abort();
      if (context.signal?.aborted && context.signal !== state.context.signal) fail('Reconciliation cancelled before host stopping.', 'CANCELLED');
      const stopped = await state.stopWorker({ requestId, checkout: cwd });
      if (stopped?.stopped !== true || stopped.recoveryRequired !== false) fail('Prior host work remains unproved stopped; lease retained.');
      if (context.signal?.aborted && context.signal !== state.context.signal) fail('Reconciliation cancelled before restoring core files.', 'CANCELLED');
      assertPreparedIdentity(requestId, context); rollback(durable, state.lease); finishStoppedPreparation(requestId);
    } else {
      let entry = adopted.get(key);
      if (!entry) {
        inspectHostLeaseRecovery(durable.binding);
        if (!context.lifecycle?.stopWorkflow) fail('Orphan reconciliation needs trusted stopped-worker proof.', 'UNSUPPORTED_CAPABILITY');
        if (context.signal?.aborted) fail('Reconciliation cancelled before host stopping.', 'CANCELLED');
        const stopped = await context.lifecycle.stopWorkflow({ requestId, checkout: cwd });
        if (stopped?.stopped !== true || stopped.recoveryRequired !== false) fail('Prior host work remains unproved stopped; retained leases preserved.');
        if (context.signal?.aborted) fail('Reconciliation cancelled before lease adoption.', 'CANCELLED');
        const lease = recoverHostLease(durable.binding, () => verifyState(durable));
        entry = { durable, lease }; adopted.set(key, entry);
      }
      if (entry.durable.digest !== durable.digest || !same(entry.durable.binding, durable.binding)) fail('Adopted pending evidence changed.');
      rollback(durable, entry.lease); entry.lease.releaseStoppedHost(); adopted.delete(key);
    }
    return { protocol: 1, ok: true, value: result(durable), notices: [] };
  } catch (e) {
    const code = typeof (e as any)?.code === 'string' ? (e as any).code : 'RECOVERY_REQUIRED';
    return { protocol: 1, ok: false, error: { code, message: e instanceof Error ? e.message : String(e), retryable: code === 'LOCKED', details: null }, notices: [] };
  } finally { if (state && reserved) state.cancellationPending = false; }
}
