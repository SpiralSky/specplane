---
name: specplane-reason-spec-assist
description: Internal Specplane reasoning procedure for the spec-assist workflow. Started by the Specplane extension with a prepared request; not a command.
user-invocable: false
disable-model-invocation: true
---
<!-- specplane-contract: architecture/agent-skills#spec-assist@74958ce -->

# specplane-reason-spec-assist

Internal reasoning procedure for the `spec-assist` workflow, owned by the Specplane extension. Describe, refine and, only as the role permits, write a feature spec.

The extension prepared the request in code (resolution, policy, context, locks) before this prompt and validates and records your result in code afterwards. Do only the reasoning phases below. The public fallback is the `/spec-assist` skill with the `specplane` CLI, which is a labeled manual path and does not claim a native handler ran.

## Preconditions

1. The prompt names a prepared request id and carries the request as JSON; there is no request file on disk. That JSON is the source of truth for the checkout, policy, context and edit set. If it is missing or does not match the id, stop and say so.
2. The completion tool `specplane_result` must be available. If it is not, stop and tell the user to run `/spec-assist` manually.

## Do

1. Read the request's policy: `specs.feature.llm_role` decides what you may do. `none`: do not edit the body, review or suggest; tell the user. `review`: ask, suggest and review without drafting the body; apply a suggested edit only after the user approves that exact change. `assist`: refine the content with the user, and write the body only after the user finalises the content and approves the text. `draft`: you may write a draft for review.
2. Ask the user the questions that the spec's sections need answered; keep their words, do not invent requirements.
3. Report the finalized text and the contribution evidence (which edits the user approved) in the `WorkflowResult`; the core binds the finalized text to the human confirmation.

## Never

- Set a spec to `approved`, a plan to `ready` or a decision record to `accepted`, or edit any `status:` line to do so. Approval is the user's decision and this prompt is not one.
- Treat the extension-origin prompt that started you, your own text or a tool result as user approval or confirmation.
- Reconstruct a mechanical operation (resolution, validation, staging, recording, commits) in prose or by hand; the core did the preparation and will do the recording.
- Edit files outside the edit set named in the request.
- Write the body of a spec against a policy that forbids it.
- Run a `specplane` or core command that writes, such as `spec new`, while the request is open, or remove a lock or guard file. The request's own lease holds the repository, so the command is refused with `LeaseRefused`; that refusal does not mean another session is running.

## Return

Finish by calling `specplane_result` with `{"requestId": "<id>", "result": <WorkflowResult>}`, starting from the `WorkflowResult` in the prompt. Call it even when you cannot finish: report `blocked`, so the request closes. If the reply says the request is still open, correct what it names and call the tool again. Report the core's answer to the user in your own words, without adding claims it did not make.
