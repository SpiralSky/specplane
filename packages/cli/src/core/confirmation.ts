/** Internal confirmation primitive. Bindings come from core operation handlers, never wire input.
 * Host integration must supply a verified direct-human surface; a callback by itself is not certification.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Ajv } from 'ajv';
import type { ConfirmationChallenge, ConfirmationResponse, ClockPort, InteractionPort } from './contracts.js';
import { confirmationChallengeSchema, confirmationResponseSchema } from './schemas.js';
import { canonical, sha256 } from './workflow-preparation.js';
import { checkoutIdentity, type WriterLease } from './writer-leases.js';

export type DirectInteractionPort = InteractionPort;
/** Snapshot MUST include current HEAD/branch, index and affected file bytes, lifecycle,
 * policy/dependency state and destination refs. Reuse the operation's existing checks.
 * payload/evidence are exact reviewed content, not caller-provided digest claims.
 */
export interface ConfirmationSnapshot {
  targets: string[];
  summary: string;
  state: unknown;
  payload: unknown;
  evidence: unknown;
}
export interface ConfirmationBinding<T> {
  checkout: string;
  extensionId: string;
  operation: string;
  lease: WriterLease;
  snapshot(): ConfirmationSnapshot;
  /** Called synchronously after the final recheck and durable one-use invalidation.
   * An async handler must recheck state at its own later mutation boundary. */
  mutate(): T;
}
export class ConfirmationRefused extends Error {
  constructor(readonly code: 'INVALID_EVIDENCE' | 'STALE_STATE' | 'CONFIRMATION_REQUIRED' | 'CANCELLED' | 'RECOVERY_REQUIRED' | 'UNSUPPORTED_CAPABILITY', message: string) { super(message); }
}
interface Journal {
  version: 1;
  owner: { pid: number; generation: string; extensionId: string; commonDir: string; gitDir: string };
  challenge: ConfirmationChallenge;
  response: ConfirmationResponse | null;
  phase: 'displaying' | 'ready' | 'refused' | 'consuming' | 'completed';
}
const ajv = new Ajv();
const validChallenge = ajv.compile(confirmationChallengeSchema), validResponse = ajv.compile(confirmationResponseSchema);
const TTL = 15 * 60 * 1000;
const fail = (code: ConfirmationRefused['code'], message: string): never => { throw new ConfirmationRefused(code, message); };

/** Creates one core-owned decision, not reusable authorization for a category of operations.
 * The service retains the actual trusted response privately. A matching wire response alone
 * cannot establish authorization, and a new process cannot resume an uncertain mutation.
 * The caller retains responsibility for the lease lifetime, including recovery after failure.
 */
