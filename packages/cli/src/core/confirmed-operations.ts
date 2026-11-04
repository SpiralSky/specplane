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
import { listWorktrees } from '../git/worktree.js';
import { abandonPlan, type AbandonPreview } from '../plan/flows.js';
import { loadAdrs } from '../decisions/validate.js';
import { withApprovalProjection } from '../commands/approval-read-tree.js';
import { readFrontmatter, renderStatus } from '../frontmatter.js';
import { mechanicalRequestSchema, confirmationChallengeSchema, confirmationResponseSchema } from './schemas.js';
import { acquireWriterLease, LeaseRefused, type WriterLease } from './writer-leases.js';
import { createConfirmation, ConfirmationRefused } from './confirmation.js';
import { workflowStateDigest } from './workflow-execution.js';
import { sha256, canonical } from './workflow-preparation.js';
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

type Change = { path: string; before: string | null; after: string };
function previewOperation(request: ApprovalRequest, id: string, root: string, config: Config, lease: WriterLease): Change[] {
  let changes: Change[] = [];
  if (request.operation === 'plan.approve') approvePlan(id, root, true, { lease, quiet: true, preview: value => { changes = value; } });
  else if (request.operation === 'spec.approve') approveSpec(id, config, root, true, true, value => { changes = value; });
  else {
    apply(request, id, root, config, lease, true);
    const file = targetFile(request, id, root, config), before = fs.readFileSync(file, 'utf8');
    changes = [{ path: contained(root, file), before, after: renderStatus(before, request.operation === 'spec.reopen' ? 'review' : 'accepted', file) }];
  }
  return changes;
}

function previewBatch(request: ApprovalRequest, ids: string[], root: string, config: Config, files: Record<string, string>): Change[][] {
  const head = run('git', ['rev-parse', 'HEAD'], { cwd: root }).trim();
  return withApprovalProjection(root, head, (tree, advance) => {
    // Git omits empty directories, including configured roots created by init.
    for (const [relative, value] of Object.entries(files)) if (value === 'directory' && !fs.existsSync(path.join(tree, relative))) fs.mkdirSync(path.join(tree, relative), { recursive: true });
    // Batch simulation uses committed policy/dependency bytes. Refuse hidden or ignored
    // working edits as well as ordinary dirt instead of approving a different snapshot.
    if (canonical(governedFiles(tree, config)) !== canonical(files)) refusal('INVALID_EVIDENCE', 'Batch approval requires committed governed inputs; commit or preserve those edits before retrying.');
    const owned = ids.map(id => contained(root, targetFile(request, id, root, config)));
    if (new Set(owned).size !== owned.length) refusal('INVALID_EVIDENCE', 'Approval targets must resolve to distinct files.');
    if (request.operation === 'plan.approve') owned.push(`${config.plans.dir}/PLANS.md`);
    for (const file of owned) {
      if (run('git', ['diff', '--cached', '--name-only', 'HEAD', '--', file], { cwd: root }).trim()) refusal('INVALID_EVIDENCE', `Approval target has staged changes: ${file}`);
    }
    const lease = acquireWriterLease({ repository: true, checkouts: [tree], plans: request.operation === 'plan.approve' ? ids : [], requestId: `preview-${randomUUID()}` });
    try {
      return ids.map(id => {
        const changes = previewOperation(request, id, tree, config, lease);
        advance(changes);
        return changes;
      });
    } finally { lease.release(); }
  }, { plans: config.plans.dir, decisions: config.decisions.dir, specs: config.spec_roots.map(r => r.path) });
}

