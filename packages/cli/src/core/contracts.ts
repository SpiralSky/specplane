/** Wire formats shared by extensions and the core. */
export const PROTOCOL = 1 as const;
export type Notice = { code: string; message: string };
export type CoreError = { code: string; message: string; retryable: boolean; details: unknown };
export type Result<T> = { protocol: 1; ok: true; value: T; notices: Notice[] } | { protocol: 1; ok: false; error: CoreError; notices: Notice[] };
export type Digest = string;
export type Artifact = { path: string; digest: Digest; kind: 'file' | 'test' };
export type TestRequirement = { suiteId: string; format: 'node-tap-v13' | 'junit-xml' };
export type Criterion = { id: string; text: string; sourcePath: string; sourceDigest: Digest; testRequirements: TestRequirement[] };
export type WorkflowTestRequest = { requestId: string; criterionIds: string[]; suiteId?: string; executable: string; args: string[]; reportFormat: TestRequirement['format'] };
/** Trusted host boundary: resolve executable names, enforce host permissions, launch without
 * a shell using the supplied environment, and propagate cancellation to the process tree.
 * Resolve/reject only after launch refusal or acknowledged worker stop; never truncate output. */
export type ExecutionPort = { execute(request: { executable: string; args: string[]; checkout: string; env: Record<string, string>; signal?: AbortSignal }): Promise<{ executable: string; exitCode: number | null; signal: string | null; stdout: Uint8Array; stderr: Uint8Array }> };
/** Trusted embedding-host proof; never accepted from workflow JSON.
 * stopped=true requires all reasoning workers and child processes to have stopped;
 * a missing PID or process alone is not proof.
 */
export type LifecyclePort = { stopWorkflow(request: { requestId: string; checkout: string }): Promise<{ stopped: boolean; recoveryRequired: boolean }> };
export type ClockPort = { now(): Date };
export type GitPort = { run(args: string[], checkout: string): Promise<{ stdout: string; stderr: string; exitCode: number }> };
export type FileSystemPort = { read(path: string): Promise<Uint8Array>; lstat(path: string): Promise<{ isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }> };
/** Supplied by the trusted host only, never request JSON. Show the complete challenge
 * through a direct-human surface; a model-produced response is not consent. */
export type InteractionPort = { confirm(challenge: ConfirmationChallenge): Promise<ConfirmationResponse | null> };
/** Trusted embedding-host action ledger, bound when preparation starts. The host must
 * independently observe the action at dispatch/completion, including model switches,
 * review performance and direct-user declarations. Return null when unproved; never
 * infer identity from this lookup, assistant prose, startup identity or request IDs.
 * This port is not supplied by workflow JSON or model tools. */
export type ContributionPort = { observe(request: Pick<ContributionEvent, 'requestId' | 'eventId' | 'spec' | 'action' | 'revision'>): Promise<ContributionEvent | null> };
export type ContributionCapture = { event: ContributionEvent; status: 'pending'; recorded: false } | { event: ContributionEvent; status: 'recorded'; recorded: true; commit: string };
export type ContributionInspection = { requestId: string | null; observedHead?: string; history?: import('./contribution-history.js').CommittedContribution[]; captures: ContributionCapture[]; status: 'pending' | 'unrecorded' | 'recorded'; limitations: string[] };
export type CoreContext = { compatibility?: { manifest: unknown; host: import('./compatibility.js').HostSelection }; checkout?: string; extensionId: string; signal?: AbortSignal; git?: GitPort; filesystem?: FileSystemPort; clock?: ClockPort; interaction?: InteractionPort; execution?: ExecutionPort; lifecycle?: LifecyclePort; contributions?: ContributionPort };
export type MechanicalRequest =
  | { operation: 'spec.complete'; arguments: { id: string; root?: string; dryRun?: boolean } }
  | { operation: 'spec.implementation'; arguments: { id: string; status: 'incomplete' | 'partial' | 'complete'; root?: string; dryRun?: boolean } }
  | { operation: 'plan.retarget'; arguments: { id: string; target: string; dryRun?: boolean } }
  | { operation: 'docs.index'; arguments: Record<string, never> }
  | { operation: 'docs.topic'; arguments: { topicId: string } }
  | { operation: 'docs.search'; arguments: { query: string } }
  | AdditionalMechanicalRequest;
