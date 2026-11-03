import { run } from '../git/exec.js';
import type { CoreContext, Result } from './contracts.js';
import { assertPreparedIdentity, finishStoppedPreparation, preparedActivity, type PreparedState } from './workflow-preparation.js';
import { inspectWorkflowRecording, type WorkflowRecordingReceipt } from './workflow-recording.js';

/** Same-process observation. No delegation tokens, package inputs or private context. */
export interface WorkflowInspection {
  requestId: string;
  checkout: string;
  workflow: string;
  observed: { head: string; branch: string };
  phase: 'idle' | 'execution' | 'validation' | 'recording';
  cancellation: 'active' | 'requested' | 'stopped';
  lease: 'held' | 'released';
  recording: WorkflowRecordingReceipt | null;
}
function snapshot(state: PreparedState, context: CoreContext): WorkflowInspection {
  const request = state.request;
  const git = (...args: string[]) => run('git', args, { cwd: request.checkout }).trim();
  return { requestId: request.requestId, checkout: request.checkout, workflow: request.workflow,
    observed: { head: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current') },
    phase: preparedActivity(request.requestId), cancellation: state.leaseReleased ? 'stopped' : state.context.signal?.aborted ? 'requested' : 'active',
    lease: state.leaseReleased ? 'released' : 'held', recording: inspectWorkflowRecording(request.requestId, context) };
}
function failure(error: unknown): Result<never> {
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'RECOVERY_REQUIRED';
  return { protocol: 1, ok: false, error: { code, message: error instanceof Error ? error.message : String(error), retryable: code === 'LOCKED', details: error && typeof error === 'object' && 'details' in error ? error.details : null }, notices: [] };
}
function identity(requestId: string, context: CoreContext): PreparedState {
  if (typeof requestId !== 'string' || !requestId.trim()) throw Object.assign(new Error('A nonempty workflow request ID is required.'), { code: 'INVALID_EVIDENCE' });
  return assertPreparedIdentity(requestId, context);
}
export function inspectWorkflow(requestId: string, context: CoreContext): Result<WorkflowInspection> {
  try { return { protocol: 1, ok: true, value: snapshot(identity(requestId, context), context), notices: [] }; }
  catch (error) { return failure(error); }
}
export async function cancelWorkflow(requestId: string, context: CoreContext): Promise<Result<WorkflowInspection>> {
  context = { ...context };
  let state: PreparedState | undefined;
  let reserved = false;
  try {
    state = identity(requestId, context);
    if (state.leaseReleased) return { protocol: 1, ok: true, value: snapshot(state, context), notices: [] };
    if (state.cancellationPending) throw Object.assign(new Error('Cancellation is already awaiting stopped-worker acknowledgment.'), { code: 'LOCKED' });
    state.cancellationPending = true; reserved = true;
    state.cancellation.abort();
    if (!state.stopWorker) throw new Error('The prepared host has no stopped-worker acknowledgment port; lease retained.');
    let acknowledgment;
    try { acknowledgment = await state.stopWorker({ requestId, checkout: state.request.checkout }); }
    catch (error) { throw new Error(`Stopped-worker acknowledgment failed; lease retained: ${error instanceof Error ? error.message : String(error)}`); }
    // A completed core execution alone does not establish that host reasoning/children stopped.
    if (acknowledgment?.stopped !== true || acknowledgment.recoveryRequired !== false) throw new Error('Host could not prove all workflow workers stopped; lease retained.');
    assertPreparedIdentity(requestId, context);
    const observed = snapshot(state, context);
    finishStoppedPreparation(requestId);
    return { protocol: 1, ok: true, value: { ...observed, cancellation: 'stopped', lease: 'released' }, notices: [] };
  } catch (error) {
    const failed = failure(error);
    if (state && !failed.ok) {
      // Identity was resolved before consulting private recording state. Reporting
      // a known commit must not depend on whether the host can prove stopping.
      let recording: unknown;
      try {
        const receipt = inspectWorkflowRecording(requestId, context);
        if (receipt) recording = { commit: receipt.commit, publication: receipt.publication, verified: true };
      } catch (inspectionError) {
        if (inspectionError && typeof inspectionError === 'object' && 'details' in inspectionError) {
          const details = inspectionError.details;
          if (details && typeof details === 'object' && 'recording' in details) recording = details.recording;
        }
      }
      if (recording) {
        const details = failed.error.details;
        failed.error.details = { ...(details && typeof details === 'object' ? details : {}), recording };
      }
    }
    return failed;
  }
  finally { if (state && reserved) state.cancellationPending = false; }
}