export function createConfirmation<T>(binding: ConfirmationBinding<T>, host: {
  interaction?: DirectInteractionPort;
  clock?: ClockPort;
  signal?: AbortSignal;
}) {
  // Capture callable references and identities; later caller property replacements grant nothing.
  const { checkout, extensionId, operation, lease } = binding;
  const snapshot = binding.snapshot.bind(binding), mutate = binding.mutate.bind(binding);
  const interaction = host.interaction?.confirm.bind(host.interaction);
  const now = host.clock ? host.clock.now.bind(host.clock) : () => new Date();
  const signal = host.signal;
  const identity = checkoutIdentity(checkout);
  if (!operation || !extensionId || !lease.keys.some(k => k.kind === 'checkout' && k.identity === identity.gitDir)) fail('INVALID_EVIDENCE', 'Confirmation requires the held checkout and an operation identity.');
  lease.assertOwned();
  const directory = path.join(identity.commonDir, 'specplane-runtime');
  // Bind the actual writer generation, not a separately invented ownership claim.
  const leaseFile = path.join(directory, `checkout-${sha256(identity.gitDir)}.json`);
  const leaseFd = fs.openSync(leaseFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  let generation: string;
  try {
    if (!fs.fstatSync(leaseFd).isFile()) fail('RECOVERY_REQUIRED', 'Nonregular writer lease.');
    generation = JSON.parse(fs.readFileSync(leaseFd, 'utf8')).generation;
    if (typeof generation !== 'string' || !generation) fail('RECOVERY_REQUIRED', 'Missing writer generation.');
  } finally { fs.closeSync(leaseFd); }
  lease.assertOwned();
  let journal: Journal | undefined, journalFile = '', expectedBytes = '', started = false;
  function guardDirectory() {
    const st = fs.lstatSync(directory);
    if (!st.isDirectory() || st.isSymbolicLink() || fs.realpathSync(directory) !== directory) fail('RECOVERY_REQUIRED', 'Confirmation runtime directory changed.');
  }
  function persist(initial = false) {
    guardDirectory();
    const bytes = canonical(journal);
    const fd = fs.openSync(journalFile, (initial ? fs.constants.O_CREAT | fs.constants.O_EXCL : 0) | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK, 0o600);
    try {
      if (!fs.fstatSync(fd).isFile()) fail('RECOVERY_REQUIRED', 'Nonregular confirmation journal.');
      fs.ftruncateSync(fd, 0); fs.writeFileSync(fd, bytes); fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    expectedBytes = bytes;
  }
  function verifyJournal() {
    guardDirectory();
    const fd = fs.openSync(journalFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      if (!fs.fstatSync(fd).isFile() || fs.readFileSync(fd, 'utf8') !== expectedBytes) fail('RECOVERY_REQUIRED', 'Confirmation journal changed; inspect before recovery.');
    } finally { fs.closeSync(fd); }
  }
  function live() {
    if (signal?.aborted) fail('CANCELLED', 'Confirmation cancelled.');
    const instant = now().getTime();
    if (!Number.isFinite(instant)) fail('INVALID_EVIDENCE', 'Invalid confirmation clock.');
    if (journal && instant >= Date.parse(journal.challenge.expiresAt)) fail('CONFIRMATION_REQUIRED', 'Confirmation expired.');
    if (canonical(checkoutIdentity(checkout)) !== canonical(identity)) fail('STALE_STATE', 'Confirmation checkout changed.');
    lease.assertOwned();
  }
  function digestSnapshot(value: ConfirmationSnapshot) {
    return { targets: structuredClone(value.targets), summary: value.summary, stateDigest: sha256(canonical(value.state)), payloadDigest: sha256(canonical(value.payload)), evidenceDigest: sha256(canonical(value.evidence)) };
  }
  function recheck() {
    live();
    const actual = digestSnapshot(snapshot());
    const wanted = journal!.challenge;
    if (canonical(actual) !== canonical({ targets: wanted.targets, summary: wanted.summary, stateDigest: wanted.stateDigest, payloadDigest: wanted.payloadDigest, evidenceDigest: wanted.evidenceDigest })) fail('STALE_STATE', 'Reviewed state, payload or evidence changed; display a new proposal.');
    live();
  }
  async function prepare(): Promise<ConfirmationChallenge> {
    if (started) fail('INVALID_EVIDENCE', 'This confirmation decision was already prepared.');
    started = true;
    if (!interaction) fail('CONFIRMATION_REQUIRED', 'A trusted direct-human interaction port is required.');
    live();
    const challenge: ConfirmationChallenge = {
      challengeId: randomUUID(), operation, ...digestSnapshot(snapshot()), expiresAt: new Date(now().getTime() + TTL).toISOString(),
    };
    if (!validChallenge(challenge)) fail('INVALID_EVIDENCE', 'Operation produced an invalid confirmation challenge.');
    journal = { version: 1, owner: { pid: process.pid, generation, extensionId, ...identity }, challenge, response: null, phase: 'displaying' };
    journalFile = path.join(directory, `confirmation-${challenge.challengeId}.json`);
    persist(true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      const displayed = structuredClone(challenge);
      Object.freeze(displayed.targets); Object.freeze(displayed);
      const response = await Promise.race([
        Promise.resolve().then(() => { live(); return interaction!(displayed); }),
        new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), TTL); }),
        new Promise<null>(resolve => { abort = () => resolve(null); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) resolve(null); }),
      ]);
      verifyJournal(); recheck();
      if (!validResponse(response) || response!.challengeId !== challenge.challengeId || response!.decision !== 'confirm') fail('CONFIRMATION_REQUIRED', 'Human confirmation was declined, unavailable or invalid.');
      journal.response = structuredClone(response!);
      journal.phase = 'ready'; persist();
      return structuredClone(challenge);
    } catch (error) {
      // Never overwrite a tampered journal, and never authorize after an uncertain interaction.
      if (journal) { verifyJournal(); journal.phase = 'refused'; persist(); }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      if (abort) signal?.removeEventListener('abort', abort);
    }
  }
  function confirm(challenge: ConfirmationChallenge, response: ConfirmationResponse, context: { checkout: string; extensionId: string }): T {
    if (!journal || journal.phase !== 'ready' || !validChallenge(challenge) || !validResponse(response)) fail('INVALID_EVIDENCE', 'No unconsumed trusted human response exists.');
    const record = journal!;
    if (context.extensionId !== extensionId || canonical(checkoutIdentity(context.checkout)) !== canonical(identity) || canonical(challenge) !== canonical(record.challenge) || canonical(response) !== canonical(record.response)) fail('INVALID_EVIDENCE', 'Confirmation does not match its trusted interaction and checkout.');
    verifyJournal();
    try { recheck(); } catch (error) { record.phase = 'refused'; persist(); throw error; }
    // Persist before invoking any operation: a crash or partial mutation cannot replay consent.
    record.phase = 'consuming'; persist();
    live();
    const result = mutate();
    record.phase = 'completed'; persist();
    return result;
  }
  return Object.freeze({ prepare, confirm, phase: () => journal?.phase ?? 'unprepared' });
}