export type MechanicalOperation = MechanicalRequest['operation'];

export type WorkflowBase = { head: string; branch: string; configDigest: Digest; inputDigests: Record<string, Digest | 'missing'>; indexDigest: Digest; digest: Digest };
export type WorkflowContextEntry = { path: string; anchor?: string; digest: Digest };
export type WorkflowScope = { input?: string; kind: string; specIds: string[]; allowedEditPaths: string[]; planId?: string; step?: number; expectedStatus?: string; checkout?: string; leaseId?: string };
export type WorkflowName = 'plan-step' | 'plan-finish' | 'spec-assist' | 'spec-draft-architecture' | 'plan-create' | 'validate' | 'decision-new';
export type WorkflowInitiation = { protocol: 1; workflow: WorkflowName; extensionId: string; checkout: string; mode: 'attended' | 'unattended' } & ({ workflow: 'plan-step'; selection: { planId: string; step?: number; force?: boolean; reason?: string } } | { workflow: 'plan-finish'; selection: { planId: string } } | { workflow: Exclude<WorkflowName, 'plan-step' | 'plan-finish'>; selection: { specIds: string[]; input: string } });
export type WorkflowRequest = { protocol: 1; requestId: string; workflow: string; extensionId: string; checkout: string; mode: 'attended' | 'unattended'; base: WorkflowBase; scope: WorkflowScope; context: WorkflowContextEntry[]; criteria: Criterion[]; procedureDigests: Record<string, Digest | 'missing'> };
export type FinalizedSpecEdit = {spec:string;body:string};
export type WorkflowCreation =
 | {operation:'spec.new';arguments:Extract<MechanicalRequest,{operation:'spec.new'}>['arguments'];body:string}
 | {operation:'plan.new';arguments:Extract<MechanicalRequest,{operation:'plan.new'}>['arguments'];body:string;steps:{title:string;body:string;context:import('../types.js').StepContextItem[]}[]}
 | {operation:'decision.new';arguments:{title:string};body:string};
export type ContributionProposal = {kind:'finalized';edit:FinalizedSpecEdit}|{kind:'creation';creation:WorkflowCreation};
export type WorkflowResult = { creation?:WorkflowCreation;finalizedEdits?: FinalizedSpecEdit[]; protocol: 1; requestId: string; baseDigest: Digest; outcome: 'done' | 'blocked' | 'cancelled'; summary: string; changes: { path: string; beforeDigest: Digest | 'missing'; afterDigest: Digest | 'missing'; purpose: string }[]; criterionEvidence: { criterionId: string; assessment: 'met' | 'unmet' | 'uncertain'; rationale: string; artifacts: Artifact[] }[]; gaps: string[]; contextExpansion: { path: string; anchor?: string; reason: string }[]; contributionEvents: ContributionEvent[]; openIssues: string; nextKnows: string; requestedTier?: 'text' | 'standard' | 'risk' };
export type RecordingProposal = { protocol: 1; requestId: string; resultDigest: Digest; currentStateDigest: Digest; paths: string[]; evidenceDigest: Digest; requiresConfirmation: boolean } & MechanicalRequest;

