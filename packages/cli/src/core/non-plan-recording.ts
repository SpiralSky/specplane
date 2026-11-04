/** Policy and exact-edit-set validation for prepared non-plan results.
 * Evidence validation and the transaction remain the recording coordinator's job.
 */
import { isDeepStrictEqual } from 'node:util';
import { parseFrontmatter } from '../frontmatter.js';
import * as path from 'node:path';
import { loadConfig } from '../config.js';
import { resolveSpecId } from '../spec/resolve.js';
import { run } from '../git/exec.js';
import { validateRecordingSet, type RecordingSet } from '../plan/recording-set.js';
import { readContainedFile } from './contained-files.js';
import { setFinalizedAssistAuthor } from './contribution-metadata.js';
import { prepareCreation, type PreparedCreation } from './creation-plans.js';
import { sha256, type PreparedState } from './workflow-preparation.js';
import type { WorkflowResult } from './contracts.js';

function fail(code: string, message: string): never { throw Object.assign(new Error(message), { code }); }
function frontmatterBytes(text: string): string {
  const open = /^\uFEFF?---[ \t]*(?:\r\n|\n|\r)/.exec(text);
  if (!open) fail('INVALID_EVIDENCE', 'Missing spec frontmatter');
  const close = /^---[^\r\n]*(?:\r\n|\n|\r|$)/m.exec(text.slice(open[0].length));
  if (!close) fail('INVALID_EVIDENCE', 'Missing closing spec frontmatter');
  return text.slice(0, open[0].length + close.index + close[0].length);
}
export interface PreparedNonPlanRecording {
  manifest: RecordingSet;
  generated: { path: string; before: string | null; after: string }[];
  creation?: PreparedCreation;
  requiresConfirmation: boolean;
  summary: string;
}

