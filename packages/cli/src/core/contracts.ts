/** Wire formats shared by extensions and the core. */
export const PROTOCOL = 1 as const;
export type Notice = { code: string; message: string };
export type CoreError = { code: string; message: string; retryable: boolean; details: unknown };
export type Result<T> = { protocol: 1; ok: true; value: T; notices: Notice[] } | { protocol: 1; ok: false; error: CoreError; notices: Notice[] };
export type Digest = string;
export type Artifact = { path: string; digest: Digest; kind: 'file' | 'test' };
export type TestRequirement = { suiteId: string; format: 'node-tap-v13' | 'junit-xml' };
export type Criterion = { id: string; text: string; sourcePath: string; sourceDigest: Digest; testRequirements: TestRequirement[] };
export type WorkflowTestRequest = { requestId: string; criterionIds: string[]; executable: string; args: string[]; reportFormat: TestRequirement['format'] };
export type ExecutionPort = { execute(request: { executable: string; args: string[]; checkout: string; signal?: AbortSignal }): Promise<{ exitCode: number | null; signal: string | null; stdout: Uint8Array; stderr: Uint8Array }> };
export type ClockPort = { now(): Date };
export type GitPort = { run(args: string[], checkout: string): Promise<{ stdout: string; stderr: string; exitCode: number }> };
export type FileSystemPort = { read(path: string): Promise<Uint8Array>; lstat(path: string): Promise<{ isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }> };
export type InteractionPort = { confirm(message: string): Promise<boolean> };
export type CoreContext = { checkout?: string; extensionId: string; signal?: AbortSignal; git?: GitPort; filesystem?: FileSystemPort; clock?: ClockPort; interaction?: InteractionPort; execution?: ExecutionPort };
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
export type WorkflowScope = { kind: string; specIds: string[]; allowedEditPaths: string[]; planId?: string; step?: number; expectedStatus?: string; checkout?: string; leaseId?: string };
export type WorkflowRequest = { protocol: 1; requestId: string; workflow: string; extensionId: string; checkout: string; mode: 'attended' | 'unattended'; base: WorkflowBase; scope: WorkflowScope; context: WorkflowContextEntry[]; criteria: Criterion[]; procedureDigests: Record<string, Digest | 'missing'> };
export type WorkflowResult = { protocol: 1; requestId: string; baseDigest: Digest; outcome: 'done' | 'blocked' | 'cancelled'; summary: string; changes: { path: string; beforeDigest: Digest | 'missing'; afterDigest: Digest | 'missing'; purpose: string }[]; criterionEvidence: { criterionId: string; assessment: 'met' | 'unmet' | 'uncertain'; rationale: string; artifacts: Artifact[] }[]; gaps: string[]; contextExpansion: { path: string; anchor?: string; reason: string }[]; contributionEvents: ContributionEvent[]; openIssues: string; nextKnows: string };
export type RecordingProposal = { protocol: 1; requestId: string; resultDigest: Digest; currentStateDigest: Digest; paths: string[]; evidenceDigest: Digest; requiresConfirmation: boolean } & MechanicalRequest;

type AdditionalOperations = {
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

export type ContributionEvent = { eventId: string; requestId: string; spec: string; role: 'create' | 'revise' | 'review'; source: 'runtime' | 'declared'; actor: { kind: 'human' | 'model'; provider?: string; model_id?: string; session_id?: string; harness?: string; display_name?: string; parentSessionId?: string }; action: { kind: 'create' | 'edit' | 'review'; evidencePath: string; evidenceDigest: Digest }; revision: { beforeDigest: Digest; afterDigest: Digest } | { reviewedDigest: Digest } };
export type ConfirmationChallenge = { challengeId: string; operation: string; targets: string[]; stateDigest: Digest; payloadDigest: Digest; evidenceDigest: Digest; expiresAt: string; summary: string };
export type ConfirmationResponse = { challengeId: string; decision: 'confirm' | 'decline'; interactionId: string };
export type TestAssertion = { suiteId: string; parentExecutionId: string | null; executed: number; failed: number; skipped: number; evidence: { path: string; digest: Digest; format: TestRequirement['format'] } };
export type TestReceipt = { protocol: 1; requestId: string; executionId: string; stateDigest: Digest; executable: string; args: string[]; checkout: string; exitCode: number | null; signal: string | null; stdout: { path: string; digest: Digest }; stderr: { path: string; digest: Digest }; assertions: TestAssertion[] };
export type TestExecutionResult = { artifact: Artifact & { kind: 'test' }; executionId: string; exitCode: number | null; signal: string | null; assertions: TestAssertion[] };
export type ConductorRequest = { plans: string[]; until?: 'step' | 'finish'; maxSteps?: number; maxParallel?: number; maxBudgetUsd?: number; timeoutSeconds?: number; step?: number; force?: boolean; reason?: string; dryRun?: boolean };
export type SessionRef = { orchestrationId: string; nativeSessionId?: string; pid?: number };
export type SessionRequest = { requestId: string; orchestrationId: string; plan: string; step: number; checkout: string; workflowRequestPath: string; mode: 'unattended'; budgetUsd?: number; signal?: AbortSignal };
export type SessionState = SessionRef & { state: 'running' | 'completed' | 'failed' | 'unknown' };
export type SessionCapabilities = { host: string; version?: string; surface: string; backends: string[]; launch: boolean; observe: boolean; resume: boolean; cancel: boolean; budgetEnforcement: boolean };
export type SessionAdapter = { name: string; probe(request: { checkout: string; requirements: string[]; signal?: AbortSignal }): Promise<SessionCapabilities>; launch(request: SessionRequest): Promise<SessionState>; observe(ref: SessionRef): Promise<SessionState>; resume(ref: SessionRef, request: SessionRequest): Promise<SessionState>; recovery(ref: SessionRef): Promise<{ available: boolean; instructions?: string[][]; reason?: string }>; cancel(ref: SessionRef, signal?: AbortSignal): Promise<{ stopped: boolean; recoveryRequired: boolean }> };
export type ContributionQuery = { spec?: string; requestId?: string };