type AdditionalOperations = {
  'workflow.record': { requestId: string };
  init: { harness?: string }; validate: Record<string, never>; search: { query: string; kind?: 'spec' | 'plan'; status?: string; root?: string };
  'spec.new': { type: 'feature' | 'architecture'; slug: string; root?: string; title?: string; implements?: string[]; extends?: string[] };
  'spec.list': { status?: string; type?: 'feature' | 'architecture'; root?: string }; 'spec.show': { id: string; root?: string }; 'spec.validate': { ids?: string[] };
  'spec.pin': { id?: string; refs?: string[]; check?: boolean }; 'spec.approve': { ids: string[]; dryRun?: boolean }; 'spec.reopen': { id: string; dryRun?: boolean };
  'plan.new': { id?: string; title?: string; specs?: string[]; dependsOn?: string[]; target?: string; comparisonBase?: string };
  'plan.list': { status?: string; live?: boolean; noFetch?: boolean }; 'plan.show': { id: string }; 'plan.graph': Record<string, never>; 'plan.next': { id: string };
  'plan.step-done': { id: string; outcome: 'done' | 'blocked' | 'skipped'; summary: string; recordingSet: string; type?: string; changed?: string[]; deviation?: string[]; openIssue?: string[]; gap?: string[]; trailer?: string[]; nextKnows?: string; step?: number; force?: boolean; reason?: string };
  'plan.start': { id: string; target?: string; noFetch?: boolean }; 'plan.shelve': { id: string; dryRun?: boolean }; 'plan.resume': { id: string; dryRun?: boolean }; 'plan.finish': { id: string; noFetch?: boolean };
  'plan.restack': { id: string; dryRun?: boolean }; 'plan.abandon': { id: string; deleteBranch?: boolean; force?: boolean }; 'plan.cleanup': { id: string; force?: boolean };
  'plan.archive': { id: string }; 'plan.approve': { ids: string[]; dryRun?: boolean }; 'plan.index': { source?: 'head' | 'staged' | 'working'; print?: boolean; live?: boolean };
  'decision.new': { title: string }; 'decision.accept': { ids: string[]; dryRun?: boolean };
};
type AdditionalMechanicalRequest = { [K in keyof AdditionalOperations]: { operation: K; arguments: AdditionalOperations[K] } }[keyof AdditionalOperations];

export type ContributionEvent = { eventId: string; requestId: string; spec: string; role: 'create' | 'revise' | 'review'; source: 'runtime' | 'declared'; actor: { kind: 'human' | 'model'; provider?: string; model_id?: string; session_id?: string; harness?: string; display_name?: string; parentSessionId?: string }; action: { kind: 'create' | 'edit' | 'review'; evidencePath: string; evidenceDigest: Digest }; revision: { beforeDigest: Digest | 'missing'; afterDigest: Digest } | { reviewedDigest: Digest } };
export type ConfirmationChallenge = { challengeId: string; operation: string; targets: string[]; stateDigest: Digest; payloadDigest: Digest; evidenceDigest: Digest; expiresAt: string; summary: string };
export type ConfirmationResponse = { challengeId: string; decision: 'confirm' | 'decline'; interactionId: string };
export type TestAssertion = { suiteId: string; parentExecutionId: string | null; executed: number; failed: number; skipped: number; evidence: { path: string; digest: Digest; format: TestRequirement['format'] } };
export type TestReceipt = { protocol: 1; requestId: string; executionId: string; suiteId: string | null; stateDigest: Digest; executable: string; args: string[]; checkout: string; exitCode: number | null; signal: string | null; stdout: { path: string; digest: Digest }; stderr: { path: string; digest: Digest }; assertions: TestAssertion[] };
export type TestExecutionResult = { artifact: Artifact & { kind: 'test' }; executionId: string; exitCode: number | null; signal: string | null; assertions: TestAssertion[] };
export type ConductorRequest = { plans: string[]; until?: 'step' | 'finish'; maxSteps?: number; maxParallel?: number; maxBudgetUsd?: number; timeoutSeconds?: number; step?: number; force?: boolean; reason?: string; dryRun?: boolean };
export type SessionRef = { orchestrationId: string; nativeSessionId?: string; pid?: number };
export type SessionRequest = { requestId: string; orchestrationId: string; plan: string; step: number; checkout: string; workflowRequestPath: string; mode: 'unattended'; budgetUsd?: number; signal?: AbortSignal };
export type SessionState = SessionRef & { state: 'running' | 'completed' | 'failed' | 'unknown' };
export type SessionCapabilities = { host: string; version?: string; surface: string; backends: string[]; launch: boolean; observe: boolean; resume: boolean; cancel: boolean; budgetEnforcement: boolean };
export type SessionAdapter = { name: string; /** Optional local alert sink; never executes commands. */ notify?(message: string): void; probe(request: { checkout: string; requirements: string[]; signal?: AbortSignal }): Promise<SessionCapabilities>; launch(request: SessionRequest): Promise<SessionState>; observe(ref: SessionRef): Promise<SessionState>; resume(ref: SessionRef, request: SessionRequest): Promise<SessionState>; recovery(ref: SessionRef): Promise<{ available: boolean; instructions?: string[][]; reason?: string }>; cancel(ref: SessionRef, signal?: AbortSignal): Promise<{ stopped: boolean; recoveryRequired: boolean }> };
export type ContributionQuery = { spec?: string; requestId?: string };
