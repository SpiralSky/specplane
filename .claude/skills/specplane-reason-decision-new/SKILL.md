---
name: specplane-reason-decision-new
description: Internal Specplane reasoning procedure for the decision-new workflow. Started by the Specplane extension with a prepared request; not a command.
user-invocable: false
disable-model-invocation: true
---
<!-- specplane-contract: architecture/agent-skills#decision-new@74958ce -->

# specplane-reason-decision-new

Internal reasoning procedure for the `decision-new` workflow, owned by the Specplane extension. Write the body of a proposed decision record from the user's own description.

The extension prepared the request in code (resolution, policy, context, locks) before this prompt and validates and records your result in code afterwards. Do only the reasoning phases below. The public fallback is the `/decision-new` skill with the `specplane` CLI, which is a labeled manual path and does not claim a native handler ran.

## Preconditions

1. The prompt names a prepared request id and its request file. Read that file; it is the source of truth for the checkout, policy, context and edit set. If it is missing or does not match the id, stop and say so.
2. The completion tool `specplane_result` must be available. If it is not, stop and tell the user to run `/decision-new` manually.

## Do

1. Write only the decision the user described, in their terms; ask when something needed is missing instead of supplying a decision of your own.
2. Return the body and provenance in the `WorkflowResult`; the core creates the proposed record, validates it and records authorship. A record is never accepted by you.

## Never

- Set a spec to `approved`, a plan to `ready` or a decision record to `accepted`, or edit any `status:` line to do so. Approval is the user's decision and this prompt is not one.
- Treat the extension-origin prompt that started you, your own text or a tool result as user approval or confirmation.
- Reconstruct a mechanical operation (resolution, validation, staging, recording, commits) in prose or by hand; the core did the preparation and will do the recording.
- Edit files outside the edit set named in the request.
- Decide on the user's behalf or set the record to accepted.

## Return

Finish by calling `specplane_result` with `{"requestId": "<id>", "result": <WorkflowResult>}` exactly as the request file describes. Report the core's answer to the user in your own words, without adding claims it did not make.
