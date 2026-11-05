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
    reason: 'Every runtime export of the core entry point and every Codex workflow is mapped. The Claude package is assembled and tested offline: the installed MCP server prepares plan-step past compatibility and releases its lease (harness/claude-package), and the six reasoning commands are covered by fixtures (harness/claude-handlers, claude-mcp, claude-mcp-confirmation, claude-mcp-suites; the last three are fixture builds of D17 A and D16 A as the applied spec words them, each gated on a live check) plus the recovery command (commands/workflow, PROVISIONAL on one point where A3 and R1 disagree). The Claude workflows stay pending anyway, because fixtures do not deliver a workflow to a host. Live evidence is partial and recorded in harnesses/claude/host-evidence/2.1.317: the plugin loads and its server starts from .claude/specplane/core (live-prepare-check.txt), and the origin gate, bind, prepare, detail, validate, record and close ran in auto and default mode for one workflow ending in a blocked result (origin-gate-check.txt). No done result, commit or written spec was shown live; the D24 prompt change has no live run; reasoning stays false in startNative and the six legacy reasoning skills still own the command names (D19). Route B session evidence (S4, d25-route-b-probe.txt, 4 of 5 launches): launch, observe, resume and cancel of `claude -p` passed, but through a direct child process (node:child_process), not through `$.process.spawn`, whose host binding is unwritten and untested; the budget stop was NOT seen (the run cost 0.0067 under the 0.01 cap), so no ProbeEvidence exists and the adapter stays gated; no done result exists. The five mechanical commands have no live-host run. Rows stay not-delivered and pending.',
    suites: [{ file: 'harness/codex-package', title: 'codex init delivers a self-contained package' }, { file: 'harness/codex-consumer', title: 'offline docs' }, { file: 'harness/claude-package', title: 'the installed MCP server binds, prepares a reasoning workflow' }] },
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

/** Workflows shipped as host surfaces. Codex ships the first six; Claude exposes all eleven as native commands (mechanical ones have no skill file, D10), but the Claude package delivers no workflow command yet: the six reasoning commands are built and tested offline (harness/claude-handlers) and stay unregistered until a live check passes (D13; the run 3 attempt was refused at the origin gate, D18). The D25 route B probe adds no delivered workflow: it exercised launch, observe, resume and cancel over a direct child process only. Rows are `not-delivered` because the column means delivered to the host, which offline tests cannot show. */
export const CODEX_WORKFLOWS_DELIVERED = ['plan-step', 'plan-create', 'spec-assist', 'spec-draft-architecture', 'decision-new', 'validate'];
export const CLAUDE_WORKFLOWS = ['approve', 'decision-new', 'plan-abandon', 'plan-create', 'plan-finish', 'plan-start', 'plan-status', 'plan-step', 'spec-assist', 'spec-draft-architecture', 'validate'];

export function hostRows(host: 'codex' | 'claude'): HostRow[] {
  if (host === 'codex') return CODEX_WORKFLOWS_DELIVERED.map(workflow => ({ workflow, deterministic: 'tested', liveHost: 'unverified' }));
  return CLAUDE_WORKFLOWS.map(workflow => ({ workflow, deterministic: 'not-delivered', liveHost: 'pending' }));
}
