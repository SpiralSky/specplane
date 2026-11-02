/** Import-safe library entry point. The CLI is deliberately not imported here. */
import { Ajv } from 'ajv';
import { writeImplementation, type CompletionReceipt } from './completion-writer.js';
import { mechanicalRequestSchema, workflowRequestSchema, workflowResultSchema, workflowTestRequestSchema, recordingProposalSchema, contributionEventSchema, confirmationChallengeSchema, confirmationResponseSchema, conductorRequestSchema, contributionQuerySchema } from './schemas.js';
import { coreInfo } from './build-info.js';
import { validateCompatibility, type HostSelection } from './compatibility.js';
import type { CoreContext, MechanicalRequest, Result, WorkflowTestRequest, WorkflowRequest, WorkflowResult, RecordingProposal, ContributionEvent, ContributionQuery, ConfirmationChallenge, ConfirmationResponse, ConductorRequest, SessionAdapter } from './contracts.js';
export { coreInfo };
export type * from './contracts.js';
export type { ExtensionManifest, HostSelection, Capabilities } from './compatibility.js';
export * from './schemas.js';
export * from './contributions.js';
export const checkCompatibility = (manifest: unknown, host: HostSelection) => validateCompatibility(manifest, host, coreInfo);
function unavailable<T>(operation: string): Result<T> {
  return { protocol: 1, ok: false, error: { code: 'UNSUPPORTED_CAPABILITY', message: `${operation} is not implemented by this core release`, retryable: false, details: null }, notices: [] };
}
const ajv = new Ajv();
const validate = { operation: ajv.compile(mechanicalRequestSchema), request: ajv.compile(workflowRequestSchema), result: ajv.compile(workflowResultSchema), test: ajv.compile(workflowTestRequestSchema), proposal: ajv.compile(recordingProposalSchema), contribution: ajv.compile(contributionEventSchema), challenge: ajv.compile(confirmationChallengeSchema), response: ajv.compile(confirmationResponseSchema), conductor: ajv.compile(conductorRequestSchema), query: ajv.compile(contributionQuerySchema) };
function checked(operation: string, valid: boolean): Result<never> {
  return valid ? unavailable(operation) : { protocol: 1, ok: false, error: { code: 'INVALID_EVIDENCE', message: `Invalid ${operation} input`, retryable: false, details: null }, notices: [] };
}
export const inspectRepository = (_request: { checkout: string }): Result<never> => unavailable('inspectRepository');
export const executeOperation = (request: MechanicalRequest, context: CoreContext): Result<CompletionReceipt> => {
  if (!validate.operation(request)) return checked('executeOperation', false);
  if (request.operation !== 'spec.complete' && request.operation !== 'spec.implementation') return unavailable('executeOperation');
  try {
    const args = request.arguments;
    const status = request.operation === 'spec.complete' ? 'complete' : request.arguments.status;
    return { protocol: 1, ok: true, value: writeImplementation({ ...args, status }, context.checkout ?? process.cwd()), notices: [] };
  } catch (error) {
    return { protocol: 1, ok: false, error: { code: 'OPERATION_FAILED', message: error instanceof Error ? error.message : String(error), retryable: false, details: null }, notices: [] };
  }
};
export const prepareWorkflow = (_request: WorkflowRequest, _context: CoreContext): Result<never> => checked('prepareWorkflow', validate.request(_request));
export const executeWorkflowTest = (_request: WorkflowTestRequest, _context: CoreContext): Result<never> => checked('executeWorkflowTest', validate.test(_request));
export const validateWorkflowResult = (_prepared: WorkflowRequest, _result: WorkflowResult, _context: CoreContext): Result<never> => checked('validateWorkflowResult', validate.request(_prepared) && validate.result(_result));
export const recordWorkflow = (_proposal: RecordingProposal, _context: CoreContext): Result<never> => checked('recordWorkflow', validate.proposal(_proposal));
export const prepareConfirmation = (_operation: MechanicalRequest, _context: CoreContext): Result<never> => checked('prepareConfirmation', validate.operation(_operation));
export const confirmOperation = (_challenge: ConfirmationChallenge, _response: ConfirmationResponse, _context: CoreContext): Result<never> => checked('confirmOperation', validate.challenge(_challenge) && validate.response(_response));
export const cancelWorkflow = (_requestId: string, _context: CoreContext): Result<never> => unavailable('cancelWorkflow');
export const inspectWorkflow = (_requestId: string, _context: CoreContext): Result<never> => unavailable('inspectWorkflow');
export const runConductor = (_request: ConductorRequest, _context: CoreContext & { adapter: SessionAdapter }): Result<never> => checked('runConductor', validate.conductor(_request) && !!_context?.adapter && ['probe', 'launch', 'observe', 'resume', 'recovery', 'cancel'].every(key => typeof (_context.adapter as unknown as Record<string, unknown>)[key] === 'function') && typeof _context.adapter.name === 'string');
export const captureContribution = (_event: ContributionEvent, _context: CoreContext): Result<never> => checked('captureContribution', validate.contribution(_event));
export const readContributions = (_query: ContributionQuery, _context: CoreContext): Result<never> => checked('readContributions', validate.query(_query));

export * from "./completion.js";

export type { CompletionReceipt } from './completion-writer.js';