/** Abandonment has its own decision and complete checkout lease set. */
async function prepareAbandon(request: Extract<MechanicalRequest, { operation: 'plan.abandon' }>, trusted: CoreContext): Promise<Result<ConfirmationChallenge>> {
  let lease: WriterLease | undefined;
  try {
    if (!trusted.interaction || typeof trusted.interaction.confirm !== 'function') refusal('CONFIRMATION_REQUIRED', 'A trusted direct-human interaction port is required.');
    if (!trusted.checkout || !trusted.extensionId) refusal('INVALID_EVIDENCE', 'Confirmation requires explicit checkout and extension identity.');
    // Destructive dirty-worktree removal needs a separate content review adapter.
    if (request.arguments.force) refusal('UNSUPPORTED_CAPABILITY', 'Trusted abandonment currently requires clean worktrees; forced removal has no content review adapter.');
    const root = fs.realpathSync(checkoutRoot(trusted.checkout));
    const trees = listWorktrees(root).filter(tree => !tree.bare);
    lease = acquireWriterLease({ repository: true, plans: [request.arguments.id], checkouts: trees.map(tree => tree.path), requestId: `confirmation-${randomUUID()}` });
    const held = lease;
    let reviewed: AbandonPreview | undefined;
    function snapshot() {
      held.assertOwned();
      if (canonical(listWorktrees(root).filter(tree => !tree.bare)) !== canonical(trees)) refusal('STALE_STATE', 'Abandonment checkout set changed; obtain fresh confirmation.');
      for (const tree of trees) if (hasRecoveryOperation(tree.path)) refusal('RECOVERY_REQUIRED', 'Abandonment refuses an unfinished Git operation.');
      const config = loadConfig(root).config;
      abandonPlan(request.arguments.id, config, root, { deleteBranch: request.arguments.deleteBranch, lease: held, preview: value => { reviewed = value; } });
      if (!reviewed) refusal('INVALID_EVIDENCE', 'Abandonment did not produce an exact preview.');
      const preview = reviewed!;
      const checkouts = trees.map(tree => ({ ...tree, state: workflowStateDigest(tree.path), files: governedFiles(tree.path, loadConfig(tree.path).config) }));
      return {
        targets: [request.arguments.id], payload: request,
        state: { checkouts, refs: run('git', ['for-each-ref', '--format=%(refname) %(objectname)'], { cwd: root }) },
        evidence: preview,
        summary: `plan.abandon ${request.arguments.id}\nTarget: ${preview.target} at ${preview.parent}\nTarget checkout: ${preview.checkout}\nArchive: ${preview.archive ? `${preview.archive.from} → ${preview.archive.to} (all other plan files move unchanged)` : 'none'}\nRemove clean worktree: ${preview.removeWorktree ?? 'none'}\nDelete branch: ${preview.deleteBranch ?? 'none'}\nPublish target: ${preview.publish}\n${preview.changes.map(change => `Exact change: ${change.path}\nBefore:\n${change.before ?? '(missing)'}\nAfter:\n${change.after ?? '(removed)'}`).join('\n')}`,
      };
    }
    const service = createConfirmation({ checkout: root, extensionId: trusted.extensionId, operation: request.operation, lease: held, snapshot,
      mutate() {
        if (trusted.signal?.aborted) refusal('CANCELLED', 'Abandonment cancelled before mutation.');
        held.assertOwned();
        const value = abandonPlan(request.arguments.id, loadConfig(root).config, root, { deleteBranch: request.arguments.deleteBranch, lease: held });
        held.assertOwned();
        return { operation: request.operation, targets: [request.arguments.id], head: run('git', ['rev-parse', 'HEAD'], { cwd: reviewed!.checkout }).trim(), notices: [{ code: 'PLAN_ABANDONED', message: `Abandoned ${value.planId}; worktree removed: ${value.worktreeRemoved}; branch deleted: ${value.branchDeleted}.` }] };
      },
    }, { interaction: trusted.interaction, clock: trusted.clock, signal: trusted.signal });
    const challenge = await service.prepare();
    const timer = setTimeout(() => {
      const entry = pending.get(challenge.challengeId);
      if (entry?.service.phase() === 'ready') { try { entry.lease.release(); pending.delete(challenge.challengeId); } catch { /* Retain uncertain ownership. */ } }
    }, 15 * 60 * 1000);
    timer.unref(); pending.set(challenge.challengeId, { service, lease: held, timer });
    return { protocol: 1, ok: true, value: challenge, notices: [] };
  } catch (e) {
    if (lease) { try { lease.release(); } catch (recovery) { return error(recovery); } }
    return error(e);
  }
}

