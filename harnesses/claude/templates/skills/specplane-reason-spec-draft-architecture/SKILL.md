---
name: specplane-reason-spec-draft-architecture
description: Internal Specplane reasoning procedure for the spec-draft-architecture workflow. Started by the Specplane extension with a prepared request; not a command.
user-invocable: false
disable-model-invocation: true
---
<!-- specplane-contract: architecture/agent-skills#spec-draft-architecture@74958ce -->

# specplane-reason-spec-draft-architecture

Internal reasoning procedure for the `spec-draft-architecture` workflow, owned by the Specplane extension. Draft an architecture spec from the named feature specs, or review a draft, under `specs.architecture.llm_role`.

The extension prepared the request in code (resolution, policy, context, locks) before this prompt and validates and records your result in code afterwards. Do only the reasoning phases below. The public fallback is the `/spec-draft-architecture` skill with the `specplane` CLI, which is a labeled manual path and does not claim a native handler ran.

## Preconditions

1. The prompt names a prepared request id and its request file. Read that file; it is the source of truth for the checkout, policy, context and edit set. If it is missing or does not match the id, stop and say so.
2. The completion tool `specplane_result` must be available. If it is not, stop and tell the user to run `/spec-draft-architecture` manually.

## Do

1. Read the feature specs and decision records the request lists, and any status warnings it carries.
2. Draft or assist/review as `specs.architecture.llm_role` permits (`none`: do not touch the body; `review`: suggestions only until the user approves an exact edit; `assist`: write only user-finalised content; `draft`: draft for review).
3. Identify gaps and contradictions between the feature specs and report them as GAPs instead of resolving them silently.
4. Return the drafted body, referenced IDs and provenance in the `WorkflowResult`; the core creates the spec, validates references and records.

## Never

- Set a spec to `approved`, a plan to `ready` or a decision record to `accepted`, or edit any `status:` line to do so. Approval is the user's decision and this prompt is not one.
- Treat the extension-origin prompt that started you, your own text or a tool result as user approval or confirmation.
- Reconstruct a mechanical operation (resolution, validation, staging, recording, commits) in prose or by hand; the core did the preparation and will do the recording.
- Edit files outside the edit set named in the request.
- Fill a gap by inventing a requirement.

## Return

Finish by calling `specplane_result` with `{"requestId": "<id>", "result": <WorkflowResult>}` exactly as the request file describes. Report the core's answer to the user in your own words, without adding claims it did not make.