/** Dedicated creation previews and finalized text remain confirmation-gated. */
export function prepareNonPlanRecording(state: PreparedState, result: WorkflowResult): PreparedNonPlanRecording {
  const request = state.request;
  if (request.workflow === 'plan-step') fail('POLICY_DENIED', 'Plan results require the plan recording operation');
  if (result.requestId !== request.requestId || result.baseDigest !== request.base.digest) fail('STALE_STATE', 'Non-plan result differs from prepared identity/base');
  if (result.outcome === 'cancelled') fail('CANCELLED', 'Cancelled workflows preserve edits without recording');
  if (result.gaps.length) fail('POLICY_DENIED', 'Non-plan results cannot record plan gap entries');
  if (result.contextExpansion.length) fail('STALE_STATE', 'Context expansion requires a reviewed preparation');
  if (!result.summary.trim() || /[\r\n]/.test(result.summary)) fail('INVALID_EVIDENCE', 'A nonempty single-line summary is required');
  if (result.creation && (result.changes.length || result.finalizedEdits?.length)) fail('POLICY_DENIED', 'A dedicated creation cannot be combined with existing-file edits');
  const creation = result.creation ? prepareCreation(state, result.creation) : undefined;
  const editing = request.workflow === 'spec-assist' || request.workflow === 'spec-draft-architecture';
  for (const change of result.changes) {
    if (!editing || !request.scope.allowedEditPaths.includes(change.path) || !state.mutableInputs.includes(change.path) || !Object.hasOwn(state.editableSpecPolicies, change.path)) fail('POLICY_DENIED', 'Non-plan result cannot edit files outside its prepared draft-authorized spec scope');
    if (change.beforeDigest === 'missing' || change.afterDigest === 'missing') fail('POLICY_DENIED', 'New or deleted files require dedicated creation/deletion operations');
    if (change.beforeDigest !== request.base.inputDigests[change.path]) fail('STALE_STATE', 'Spec edit differs from prepared preimage');
    const before = run('git', ['show', `${request.base.head}:${change.path}`], { cwd: request.checkout, binary: true });
    const after = readContainedFile(request.checkout, change.path);
    if (sha256(before) !== change.beforeDigest || sha256(after) !== change.afterDigest) fail('STALE_STATE', 'Spec edit bytes differ from result evidence');
    const oldText = before.toString(), newText = after.toString();
    const oldSpec = parseFrontmatter(oldText), newSpec = parseFrontmatter(newText);
    if (frontmatterBytes(oldText) !== frontmatterBytes(newText) || !isDeepStrictEqual(oldSpec.data, newSpec.data)) fail('POLICY_DENIED', 'Caller spec metadata edits require their dedicated reviewed operations; core owns contribution metadata');
    if (oldText.slice(frontmatterBytes(oldText).length) === newText.slice(frontmatterBytes(newText).length)) fail('INVALID_EVIDENCE', 'A spec body edit must change body bytes');
  }
  const manifest: RecordingSet = { protocol: 1, head: request.base.head, branch: request.base.branch, changes: structuredClone(result.changes) };
  validateRecordingSet(manifest, request.checkout, null, [], result.changes.map(change => `${change.path}:${change.purpose}`), result.outcome);
  const generated: PreparedNonPlanRecording['generated'] = creation?.files.map(({ path, before, after }) => ({ path, before, after })) ?? [];
  const seen = new Set<string>();
  const config = result.finalizedEdits?.length ? loadConfig(request.checkout).config : null;
  for (const edit of result.finalizedEdits ?? []) {
    const explicitSpecs = state.initiation.workflow === 'plan-step' ? [] : state.initiation.selection.specIds;
    if (!editing || !request.scope.specIds.includes(edit.spec) || !explicitSpecs.includes(edit.spec)) fail('POLICY_DENIED', 'Finalized content must identify an explicitly selected prepared editable spec');
    const resolved = resolveSpecId(edit.spec, config!, undefined, request.checkout);
    if (edit.spec !== `${resolved.root}:${resolved.id}`) fail('INVALID_EVIDENCE', 'Finalized content requires an exact root-qualified spec ID');
    const type = resolved.id.startsWith('feature/') ? 'feature' : 'architecture';
    if ((request.workflow === 'spec-assist' && type !== 'feature') || (request.workflow === 'spec-draft-architecture' && type !== 'architecture')) fail('POLICY_DENIED', 'Finalized content does not match the prepared workflow spec type');
    if (!['review', 'assist', 'draft'].includes(config!.specs[type].llm_role)) fail('POLICY_DENIED', 'Configured role does not authorize finalized content writes');
    const relative = path.relative(request.checkout, resolved.path).split(path.sep).join('/');
    if (seen.has(relative) || result.changes.some(change => change.path === relative)) fail('INVALID_EVIDENCE', 'Finalized content cannot duplicate or overlap reviewed body edits');
    seen.add(relative);
    const before = readContainedFile(request.checkout, relative).toString();
    if (sha256(before) !== request.base.inputDigests[relative]) fail('STALE_STATE', 'Finalized content preimage changed before confirmation');
    const header = frontmatterBytes(before);
    if (typeof edit.body !== 'string' || !edit.body.trim() || before.slice(header.length) === edit.body) fail('INVALID_EVIDENCE', 'Finalized content requires a nonempty changed markdown body');
    const bodyAfter = header + edit.body;
    if (!isDeepStrictEqual(parseFrontmatter(before).data, parseFrontmatter(bodyAfter).data)) fail('POLICY_DENIED', 'Finalized content cannot change spec metadata');
    const after = config!.specs[type].llm_role === 'assist' ? setFinalizedAssistAuthor(bodyAfter) : bodyAfter;
    generated.push({ path: relative, before, after });
  }
  const notes = [result.summary];
  if (!result.changes.length && !generated.length) notes.push('Read-only findings; creation, content approval and lifecycle transitions require their dedicated operations.');
  if (generated.length) notes.push('Exact finalized content requires direct-human confirmation before writing.');
  if (creation) notes.push(`Dedicated creation: ${creation.operation} ${creation.identity}; lifecycle fields remain core-owned.`);
  if (result.openIssues.trim()) notes.push(`Limitations/open issues: ${result.openIssues}`);
  if (result.nextKnows.trim()) notes.push(`Worker notes: ${result.nextKnows}`);
  return { manifest, generated, ...(creation ? { creation } : {}), requiresConfirmation: generated.length > 0, summary: notes.join('\n') };
}
