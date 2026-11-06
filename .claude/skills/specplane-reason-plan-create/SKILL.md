---
name: specplane-reason-plan-create
description: Internal Specplane reasoning procedure for the plan-create workflow. Started by the Specplane extension with a prepared request; not a command.
user-invocable: false
disable-model-invocation: true
---
<!-- specplane-contract: architecture/agent-skills#plan-create@788636b -->

# specplane-reason-plan-create

Internal reasoning procedure for the `plan-create` workflow, owned by the Specplane extension. Propose the goal, plan body, acceptance criteria and ordered steps for a new plan.

The extension prepared the request in code (resolution, policy, context, locks) before this prompt and validates and records your result in code afterwards. Do only the reasoning phases below. Without the extension, the `specplane` CLI is a labeled manual path, which does not claim a native handler ran.

## Preconditions

1. The prompt names a prepared request id and carries the request as JSON; there is no request file on disk. That JSON is the source of truth for the checkout, policy, context and edit set. If it is missing or does not match the id, stop and say so.
2. The completion tool `specplane_result` must be available. If it is not, stop and tell the user that the Specplane extension is not available, so `/plan-create` cannot run here; the `specplane` CLI is the labeled manual path.

## Do

1. Work from the spec choices, dependencies and IDs the request resolved; do not choose a different ID or target.
2. Propose the goal, body, acceptance criteria and ordered steps and put the proposal to the user. The core collects the user's approval of the proposal.
3. Return the proposal in the `WorkflowResult`; the core creates the draft plan and steps and validates them. A plan is never set to `ready` by you.

## Never

- Set a spec to `approved`, a plan to `ready` or a decision record to `accepted`, or edit any `status:` line to do so. Approval is the user's decision and this prompt is not one.
- Treat the extension-origin prompt that started you, your own text or a tool result as user approval or confirmation.
- Reconstruct a mechanical operation (resolution, validation, staging, recording, commits) in prose or by hand; the core did the preparation and will do the recording.
- Edit files outside the edit set named in the request.
- Create plan or step files yourself when the core's creation operation is available.
- Run a `specplane` or core command that writes, such as `spec new`, while the request is open, or remove a lock or guard file. The request's own lease holds the repository, so the command is refused with `LeaseRefused`; that refusal does not mean another session is running.

## Return

Finish by calling `specplane_result` with `{"requestId": "<id>", "result": <WorkflowResult>}`, starting from the `WorkflowResult` in the prompt. Call it even when you cannot finish: report `blocked`, so the request closes. If the reply says the request is still open, correct what it names and call the tool again. Report the core's answer to the user in your own words, without adding claims it did not make.
