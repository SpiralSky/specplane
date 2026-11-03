/** Approval adapters own operation inputs and retain their writer lease through human review. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { lazyValidator } from '../lazy-validator.js';
import { loadConfig } from '../config.js';
import { checkoutRoot } from '../git/repo.js';
import { run } from '../git/exec.js';
import { hasRecoveryOperation } from '../generate/snapshot.js';
import { approveSpec, reopenSpec, reopenDependants } from '../commands/spec-approve.js';
import { approvePlan } from '../commands/plan-approve.js';
import { acceptDecision } from '../commands/decision.js';
import { resolveSpecId } from '../spec/resolve.js';
import { planDir } from '../plan/resolve.js';
import { loadAdrs } from '../decisions/validate.js';
import { readFrontmatter } from '../frontmatter.js';
import { mechanicalRequestSchema, confirmationChallengeSchema, confirmationResponseSchema } from './schemas.js';
import { acquireWriterLease, LeaseRefused, type WriterLease } from './writer-leases.js';
import { createConfirmation, ConfirmationRefused } from './confirmation.js';
import { workflowStateDigest } from './workflow-execution.js';
import { sha256 } from './workflow-preparation.js';
import type { ConfirmationChallenge, ConfirmationResponse, CoreContext, MechanicalRequest, Result, Notice } from './contracts.js';
import type { Config } from '../types.js';

export interface ConfirmedOperationReceipt { operation: string; targets: string[]; head: string; notices: Notice[] }
type ApprovalRequest = Extract<MechanicalRequest, { operation: 'spec.approve' | 'spec.reopen' | 'plan.approve' | 'decision.accept' }>;
const validOperation = lazyValidator(mechanicalRequestSchema), validChallenge = lazyValidator(confirmationChallengeSchema), validResponse = lazyValidator(confirmationResponseSchema);
const pending = new Map<string, { service: ReturnType<typeof createConfirmation<ConfirmedOperationReceipt>>; lease: WriterLease; timer: ReturnType<typeof setTimeout> }>();
function refusal(code: ConfirmationRefused['code'], message: string): never { throw new ConfirmationRefused(code, message); }
function error<T>(e: unknown): Result<T> {
  return { protocol: 1, ok: false, error: { code: e instanceof ConfirmationRefused || e instanceof LeaseRefused ? e.code : 'OPERATION_FAILED', message: e instanceof Error ? e.message : String(e), retryable: e instanceof LeaseRefused && e.code === 'LOCKED', details: null }, notices: [] };
}
function contained(root: string, file: string): string {
  const rel = path.relative(root, path.resolve(root, file));
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) refusal('INVALID_EVIDENCE', 'Approval inputs must stay inside the checkout.');
  let current = root;
  for (const part of rel.split(path.sep)) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) refusal('INVALID_EVIDENCE', 'Approval inputs cannot use symbolic links.'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') break; throw e; }
  }
  return rel.split(path.sep).join('/');
}
function governedFiles(root: string, config: Config): Record<string, string> {
  const files: Record<string, string> = {};
  function visit(file: string) {
    const relative = contained(root, file);
    let st: fs.Stats;
    try { st = fs.lstatSync(file); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') { files[relative] = 'missing'; return; } throw e; }
    if (st.isDirectory()) { files[relative] = 'directory'; for (const name of fs.readdirSync(file).sort()) visit(path.join(file, name)); }
    else if (st.isFile()) {
      if (st.nlink !== 1) refusal('INVALID_EVIDENCE', 'Approval inputs cannot use hard links.');
      files[relative] = `${st.mode & 0o777}:${sha256(fs.readFileSync(file))}`;
    }
    else refusal('INVALID_EVIDENCE', 'Nonregular approval input.');
  }
  for (const directory of [...config.spec_roots.map(r => r.path), config.plans.dir, config.decisions.dir]) visit(path.resolve(root, directory));
  visit(path.join(root, '.specplane/config.yaml'));
  return files;
}
function targetFile(request: ApprovalRequest, id: string, root: string, config: Config): string {
  if (request.operation === 'spec.approve' || request.operation === 'spec.reopen') return resolveSpecId(id, config, undefined, root).path;
  if (request.operation === 'plan.approve') return path.join(planDir(id, config, root), 'PLAN.md');
  const normalized = /^\d{4}$/.test(id) ? `decision/${id}` : id;
  const adr = loadAdrs(config, root).adrs.find(a => a.frontmatter.id === normalized);
  if (!adr) refusal('INVALID_EVIDENCE', `Decision not found: ${id}`);
  return adr!.file;
}
function apply(request: ApprovalRequest, id: string, root: string, config: Config, lease: WriterLease, dryRun: boolean) {
  lease.assertOwned();
  if (request.operation === 'spec.approve') approveSpec(id, config, root, dryRun, true);
  else if (request.operation === 'spec.reopen') reopenSpec(id, config, root, dryRun, true);
  else if (request.operation === 'plan.approve') approvePlan(id, root, dryRun, { lease, quiet: true });
  else acceptDecision(id, config, root, dryRun, true);
}

/** The response is collected here through the embedding host, never accepted from initiation JSON. */
export async function prepareConfirmedOperation(input: MechanicalRequest, context: CoreContext): Promise<Result<ConfirmationChallenge>> {
  const trusted = { ...context };
  let lease: WriterLease | undefined;
  try {
    if (!validOperation(input)) refusal('INVALID_EVIDENCE', 'Invalid confirmation operation.');
    if (!['spec.approve', 'spec.reopen', 'plan.approve', 'decision.accept'].includes(input.operation)) refusal('UNSUPPORTED_CAPABILITY', 'This operation has no confirmation adapter yet.');
    const request = structuredClone(input) as ApprovalRequest;
    const ids = request.operation === 'spec.reopen' ? [request.arguments.id] : request.arguments.ids;
    if (ids.length !== 1) refusal('UNSUPPORTED_CAPABILITY', 'Approval currently requires one target per confirmation challenge.');
    if (request.arguments.dryRun) refusal('UNSUPPORTED_CAPABILITY', 'A dry-run request cannot prepare mutation consent.');
    if (!context.interaction || typeof context.interaction.confirm !== 'function') refusal('CONFIRMATION_REQUIRED', 'A trusted direct-human interaction port is required.');
    if (!context.checkout || !context.extensionId) refusal('INVALID_EVIDENCE', 'Confirmation requires explicit checkout and extension identity.');
    if (context.signal?.aborted) refusal('CANCELLED', 'Confirmation cancelled.');
    const root = fs.realpathSync(checkoutRoot(trusted.checkout!)), id = ids[0];
    lease = acquireWriterLease({ checkouts: [root], repository: true, plans: request.operation === 'plan.approve' ? [id] : [], requestId: `confirmation-${randomUUID()}` });
    const held = lease;
    function snapshot() {
      held.assertOwned();
      if (hasRecoveryOperation(root)) refusal('RECOVERY_REQUIRED', 'Approval refuses an unfinished Git operation.');
      const config = loadConfig(root).config;
      const files = governedFiles(root, config);
      const file = targetFile(request, id, root, config), rel = contained(root, file);
      const body = fs.readFileSync(file, 'utf8'), frontmatter = readFrontmatter(file).data, current = String(frontmatter.status);
      if (request.operation === 'spec.approve' && frontmatter.extends !== undefined) refusal('UNSUPPORTED_CAPABILITY', 'Overlay approval requires an exact pin-change preview; use the manual CLI for this variant.');
      const next = request.operation === 'spec.reopen' ? 'review' : request.operation === 'plan.approve' ? 'ready' : request.operation === 'decision.accept' ? 'accepted' : 'approved';
      let preview: { path: string; before: string | null; after: string }[] = [];
      if (request.operation === 'plan.approve') approvePlan(id, root, true, { lease: held, quiet: true, preview: changes => { preview = changes; } });
      else apply(request, id, root, config, held, true);
      const head = run('git', ['rev-parse', 'HEAD'], { cwd: root }).trim();
      const effects = request.operation === 'plan.approve' ? `Regenerate ${config.plans.dir}/PLANS.md and commit both files.` : request.operation === 'spec.approve' ? 'Commit this spec status change.' : request.operation === 'spec.reopen' ? 'Commit this spec and report dependent specs; dependants remain unchanged.' : 'Commit this decision record.';
      return {
        targets: [id], payload: request,
        state: { checkout: workflowStateDigest(root), branch: run('git', ['symbolic-ref', 'HEAD'], { cwd: root }).trim(), files },
        evidence: { validation: 'Existing operation policy checks passed', target: rel, current, next, effects, head, body, preview },
        summary: `${request.operation} ${id}\nRevision: ${head}\nFile: ${rel}\nStatus: ${current} → ${next}\n${effects}\nReviewed content:\n${body}${preview.map(change => `\nExact change: ${change.path}\nBefore:\n${change.before ?? '(missing)'}\nAfter:\n${change.after}`).join('')}`,
      };
    }
    const service = createConfirmation({ checkout: root, extensionId: trusted.extensionId, operation: request.operation, lease: held, snapshot,
      mutate() {
        if (trusted.signal?.aborted) refusal('CANCELLED', 'Confirmation cancelled before mutation.');
        apply(request, id, root, loadConfig(root).config, held, false);
        held.assertOwned();
        const notices = request.operation === 'spec.reopen' ? reopenDependants(id, loadConfig(root).config, root).map(message => ({ code: 'SPEC_DEPENDANT', message })) : [];
        return { operation: request.operation, targets: [id], head: run('git', ['rev-parse', 'HEAD'], { cwd: root }).trim(), notices };
      },
    }, { interaction: trusted.interaction, clock: trusted.clock, signal: trusted.signal });
    const challenge = await service.prepare();
    const timer = setTimeout(() => {
      const entry = pending.get(challenge.challengeId);
      if (entry?.service.phase() === 'ready') { try { entry.lease.release(); pending.delete(challenge.challengeId); } catch { /* Retain ownership uncertainty for inspection. */ } }
    }, 15 * 60 * 1000);
    timer.unref();
    pending.set(challenge.challengeId, { service, lease: held, timer });
    return { protocol: 1, ok: true, value: challenge, notices: [] };
  } catch (e) {
    if (lease) { try { lease.release(); } catch (recovery) { return error(recovery); } }
    return error(e);
  }
}

export function confirmConfirmedOperation(challenge: ConfirmationChallenge, response: ConfirmationResponse, context: CoreContext): Result<ConfirmedOperationReceipt> {
  if (!validChallenge(challenge) || !validResponse(response) || !context.checkout || !context.extensionId) return error(new ConfirmationRefused('INVALID_EVIDENCE', 'Invalid confirmation request.'));
  const entry = pending.get(challenge.challengeId);
  if (!entry) return error(new ConfirmationRefused('INVALID_EVIDENCE', 'No unconsumed response from a trusted interaction exists.'));
  try {
    if (context.signal?.aborted) refusal('CANCELLED', 'Confirmation cancelled.');
    const value = entry.service.confirm(challenge, response, { checkout: context.checkout, extensionId: context.extensionId });
    entry.lease.release(); clearTimeout(entry.timer); pending.delete(challenge.challengeId);
    return { protocol: 1, ok: true, value, notices: value.notices };
  } catch (e) {
    if (entry.service.phase() === 'refused') {
      try { entry.lease.release(); clearTimeout(entry.timer); pending.delete(challenge.challengeId); } catch (recovery) { return error(recovery); }
    }
    return error(e);
  }
}
