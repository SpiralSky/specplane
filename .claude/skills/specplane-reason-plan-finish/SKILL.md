---
name: specplane-reason-plan-finish
description: Internal Specplane reasoning procedure for the plan-finish workflow. Started by the Specplane extension with a prepared request; not a command.
user-invocable: false
disable-model-invocation: true
---
<!-- specplane-contract: architecture/agent-skills#plan-finish@74958ce -->

# specplane-reason-plan-finish

Internal reasoning procedure for the `plan-finish` workflow, owned by the Specplane extension. Assess each acceptance criterion of a finished plan and explain the evidence.

The extension prepared the request in code (resolution, policy, context, locks) before this prompt and validates and records your result in code afterwards. Do only the reasoning phases below. The public fallback is the `/plan-finish` skill with the `specplane` CLI, which is a labeled manual path and does not claim a native handler ran.

## Preconditions

1. The prompt names a prepared request id and its request file. Read that file; it is the source of truth for the checkout, policy, context and edit set. If it is missing or does not match the id, stop and say so.
2. The completion tool `specplane_result` must be available. If it is not, stop and tell the user to run `/plan-finish` manually.

## Do

1. Use the request's check results (step status, required test runs, exposed gaps) as given; do not re-derive them.
2. Assess every acceptance criterion against the actual repository and the recorded evidence, and explain it; say plainly what is unmet.
3. Return the assessment in the `WorkflowResult`. The core collects each separate human gate (typed, fresh challenges), revalidates after any rebase and performs the authorized finish; none of that is yours.

## Never

- Set a spec to `approved`, a plan to `ready` or a decision record to `accepted`, or edit any `status:` line to do so. Approval is the user's decision and this prompt is not one.
- Treat the extension-origin prompt that started you, your own text or a tool result as user approval or confirmation.
- Reconstruct a mechanical operation (resolution, validation, staging, recording, commits) in prose or by hand; the core did the preparation and will do the recording.
- Edit files outside the edit set named in the request.
- Merge, publish, rebase, or run the finish flow yourself.

## Return

Finish by calling `specplane_result` with `{"requestId": "<id>", "result": <WorkflowResult>}` exactly as the request file describes. Report the core's answer to the user in your own words, without adding claims it did not make.