/** The response is collected here through the embedding host, never accepted from initiation JSON. */
export async function prepareConfirmedOperation(input: MechanicalRequest, context: CoreContext): Promise<Result<ConfirmationChallenge>> {
  const trusted = { ...context };
  let lease: WriterLease | undefined;
  try {
    if (!validOperation(input)) refusal('INVALID_EVIDENCE', 'Invalid confirmation operation.');
    if (input.operation === 'plan.abandon') return prepareAbandon(structuredClone(input), trusted);
    if (!['spec.approve', 'spec.reopen', 'plan.approve', 'decision.accept'].includes(input.operation)) refusal('UNSUPPORTED_CAPABILITY', 'This operation has no confirmation adapter yet.');
    const request = structuredClone(input) as ApprovalRequest;
    const ids = request.operation === 'spec.reopen' ? [request.arguments.id] : request.arguments.ids;
    if (!ids.length || new Set(ids).size !== ids.length) refusal('INVALID_EVIDENCE', 'Approval requires distinct targets.');
    if (request.arguments.dryRun) refusal('UNSUPPORTED_CAPABILITY', 'A dry-run request cannot prepare mutation consent.');
    if (!context.interaction || typeof context.interaction.confirm !== 'function') refusal('CONFIRMATION_REQUIRED', 'A trusted direct-human interaction port is required.');
    if (!context.checkout || !context.extensionId) refusal('INVALID_EVIDENCE', 'Confirmation requires explicit checkout and extension identity.');
    if (context.signal?.aborted) refusal('CANCELLED', 'Confirmation cancelled.');
    const root = fs.realpathSync(checkoutRoot(trusted.checkout!)), id = ids[0];
    lease = acquireWriterLease({ checkouts: [root], repository: true, plans: request.operation === 'plan.approve' ? ids : [], requestId: `confirmation-${randomUUID()}` });
    const held = lease;
    let reviewed: Change[][] = [];
    function snapshot() {
      held.assertOwned();
      if (hasRecoveryOperation(root)) refusal('RECOVERY_REQUIRED', 'Approval refuses an unfinished Git operation.');
      const config = loadConfig(root).config;
      const files = governedFiles(root, config);
      const targets = ids.map(target => {
        const file = targetFile(request, target, root, config);
        return { id: target, path: contained(root, file), body: fs.readFileSync(file, 'utf8'), current: String(readFrontmatter(file).data.status) };
      });
      const next = request.operation === 'spec.reopen' ? 'review' : request.operation === 'plan.approve' ? 'ready' : request.operation === 'decision.accept' ? 'accepted' : 'approved';
      reviewed = ids.length > 1 ? previewBatch(request, ids, root, config, files) : [previewOperation(request, id, root, config, held)];
      const head = run('git', ['rev-parse', 'HEAD'], { cwd: root }).trim();
      const effects = request.operation === 'plan.approve' ? `Regenerate ${config.plans.dir}/PLANS.md and commit both files.` : request.operation === 'spec.approve' ? 'Commit this spec status change and any displayed base-pin refresh.' : request.operation === 'spec.reopen' ? 'Commit this spec and report dependent specs; dependants remain unchanged.' : 'Commit this decision record.';
      return {
        targets: ids, payload: request,
        state: { checkout: workflowStateDigest(root), branch: run('git', ['symbolic-ref', 'HEAD'], { cwd: root }).trim(), files },
        evidence: { validation: 'Existing operation policy checks passed', targets, next, effects, head, preview: reviewed },
        summary: `${request.operation} ${ids.join(', ')}\nRevision: ${head}\nApply in listed order; one commit per target. On failure, retain completed commits and stop.\n${effects}\n${targets.map((target, index) => `Target ${index + 1}: ${target.id}\nFile: ${target.path}\nStatus: ${target.current} → ${next}\nReviewed content:\n${target.body}${reviewed[index].map(change => `\nExact change: ${change.path}\nBefore:\n${change.before ?? '(missing)'}\nAfter:\n${change.after}`).join('')}`).join('\n')}`,

      };
    }
    const service = createConfirmation({ checkout: root, extensionId: trusted.extensionId, operation: request.operation, lease: held, snapshot,
      mutate() {
        if (trusted.signal?.aborted) refusal('CANCELLED', 'Confirmation cancelled before mutation.');
        const expected = structuredClone(reviewed);
        const config = loadConfig(root).config;
        const expectedFiles = governedFiles(root, config);
        const branch = run('git', ['symbolic-ref', 'HEAD'], { cwd: root }).trim();
        for (let index = 0; index < ids.length; index++) {
          if (trusted.signal?.aborted) refusal('CANCELLED', 'Approval batch cancelled; inspect any completed commits.');
          held.assertOwned();
          if (canonical(previewOperation(request, ids[index], root, config, held)) !== canonical(expected[index])) refusal('STALE_STATE', 'Approval batch preview changed; retain completed commits and obtain fresh confirmation.');
          const paths = expected[index].map(change => change.path).sort();
          const otherIndex = () => run('git', ['ls-files', '--stage', '-z'], { cwd: root }).split('\0').filter(entry => entry && !paths.includes(entry.slice(entry.indexOf('\t') + 1))).join('\0');
          const indexBefore = otherIndex();
          const before = run('git', ['rev-parse', 'HEAD'], { cwd: root }).trim();
          apply(request, ids[index], root, config, held, false);
          held.assertOwned();
          const after = run('git', ['rev-parse', 'HEAD'], { cwd: root }).trim();
          if (run('git', ['symbolic-ref', 'HEAD'], { cwd: root }).trim() !== branch) refusal('RECOVERY_REQUIRED', 'Approval branch changed; inspect retained commits.');
          if (otherIndex() !== indexBefore) refusal('RECOVERY_REQUIRED', 'Unrelated staging changed during approval; inspect retained commits.');
          if (run('git', ['rev-list', '--parents', '-n', '1', after], { cwd: root }).trim() !== `${after} ${before}` || canonical(run('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', after], { cwd: root }).split('\0').filter(Boolean).sort()) !== canonical(paths)) refusal('RECOVERY_REQUIRED', 'Approval commit changed unexpectedly; retain completed commits for inspection.');
          for (const change of expected[index]) {
            const mode = expectedFiles[change.path]?.split(':')[0] ?? String(0o666 & ~process.umask());
            expectedFiles[change.path] = `${mode}:${sha256(change.after)}`;
            if (run('git', ['show', `${after}:${change.path}`], { cwd: root }) !== change.after || fs.readFileSync(path.join(root, change.path), 'utf8') !== change.after) refusal('RECOVERY_REQUIRED', 'Approval bytes differ from reviewed content; inspect the retained commit.');
          }
          if (canonical(governedFiles(root, config)) !== canonical(expectedFiles)) refusal('RECOVERY_REQUIRED', 'Governed inputs changed during approval; inspect completed commits before continuing.');
        }
        held.assertOwned();
        const notices = request.operation === 'spec.reopen' ? reopenDependants(id, loadConfig(root).config, root).map(message => ({ code: 'SPEC_DEPENDANT', message })) : [];
        return { operation: request.operation, targets: ids, head: run('git', ['rev-parse', 'HEAD'], { cwd: root }).trim(), notices };
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
