/** Protocol 1 JSON Schemas. Every object is closed, including nested records. */
const text = { type: 'string', minLength: 1 } as const;
const digest = { type: 'string', pattern: '^[a-f0-9]{64}$' } as const;
const relativePath = { type: 'string', minLength: 1, pattern: '^(?!/)(?!.*(?:^|/)\\.\\.?(/|$))(?!.*//)(?!.*\\\\)[^\\u0000]+$' } as const;
const objectId = { type: 'string', pattern: '^(?:[a-f0-9]{40}|[a-f0-9]{64})$' } as const;
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const array = (items: unknown) => ({ type: 'array', items });
const strings = array(text);
const artifact = object({ path: relativePath, digest, kind: { enum: ['file', 'test'] } });
const requirement = object({ suiteId: text, format: { enum: ['node-tap-v13', 'junit-xml'] } });
const criterion = object({ id: text, text, sourcePath: relativePath, sourceDigest: digest, testRequirements: array(requirement) });
const context = object({ path: relativePath, anchor: text, digest }, ['path', 'digest']);
const change = object({ path: relativePath, beforeDigest: { anyOf: [digest, { const: 'missing' }] }, afterDigest: { anyOf: [digest, { const: 'missing' }] }, purpose: text });
const criterionEvidence = object({ criterionId: text, assessment: { enum: ['met', 'unmet', 'uncertain'] }, rationale: text, artifacts: array(artifact) });
const expansion = object({ path: relativePath, anchor: text, reason: text }, ['path', 'reason']);
export const workflowTestRequestSchema = object({ requestId: text, criterionIds: { ...strings, minItems: 1, uniqueItems: true }, executable: text, args: array({ type: 'string' }), reportFormat: { enum: ['node-tap-v13', 'junit-xml'] } });
const actor = object({ kind: { enum: ['human', 'model'] }, provider: text, model_id: text, session_id: text, harness: text, display_name: text, parentSessionId: text }, ['kind']);
const action = object({ kind: { enum: ['create', 'edit', 'review'] }, evidencePath: text, evidenceDigest: digest });
const revision = { oneOf: [object({ beforeDigest: digest, afterDigest: digest }), object({ reviewedDigest: digest })] };
export const contributionEventSchema = object({ eventId: text, requestId: text, spec: text, role: { enum: ['create', 'revise', 'review'] }, source: { enum: ['runtime', 'declared'] }, actor, action, revision });
export const workflowResultSchema = object({ protocol: { const: 1 }, requestId: text, baseDigest: digest, outcome: { enum: ['done', 'blocked', 'cancelled'] }, summary: { type: 'string' }, changes: array(change), criterionEvidence: array(criterionEvidence), gaps: strings, contextExpansion: array(expansion), contributionEvents: array(contributionEventSchema), openIssues: { type: 'string' }, nextKnows: { type: 'string' } });
const operationArguments = {
  'init': object({ harness: text }, []),
  'validate': object({}),
  'search': object({ query: text, kind: { enum: ['spec', 'plan'] }, status: text, root: text }, ['query']),
  'spec.new': object({ type: { enum: ['feature', 'architecture'] }, slug: text, root: text, title: text, implements: strings, extends: strings }, ['type', 'slug']),
  'spec.list': object({ status: text, type: { enum: ['feature', 'architecture'] }, root: text }, []),
  'spec.show': object({ id: text, root: text }, ['id']),
  'spec.validate': object({ ids: strings }, []),
  'spec.pin': object({ id: text, refs: strings, check: { type: 'boolean' } }, []),
  'spec.approve': object({ ids: { ...strings, minItems: 1 }, dryRun: { type: 'boolean' } }, ['ids']),
  'spec.reopen': object({ id: text, dryRun: { type: 'boolean' } }, ['id']),
  'plan.new': object({ id: text, title: text, specs: strings, dependsOn: strings, target: text, comparisonBase: text }, []),
  'plan.list': object({ status: text, live: { type: 'boolean' }, noFetch: { type: 'boolean' } }, []),
  'plan.show': object({ id: text }),
  'plan.graph': object({}),
  'plan.next': object({ id: text }),
  'plan.step-done': object({ id: text, outcome: { enum: ['done', 'blocked', 'skipped'] }, summary: text, recordingSet: text, type: text, changed: strings, deviation: strings, openIssue: strings, gap: strings, trailer: strings, nextKnows: { type: 'string' }, step: { type: 'integer', minimum: 1 }, force: { type: 'boolean' }, reason: text }, ['id', 'outcome', 'summary', 'recordingSet']),
  'plan.start': object({ id: text, target: text, noFetch: { type: 'boolean' } }, ['id']),
  'plan.shelve': object({ id: text, dryRun: { type: 'boolean' } }, ['id']),
  'plan.resume': object({ id: text, dryRun: { type: 'boolean' } }, ['id']),
  'plan.finish': object({ id: text, noFetch: { type: 'boolean' } }, ['id']),
  'plan.restack': object({ id: text, dryRun: { type: 'boolean' } }, ['id']),
  'plan.abandon': object({ id: text, deleteBranch: { type: 'boolean' }, force: { type: 'boolean' } }, ['id']),
  'plan.cleanup': object({ id: text, force: { type: 'boolean' } }, ['id']),
  'plan.archive': object({ id: text }),
  'plan.approve': object({ ids: { ...strings, minItems: 1 }, dryRun: { type: 'boolean' } }, ['ids']),
  'plan.index': object({ source: { enum: ['head', 'staged', 'working'] }, print: { type: 'boolean' }, live: { type: 'boolean' } }, []),
  'decision.new': object({ title: text }),
  'decision.accept': object({ ids: { ...strings, minItems: 1 }, dryRun: { type: 'boolean' } }, ['ids']),
  'spec.complete': object({ id: text, root: text, dryRun: { type: 'boolean' } }, ['id']),
  'spec.implementation': object({ id: text, status: { enum: ['incomplete', 'partial', 'complete'] }, root: text, dryRun: { type: 'boolean' } }, ['id', 'status']),
  'plan.retarget': object({ id: text, target: text, dryRun: { type: 'boolean' } }, ['id', 'target']),
  'docs.index': object({}),
  'docs.topic': object({ topicId: text }),
  'docs.search': object({ query: text }),
} as const;
export const mechanicalRequestSchema = { oneOf: Object.entries(operationArguments).map(([operation, args]) => object({ operation: { const: operation }, arguments: args })) };
const proposalFields = { protocol: { const: 1 }, requestId: text, resultDigest: digest, currentStateDigest: digest, paths: strings, evidenceDigest: digest, requiresConfirmation: { type: 'boolean' } };
export const recordingProposalSchema = { oneOf: Object.entries(operationArguments).map(([operation, args]) => object({ ...proposalFields, operation: { const: operation }, arguments: args })) };
export { artifact, criterion, context };
const asset = object({ path: text, sha256: digest, kind: { enum: ['core', 'reasoning', 'hook', 'instructions', 'docs', 'contract'] } });
const contract = object({ id: text, anchor: text, blob: { type: 'string', pattern: '^(?:[a-f0-9]{40}|[a-f0-9]{64})$' }, sha256: digest, path: text });
const semver = { type: 'string', pattern: '^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$' };
export const manifestSchema = object({
  schemaVersion: { const: 1 },
  extension: object({ id: text, version: semver, host: text }),
  core: object({ version: semver, protocol: { const: 1 }, contractVersion: { type: 'integer', minimum: 1 }, docsVersion: semver }),
  hostCompatibility: array(object({ surface: text, minVersion: semver, maxVersionExclusive: semver, evidence: text })),
  capabilities: object({ reasoning: { type: 'boolean' }, nativeCommands: { type: 'boolean' }, backgroundSessions: { type: 'boolean' } }),
  procedures: array(object({ workflow: text, contracts: { ...array(contract), minItems: 1 } })),
  assets: array(asset),
});
const contentDigest = { anyOf: [digest, { const: 'missing' }] };
const digestMap = { type: 'object', propertyNames: text, additionalProperties: contentDigest };
const base = object({ head: objectId, branch: text, configDigest: digest, inputDigests: digestMap, indexDigest: digest, digest });
const scopeProperties = { kind: text, specIds: strings, allowedEditPaths: strings };
const planScope = object({ ...scopeProperties, kind: { const: 'plan-step' }, planId: text, step: { type: 'integer', minimum: 1 }, expectedStatus: text, checkout: text, leaseId: text });
const nonPlanScopes = ['spec-assist', 'spec-draft-architecture', 'plan-create', 'plan-finish', 'validate', 'decision-new'].map(kind => object({ ...scopeProperties, input: { type: 'string' }, kind: { const: kind } }));
export const workflowRequestSchema = object({ protocol: { const: 1 }, requestId: text, workflow: text, extensionId: text, checkout: text, mode: { enum: ['attended', 'unattended'] }, base, scope: { oneOf: [planScope, ...nonPlanScopes] }, context: array(context), criteria: array(criterion), procedureDigests: digestMap });

