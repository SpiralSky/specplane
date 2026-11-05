/**
 * The `separate` check (architecture/reference-cli § Verification policy): a read-only `verify-review` request tied to a
 * parent plan-step request, answered by a reviewer that is not the worker. Core stores the verdict as a private artifact
 * bound to the checkout state digest and records the check from that artifact alone. The reviewer's session identity is
 * what the host reports; core records it as a claim about independence and does not prove it.
 *
 * Nothing here takes a lease: the parent request's writer lease already covers the checkout, and the review edits nothing.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { lazyValidator } from '../lazy-validator.js';
import { run } from '../git/exec.js';
import { readContainedFile, withContainedDirectory } from './contained-files.js';
import { assertPrepared, canonical, sha256 } from './workflow-preparation.js';
import { workflowStateDigest } from './workflow-execution.js';
import { clearVerificationCheck, recordVerificationCheck } from './verification.js';
import { checkoutIdentity } from './writer-leases.js';
import type { CoreContext, Result } from './contracts.js';

/** What a reviewer returns for a `verify-review` request: closed, with bounded findings. */
const validResult = lazyValidator({ type: 'object', properties: { verdict: { enum: ['pass', 'fail'] }, findings: { type: 'array', maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 2000 } } }, required: ['verdict', 'findings'], additionalProperties: false });
class Refusal extends Error { constructor(readonly code: string, message: string) { super(message); } }
const fail = (code: string, message: string): never => { throw new Refusal(code, message); };
const failure = (e: unknown): Result<never> => ({ protocol: 1, ok: false, error: { code: typeof (e as { code?: unknown })?.code === 'string' ? (e as Refusal).code : 'INVALID_EVIDENCE', message: e instanceof Error ? e.message : String(e), retryable: false, details: null }, notices: [] });

/** Characters of diff a review request carries; the reviewer reads the files in the checkout for the rest. */
export const REVIEW_DIFF_CHARS = 6000;

export interface VerifyReviewRequest {
  protocol: 1;
  requestId: string;
  workflow: 'verify-review';
  parentRequestId: string;
  extensionId: string;
  checkout: string;
  /** The checkout state the verdict will be bound to. */
  stateDigest: string;
  readOnly: true;
  allowedEditPaths: [];
  scope: { planId: string; step: number; specIds: string[] };
  /** The step's bound spec and step files, with their digests: the reviewer reads them from the checkout. */
  context: { path: string; anchor?: string; digest: string }[];
  criteria: { id: string; text: string }[];
  changedPaths: string[];
  diff: string;
  diffTruncated: boolean;
  /** What the reviewer must answer with, and nothing else. */
  resultFormat: '{"verdict":"pass"|"fail","findings":["one finding per string"]}';
}
export interface VerifyReviewResult { verdict: 'pass' | 'fail'; findings: string[] }
export interface VerifyReviewReceipt { reviewId: string; parentRequestId: string; verdict: 'pass' | 'fail'; findings: number; stateDigest: string; satisfied: boolean }

interface Issued { parentRequestId: string; stateDigest: string; workerSession: string; requestDigest: string; extensionId: string; checkout: string }
interface Recorded { reviewId: string; artifactDigest: string; stateDigest: string; verdict: 'pass' | 'fail'; findings: string[]; reviewerSession: string; workerSession: string }
/** Process-local, like every other prepared and validated state in core. A restarted server holds none, so no review survives it. */
const issued = new Map<string, Issued>();
const recorded = new Map<string, Recorded>();

const artifactDirectory = (parent: string) => `specplane-runtime/workflows/${parent}`;
const artifactName = (reviewId: string) => `review-${reviewId}.json`;

