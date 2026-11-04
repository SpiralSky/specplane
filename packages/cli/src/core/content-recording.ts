/** Private exact-set commit transaction. Content policy and human approval belong to its caller. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { run } from '../git/exec.js';
import { assertRecordingPaths, validateRecordingSet, type RecordingSet } from '../plan/recording-set.js';
import { checkoutIdentity, type WriterLease } from './writer-leases.js';
import type { RecoveryTransaction } from './pending-recovery.js';

export interface ContentRecording {
  manifest: RecordingSet;
  generated: { path: string; before: string | null; after: string }[];
  /** Dedicated contained scaffolds use exclusive mode 0600 (subject to umask). */
  creation?: { files: { path: string; scaffold: string }[]; apply(): void };
  message: string;
  beforeWrite?: (intent: { tree: string; message: string; head: string; branch: string; transaction: RecoveryTransaction }) => void;
  beforeCommit?: (intent: { tree: string; message: string; head: string; branch: string }) => void;
}
const hash = (content: Buffer | string) => createHash('sha256').update(content).digest('hex');
function refuse(code: string, message: string): never { throw Object.assign(new Error(message), { code }); }
function equal(a: Buffer | null, b: Buffer | null): boolean { return a === null ? b === null : b !== null && a.equals(b); }

export function recordContent(input: ContentRecording, root: string, lease: WriterLease): { commit: string } {
  const optionalLocks = process.env.GIT_OPTIONAL_LOCKS;
  process.env.GIT_OPTIONAL_LOCKS = '0';
  try { return commitContent(input, root, lease); }
  finally {
    if (optionalLocks === undefined) delete process.env.GIT_OPTIONAL_LOCKS;
    else process.env.GIT_OPTIONAL_LOCKS = optionalLocks;
  }
}