export const confirmationChallengeSchema = object({ challengeId: text, operation: text, targets: strings, stateDigest: digest, payloadDigest: digest, evidenceDigest: digest, expiresAt: text, summary: text });
export const confirmationResponseSchema = object({ challengeId: text, decision: { enum: ['confirm', 'decline'] }, interactionId: text });
const evidenceFile = object({ path: relativePath, digest });
const reportEvidence = object({ path: relativePath, digest, format: { enum: ['node-tap-v13', 'junit-xml'] } });
const nullableText = { anyOf: [text, { type: 'null' }] };
const count = { type: 'integer', minimum: 0 };
export const assertionSchema = object({ suiteId: text, parentExecutionId: nullableText, executed: count, failed: count, skipped: count, evidence: reportEvidence });
export const testReceiptSchema = { ...object({ protocol: { const: 1 }, requestId: text, executionId: text, stateDigest: digest, executable: text, args: array({ type: 'string' }), checkout: text, exitCode: { anyOf: [{ type: 'integer' }, { type: 'null' }] }, signal: nullableText, stdout: evidenceFile, stderr: evidenceFile, assertions: array(assertionSchema) }), oneOf: [{ properties: { exitCode: { type: 'integer' }, signal: { type: 'null' } } }, { properties: { exitCode: { type: 'null' }, signal: text } }] };
export const testExecutionResultSchema = object({ artifact: object({ path: relativePath, digest, kind: { const: 'test' } }), executionId: text, exitCode: { anyOf: [{ type: 'integer' }, { type: 'null' }] }, signal: nullableText, assertions: array(assertionSchema) });