function diffOf(cwd: string): { changedPaths: string[]; diff: string; truncated: boolean } {
  const tracked = run('git', ['diff', 'HEAD', '--no-ext-diff', '--no-color'], { cwd });
  const untracked = run('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd, binary: true }).toString().split('\0').filter(Boolean).sort();
  const changed = run('git', ['diff', 'HEAD', '--name-only', '-z'], { cwd, binary: true }).toString().split('\0').filter(Boolean);
  let diff = tracked;
  for (const name of untracked) {
    if (diff.length > REVIEW_DIFF_CHARS) break;
    let body = '';
    try { const file = path.join(cwd, name); if (fs.lstatSync(file).isFile()) body = fs.readFileSync(file, 'utf8'); } catch { body = ''; }
    diff += `\n--- /dev/null\n+++ b/${name}\n${body.split('\n').map(line => `+${line}`).join('\n')}\n`;
  }
  return { changedPaths: [...new Set([...changed, ...untracked])].sort(), diff: diff.slice(0, REVIEW_DIFF_CHARS), truncated: diff.length > REVIEW_DIFF_CHARS };
}

/**
 * Prepares a read-only review of the parent's current checkout state. The inputs are the step's spec context, criteria and
 * diff; the working conversation is not among them. `workerSession` is the identity the host reports for the worker.
 */
export async function prepareVerifyReview(input: { requestId: string; workerSession: string }, context: CoreContext): Promise<Result<VerifyReviewRequest>> {
  try {
    if (typeof input.workerSession !== 'string' || !input.workerSession.trim()) fail('INVALID_EVIDENCE', 'A review needs the worker session identity the host reports, so a reviewer can be told apart from it.');
    const state = await assertPrepared(input.requestId, context);
    const parent = state.request;
    if (parent.workflow !== 'plan-step') fail('POLICY_DENIED', 'Only a plan-step request can be reviewed.');
    if (state.leaseReleased) fail('STALE_STATE', 'The request is no longer open.');
    const stateDigest = workflowStateDigest(parent.checkout);
    const { changedPaths, diff, truncated } = diffOf(parent.checkout);
    const request: VerifyReviewRequest = {
      protocol: 1, requestId: randomUUID(), workflow: 'verify-review', parentRequestId: parent.requestId, extensionId: parent.extensionId, checkout: parent.checkout,
      stateDigest, readOnly: true, allowedEditPaths: [],
      scope: { planId: parent.scope.planId!, step: parent.scope.step!, specIds: [...parent.scope.specIds] },
      context: parent.context.filter(entry => !entry.path.startsWith('.specplane/')).map(entry => ({ ...entry })),
      criteria: parent.criteria.map(c => ({ id: c.id, text: c.text })),
      changedPaths, diff, diffTruncated: truncated,
      resultFormat: '{"verdict":"pass"|"fail","findings":["one finding per string"]}',
    };
    issued.set(request.requestId, { parentRequestId: parent.requestId, stateDigest, workerSession: input.workerSession, requestDigest: sha256(canonical(request)), extensionId: parent.extensionId, checkout: parent.checkout });
    return { protocol: 1, ok: true, value: request, notices: [] };
  } catch (e) { return failure(e); }
}

/**
 * Validates a reviewer's answer and records the check. A `pass` satisfies `separate` for exactly the state the request was
 * prepared at; a `fail` never does and revokes an earlier pass for the same request. A changed checkout state is stale.
 */
export async function recordVerifyReview(input: { reviewId: string; reviewerSession: string; result: unknown }, context: CoreContext): Promise<Result<VerifyReviewReceipt>> {
  try {
    const review = issued.get(input.reviewId);
    if (!review) fail('STALE_STATE', 'No such review request is open.');
    const issuedReview = review as Issued;
    if (typeof input.reviewerSession !== 'string' || !input.reviewerSession.trim()) fail('INVALID_EVIDENCE', 'The host reported no reviewer session identity; the review cannot count as separate.');
    if (input.reviewerSession === issuedReview.workerSession) fail('INVALID_EVIDENCE', 'The reviewer session identity equals the worker session identity; a separate check needs a different session.');
    if (!validResult(input.result)) fail('INVALID_EVIDENCE', 'A review result is exactly {verdict: "pass"|"fail", findings: string[]}.');
    const result = structuredClone(input.result) as VerifyReviewResult;
    const state = await assertPrepared(issuedReview.parentRequestId, context);
    if (state.leaseReleased) fail('STALE_STATE', 'The reviewed request is no longer open.');
    const cwd = state.request.checkout;
    if (workflowStateDigest(cwd) !== issuedReview.stateDigest) fail('STALE_STATE', 'The checkout changed after the review was prepared; the review is stale. Request a new review.');
    const artifact = { protocol: 1, kind: 'verify-review', reviewId: input.reviewId, parentRequestId: issuedReview.parentRequestId, requestDigest: issuedReview.requestDigest, stateDigest: issuedReview.stateDigest, verdict: result.verdict, findings: result.findings, reviewerSession: input.reviewerSession, workerSession: issuedReview.workerSession, independence: 'claimed by the host; not proven' };
    const content = canonical(artifact);
    withContainedDirectory(checkoutIdentity(cwd).commonDir, artifactDirectory(issuedReview.parentRequestId), true, dir => dir.writeExclusive(artifactName(input.reviewId), content));
    // One verdict per request: a later review replaces the earlier one, including its check.
    recorded.set(issuedReview.parentRequestId, { reviewId: input.reviewId, artifactDigest: sha256(content), stateDigest: issuedReview.stateDigest, verdict: result.verdict, findings: result.findings, reviewerSession: input.reviewerSession, workerSession: issuedReview.workerSession });
    issued.delete(input.reviewId);
    if (result.verdict === 'pass') recordVerificationCheck(issuedReview.parentRequestId, 'separate', issuedReview.stateDigest);
    else clearVerificationCheck(issuedReview.parentRequestId, 'separate');
    return { protocol: 1, ok: true, value: { reviewId: input.reviewId, parentRequestId: issuedReview.parentRequestId, verdict: result.verdict, findings: result.findings.length, stateDigest: issuedReview.stateDigest, satisfied: result.verdict === 'pass' }, notices: [] };
  } catch (e) { return failure(e); }
}

/**
 * Re-reads the stored artifact for the request's current state. Returns null when no review covers this state; throws when
 * the file no longer matches what core stored, so a rewritten or forged verdict cannot stand in for a recorded one.
 */
export function reviewFor(checkout: string, parentRequestId: string, stateDigest: string): (Recorded & { verified: true }) | null {
  const entry = recorded.get(parentRequestId);
  if (!entry || entry.stateDigest !== stateDigest) return null;
  let bytes: Buffer;
  try { bytes = readContainedFile(checkoutIdentity(checkout).commonDir, `${artifactDirectory(parentRequestId)}/${artifactName(entry.reviewId)}`); }
  catch { return fail('INVALID_EVIDENCE', 'The review artifact is missing or unreadable; request a new review.'); }
  if (sha256(bytes) !== entry.artifactDigest) fail('INVALID_EVIDENCE', 'The review artifact changed after core stored it; request a new review.');
  const stored = JSON.parse(bytes.toString()) as { verdict?: unknown; stateDigest?: unknown; reviewerSession?: unknown; workerSession?: unknown };
  if (stored.stateDigest !== stateDigest || stored.verdict !== entry.verdict || stored.reviewerSession !== entry.reviewerSession || stored.reviewerSession === stored.workerSession) fail('INVALID_EVIDENCE', 'The review artifact does not match its recorded verdict; request a new review.');
  return { ...entry, verified: true };
}

/** Numbered gap entries (architecture/file-formats § 4.2) for findings core appends to spec-gaps.md during recording. */
export function gapEntriesFor(findings: readonly string[], firstNumber: number, step: number, spec: string, verdict: 'pass' | 'fail'): { text: string; numbers: number[]; lines: string[] } {
  const oneLine = (value: string) => value.replace(/\s+/g, ' ').trim();
  const numbers: number[] = [], lines: string[] = [];
  const blocks = findings.map((finding, index) => {
    const n = firstNumber + index;
    numbers.push(n);
    const text = oneLine(finding);
    const title = (text.length > 70 ? `${text.slice(0, 67)}...` : text).replace(/^#+\s*/, '');
    lines.push(`- G${n} (gap): ${title}. See \`spec-gaps.md\`.`);
    return [
      `## G${n}: ${title}`, '',
      '**Kind**: gap',
      `**Step**: ${String(step).padStart(2, '0')}`,
      `**Case**: ${text}`,
      `**Resolution**: Raised by a separate review of this step (verdict ${verdict}); not yet resolved.`,
      `**Target spec**: \`${spec}\``,
      '**Status**: open', '',
    ].join('\n');
  });
  return { text: blocks.join('\n'), numbers, lines };
}
