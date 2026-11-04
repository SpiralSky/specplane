/** Traceability data for the cross-package acceptance matrix. Deterministic suites are named; host evidence is a separate axis and is never inferred from them. */
export type Suite = { file: string; title: string };
export type Criterion = { id: string; text: string; state: 'met' | 'unmet'; suites: Suite[]; reason?: string };
export type HostRow = { workflow: string; deterministic: 'tested' | 'not-delivered'; liveHost: 'unverified' | 'pending' };

/** Suites are paths relative to src/ without extension; `title` is a distinctive substring of a test title in that file. */
export const CRITERIA: Criterion[] = [
  { id: 'cli-core-agreement', text: 'CLI/core paths agree for exact staging, coordination, confirmations, receipts and provenance', state: 'met', suites: [
    { file: 'core/completion-writer', title: 'core and CLI preserve evidence and body' },
    { file: 'commands/coordination', title: 'stateful spec and ADR commands refuse while another writer holds the checkout' },
    { file: 'core/confirmed-operations', title: 'approval adapters invoke real spec, reopen, plan-index and ADR operations' },
    { file: 'core/confirmed-operations', title: 'plan batches preview each successive prospective index' },
    { file: 'plan/retarget', title: 'preview and core update preserve provenance' },
    { file: 'core/contribution-metadata', title: 'finalized assist authorship changes only author' }] },
  { id: 'exports-and-workflows', text: 'Each public export and delivered workflow maps to passing applicable tests', state: 'unmet',
    reason: 'Every runtime export of the core entry point and every Codex workflow is mapped, but the Claude workflows have no assembled package and no live-host evidence: native handlers and policy hooks are covered offline (harness/claude-handlers and `claude plugin test`), which does not deliver them, so their rows stay pending.',
    suites: [{ file: 'harness/codex-package', title: 'codex init delivers a self-contained package' }, { file: 'harness/codex-consumer', title: 'offline docs' }] },
  { id: 'index-targets-dependencies-docs', text: 'Acceptance covers all three index sources, target/retarget refusal paths, completion dependency changes and offline CLI/core/harness docs parity', state: 'met', suites: [
    { file: 'generate/index-command', title: 'source selection, notices, print-only, idempotence and migration' },
    { file: 'plan/retarget', title: 'unfinished cross-target stack refuses' },
    { file: 'plan/retarget', title: 'captured target ref changing before validation refuses without a write' },
    { file: 'core/completion', title: 'assessment preserves known changes with unavailable and unsupported dependencies' },
    { file: 'core/completion', title: 'a missing recorded dependency is also removed' },
    { file: 'harness/conformance', title: 'docs agree across CLI, core and the installed Codex package' }] },
  { id: 'manual-vs-agent', text: 'Ordinary Git/manual declarations and agent interpretation are assessed separately from deterministic packaging tests', state: 'met', suites: [
    { file: 'harness/codex-consumer', title: 'stale manual completion' },
    { file: 'harness/conformance', title: 'agent interpretation and live-host behaviour are not asserted by deterministic suites' }] },
];

/** Public runtime exports of `specplane/core` and the suite that exercises each (the suite source must mention the export). Schema constants are exercised through the suites that validate with them. */
export const EXPORT_SUITES: Record<string, string> = {
  DocsUsageError: 'docs/operations', docsIndex: 'docs/operations', docsSearch: 'docs/operations', docsTopic: 'docs/operations',
  RUNNER_METHODS: 'harness/conformance', createWorkflowRunner: 'core/workflow-runner', parseServeArgs: 'core/workflow-runner', spawnExecutionPort: 'harness/conformance',
  artifact: 'harness/conformance', criterion: 'harness/conformance', context: 'harness/conformance', evaluateImplementation: 'core/completion', fingerprintClosure: 'core/completion', fingerprintSpec: 'core/completion',
  assertionSchema: 'harness/conformance', mechanicalRequestSchema: 'core/index', workflowTestRequestSchema: 'core/index', testReceiptSchema: 'core/index', confirmationResponseSchema: 'core/index',
  confirmationChallengeSchema: 'harness/conformance', conductorRequestSchema: 'harness/conformance', manifestSchema: 'harness/conformance', checkCompatibility: 'harness/conformance',
  contributionEventSchema: 'harness/conformance', contributionProposalSchema: 'harness/conformance', contributionQuerySchema: 'harness/conformance', contributionTrailer: 'core/contributions',
  carryContributions: 'core/contributions', deduplicateContributions: 'core/contributions', validateContribution: 'harness/conformance',
  captureContribution: 'core/contribution-capture', captureProposedContribution: 'core/proposed-contributions', readContributions: 'core/contribution-capture',
  coreInfo: 'core/index', executeOperation: 'core/completion-writer', inspectRepository: 'harness/conformance', executeWorkflowTest: 'core/workflow-execution',
  prepareWorkflow: 'core/workflow-preparation', recordWorkflow: 'core/workflow-recording', validateWorkflowResult: 'core/workflow-recording',
  prepareConfirmation: 'core/confirmed-operations', confirmOperation: 'core/confirmed-operations', confirmOperationAsync: 'plan/finish-trusted',
  cancelWorkflow: 'core/workflow-lifecycle', inspectWorkflow: 'core/workflow-lifecycle', runConductor: 'plan/neutral-startup',
  inspectCommittedContributions: 'core/contribution-history', recoverWorkflowRecording: 'core/recording-recovery', reconcileWorkflowRecording: 'core/pending-recovery',
  checkGuidance: 'docs/freshness', refreshGuidance: 'docs/freshness',
  recordingProposalSchema: 'harness/conformance', reviewedTestMappingSchema: 'harness/conformance', testExecutionResultSchema: 'harness/conformance',
  workflowCreationSchema: 'harness/conformance', workflowInitiationSchema: 'harness/conformance', workflowRequestSchema: 'core/workflow-preparation', workflowResultSchema: 'harness/conformance',
};

/** Workflows shipped as host surfaces. Codex ships the first six; Claude templates ship all eleven but no Claude package or host evidence exists yet. */
export const CODEX_WORKFLOWS_DELIVERED = ['plan-step', 'plan-create', 'spec-assist', 'spec-draft-architecture', 'decision-new', 'validate'];
export const CLAUDE_WORKFLOWS = ['approve', 'decision-new', 'plan-abandon', 'plan-create', 'plan-finish', 'plan-start', 'plan-status', 'plan-step', 'spec-assist', 'spec-draft-architecture', 'validate'];

export function hostRows(host: 'codex' | 'claude'): HostRow[] {
  if (host === 'codex') return CODEX_WORKFLOWS_DELIVERED.map(workflow => ({ workflow, deterministic: 'tested', liveHost: 'unverified' }));
  return CLAUDE_WORKFLOWS.map(workflow => ({ workflow, deterministic: 'not-delivered', liveHost: 'pending' }));
}