function commitContent(input: ContentRecording, root: string, lease: WriterLease): { commit: string } {
  const manifest = structuredClone(input.manifest), generated = structuredClone(input.generated), beforeCommit = input.beforeCommit;
  const creation = input.creation ? { files: structuredClone(input.creation.files), apply: input.creation.apply } : undefined;
  if (!input.message.trim() || input.message.includes('\0')) refuse('INVALID_EVIDENCE', 'A nonempty commit message without NUL is required.');
  const message = input.message.endsWith('\n') ? input.message : input.message + '\n';
  lease.assertOwned();
  const identity = checkoutIdentity(root);
  if (!lease.keys.some(key => key.kind === 'checkout' && key.identity === identity.gitDir)) refuse('STALE_STATE', 'Content recording requires the checkout writer lease.');
  const generatedPaths = generated.map(change => change.path);
  if (new Set(generatedPaths).size !== generatedPaths.length) refuse('INVALID_EVIDENCE', 'Duplicate generated content paths.');
  if (!manifest.changes.length && !generated.length) refuse('INVALID_EVIDENCE', 'Content recording requires an actual file change.');
  if (creation && (typeof creation.apply !== 'function' || new Set(creation.files.map(file => file.path)).size !== creation.files.length || creation.files.some(file => typeof file.scaffold !== 'string' || !generated.some(change => change.path === file.path && change.before === null)))) refuse('INVALID_EVIDENCE', 'Creation scaffolds must identify distinct generated new files.');
  const reasons = manifest.changes.map(change => `${change.path}:${change.purpose}`);
  const cleanGenerated = generatedPaths.filter(file => !manifest.changes.some(change => change.path === file));
  const bytes = (file: string): Buffer | null => {
    try { const stat = fs.lstatSync(file); return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 ? fs.readFileSync(file) : null; }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
  };
  const mode = (file: string): number | null => { try { return fs.lstatSync(file).mode & 0o777; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; } };
  const verifyPrepared = () => {
    lease.assertOwned();
    validateRecordingSet(manifest, root, null, cleanGenerated, reasons, 'done');
    assertRecordingPaths(root, generatedPaths);
    for (const change of generated) {
      const current = bytes(path.join(root, change.path));
      if ((change.before !== null && typeof change.before !== 'string') || typeof change.after !== 'string' || change.before === change.after ||
          !equal(current, change.before === null ? null : Buffer.from(change.before)) || (change.before === null && fs.existsSync(path.join(root, change.path)))) refuse('STALE_STATE', `Generated content preimage changed: ${change.path}`);
      const reviewed = manifest.changes.find(entry => entry.path === change.path);
      if (change.before === null) {
        if (reviewed || run('git', ['ls-tree', '-z', manifest.head, '--', change.path], { cwd: root })) refuse('STALE_STATE', `Generated new file already exists in reviewed history: ${change.path}`);
      } else if (reviewed ? reviewed.afterDigest !== hash(change.before) : !run('git', ['show', `${manifest.head}:${change.path}`], { cwd: root, binary: true }).equals(Buffer.from(change.before))) refuse('STALE_STATE', `Generated content differs from reviewed bytes: ${change.path}`);
    }
  };
  verifyPrepared();
  const complete: RecordingSet = { ...manifest, changes: manifest.changes.map(change => {
    const replacement = generated.find(entry => entry.path === change.path);
    return replacement ? { ...change, afterDigest: hash(replacement.after) } : change;
  }) };
  for (const change of generated.filter(entry => cleanGenerated.includes(entry.path))) complete.changes.push({ path: change.path, beforeDigest: change.before === null ? 'missing' : hash(change.before), afterDigest: hash(change.after), purpose: 'generated content and contribution metadata' });
  const completeReasons = complete.changes.map(change => `${change.path}:${change.purpose}`);
  const reviewedIndexDigests = new Map(manifest.changes.map(change => [change.path, change.afterDigest]));
  const indexFile = path.join(identity.gitDir, 'index'), indexLock = indexFile + '.lock';
  const temporaryIndex = path.join(identity.gitDir, `specplane-content-${randomUUID()}.index`);
  const indexBefore = bytes(indexFile);
  const privateGit = (...args: string[]): string => execFileSync('git', args, {
    cwd: root, encoding: 'utf8', env: { ...process.env, GIT_INDEX_FILE: temporaryIndex },
    stdio: [args[0] === 'commit' ? 'pipe' : 'ignore', 'pipe', 'pipe'], ...(args[0] === 'commit' ? { input: message } : {}),
  }).trim();
  const blob = (content: string) => execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: root, input: content, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  let generatedWritten = false, committed = false, recovery = false, recordedHead: string | undefined;
  let lockIdentity: fs.Stats | undefined;
  let planned: RecoveryTransaction['generated'] = [];
  const lock = fs.openSync(indexLock, 'wx', 0o600);
  const ownsEmptyLock = (): boolean => {
    try {
      const current = fs.lstatSync(indexLock), opened = fs.fstatSync(lock);
      return !!lockIdentity && current.isFile() && !current.isSymbolicLink() && current.nlink === 1 &&
        current.dev === lockIdentity.dev && current.ino === lockIdentity.ino && opened.dev === current.dev && opened.ino === current.ino && opened.size === 0;
    } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; }
  };
  try {
    lockIdentity = fs.fstatSync(lock);
    if (!equal(bytes(indexFile), indexBefore)) refuse('RECOVERY_REQUIRED', 'Content index changed before recording.');
    verifyPrepared();
    privateGit('read-tree', 'HEAD');
    if (manifest.changes.length) privateGit('--literal-pathspecs', 'add', '--', ...manifest.changes.map(change => change.path));
    planned = generated.map(change => ({ ...change, beforeMode: change.before === null ? null : mode(path.join(root, change.path)), afterMode: mode(path.join(root, change.path)) ?? ((creation?.files.some(file => file.path === change.path) ? 0o600 : 0o666) & ~process.umask()) }));
    for (const change of planned) privateGit('update-index', '--add', '--cacheinfo', change.afterMode & 0o111 ? '100755' : '100644', blob(change.after), change.path);
    const expectedTree = privateGit('write-tree');
    const lockStat = fs.fstatSync(lock, { bigint: true });
    const transaction: RecoveryTransaction = { manifest, generated: planned, indexBeforeDigest: indexBefore === null ? 'missing' : hash(indexBefore), temporaryIndexBasename: path.basename(temporaryIndex), indexLock: { dev: String(lockStat.dev), ino: String(lockStat.ino) }, ...(creation ? { creation: { files: creation.files } } : {}) };
    input.beforeWrite?.({ tree: expectedTree, message, head: manifest.head, branch: manifest.branch, transaction });
    verifyPrepared();
    if (!ownsEmptyLock() || !equal(bytes(indexFile), indexBefore) || privateGit('write-tree') !== expectedTree || planned.some(change => mode(path.join(root, change.path)) !== change.beforeMode)) refuse('RECOVERY_REQUIRED', 'Content index, lock or generated modes changed before writes.');
    generatedWritten = true;
    creation?.apply();
    for (const change of generated) {
      const file = path.join(root, change.path), scaffold = creation?.files.find(entry => entry.path === change.path);
      assertRecordingPaths(root, [change.path]);
      if (change.before === null) {
        if (scaffold) { if (!equal(bytes(file), Buffer.from(scaffold.scaffold))) refuse('RECOVERY_REQUIRED', `Creation scaffold differs from its prepared bytes: ${change.path}`); }
        else if (fs.existsSync(file)) refuse('RECOVERY_REQUIRED', `Generated new path appeared before write: ${change.path}`);
      } else if (!equal(bytes(file), Buffer.from(change.before))) refuse('RECOVERY_REQUIRED', `Generated preimage changed during creation: ${change.path}`);
      fs.writeFileSync(file, change.after, change.before === null && !scaffold ? { flag: 'wx' } : undefined);
    }
    const verifyFinal = () => {
      lease.assertOwned();
      validateRecordingSet(complete, root, null, [], completeReasons, 'done', reviewedIndexDigests);
      for (const change of planned) if (mode(path.join(root, change.path)) !== change.afterMode) refuse('RECOVERY_REQUIRED', `Generated file mode changed: ${change.path}`);
      if (!ownsEmptyLock() || !equal(bytes(indexFile), indexBefore) || privateGit('write-tree') !== expectedTree || privateGit('diff', '--name-only', '--no-ext-diff', '--')) refuse('RECOVERY_REQUIRED', 'Content index, lock or intended worktree changed before commit.');
    };
    verifyFinal();
    beforeCommit?.({ tree: expectedTree, message, head: manifest.head, branch: manifest.branch });
    verifyFinal();
    privateGit('commit', '--cleanup=verbatim', '-F', '-');
    committed = true;
    lease.assertOwned();
    recordedHead = run('git', ['rev-parse', 'HEAD'], { cwd: root }).trim();
    const object = run('git', ['cat-file', 'commit', recordedHead], { cwd: root, binary: true });
    const body = object.subarray(object.indexOf(Buffer.from('\n\n')) + 2);
    if (!body.equals(Buffer.from(message)) || run('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root }).trim() !== expectedTree ||
        run('git', ['rev-list', '--parents', '-n', '1', recordedHead], { cwd: root }).trim() !== `${recordedHead} ${manifest.head}` ||
        run('git', ['branch', '--show-current'], { cwd: root }).trim() !== manifest.branch ||
        privateGit('write-tree') !== expectedTree || privateGit('status', '--porcelain=v1', '--untracked-files=all') ||
        !equal(bytes(indexFile), indexBefore) || run('git', ['rev-parse', 'HEAD'], { cwd: root }).trim() !== recordedHead) refuse('RECOVERY_REQUIRED', 'Committed content differs from the reviewed tree, message or checkout state.');
    if (!ownsEmptyLock()) refuse('RECOVERY_REQUIRED', 'Content index lock ownership or contents changed.');
    fs.writeFileSync(lock, fs.readFileSync(temporaryIndex));
    fs.renameSync(indexLock, indexFile);
    return { commit: recordedHead };
  } catch (e) {
    if (committed || run('git', ['rev-parse', 'HEAD'], { cwd: root }).trim() !== manifest.head || !equal(bytes(indexFile), indexBefore) || !ownsEmptyLock()) recovery = true;
    if (generatedWritten && !recovery) {
      try { assertRecordingPaths(root, generatedPaths); if (planned.some(change => ![change.beforeMode, change.afterMode].includes(mode(path.join(root, change.path))))) recovery = true; }
      catch { recovery = true; }
    }
    if (generatedWritten && !recovery) for (const change of generated) {
      const file = path.join(root, change.path), current = bytes(file), scaffold = creation?.files.find(entry => entry.path === change.path);
      if (change.before === null) {
        if (current === null && !fs.existsSync(file)) continue;
        if (equal(current, Buffer.from(change.after)) || (scaffold && equal(current, Buffer.from(scaffold.scaffold)))) fs.unlinkSync(file);
        else recovery = true;
      } else if (equal(current, Buffer.from(change.after))) fs.writeFileSync(file, change.before);
      else if (!equal(current, Buffer.from(change.before))) recovery = true;
    }
    if (recovery) refuse('RECOVERY_REQUIRED', `Content recording requires reconciliation; changes were preserved${recordedHead ? ` at commit ${recordedHead}` : ''}. Private index retained at ${temporaryIndex}. Original error: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  } finally {
    const removableLock = ownsEmptyLock();
    fs.closeSync(lock);
    if (removableLock) fs.unlinkSync(indexLock);
    if (!recovery) fs.rmSync(temporaryIndex, { force: true });
  }
}