export const conductorRequestSchema = object({ plans: { ...strings, minItems: 1, uniqueItems: true }, until: { enum: ['step', 'finish'] }, maxSteps: { type: 'integer', minimum: 1 }, maxParallel: { type: 'integer', minimum: 1 }, maxBudgetUsd: { type: 'number', exclusiveMinimum: 0 }, timeoutSeconds: { type: 'number', exclusiveMinimum: 0 }, step: { type: 'integer', minimum: 1 }, force: { type: 'boolean' }, reason: text, dryRun: { type: 'boolean' } }, ['plans']);
export const contributionQuerySchema = object({ spec: text, requestId: text }, []);

const initiationFields = { protocol: { const: 1 }, extensionId: text, checkout: text, mode: { enum: ['attended', 'unattended'] } };
export const workflowInitiationSchema = { oneOf: [
  object({ ...initiationFields, workflow: { const: 'plan-step' }, selection: object({ planId: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9]+(?:-[a-z0-9]+)*$' }, step: { type: 'integer', minimum: 1 }, force: { type: 'boolean' }, reason: text }, ['planId']) }),
  object({ ...initiationFields, workflow: { enum: ['spec-assist', 'spec-draft-architecture', 'plan-create', 'validate', 'decision-new'] }, selection: object({ specIds: { type: 'array', uniqueItems: true, items: { type: 'string', pattern: '^[a-zA-Z0-9_-]+:(feature|architecture)/[a-z0-9/-]+$' } }, input: { type: 'string' } }) })
] };
export const reviewedTestMappingSchema = object({ schemaVersion: { const: 1 }, workflow: text, criteria: array({ oneOf: [
  object({ sourcePath: relativePath, sourceDigest: digest, criterionIndex: { type: 'integer', minimum: 1 }, evidence: { const: 'test' }, testRequirements: { ...array(requirement), minItems: 1, uniqueItems: true } }),
  object({ sourcePath: relativePath, sourceDigest: digest, criterionIndex: { type: 'integer', minimum: 1 }, evidence: { const: 'inspection' }, testRequirements: { ...array(requirement), maxItems: 0 } })
] }) });
