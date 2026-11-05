---
name: specplane-reason-plan-step
description: Internal Specplane reasoning procedure for the plan-step workflow. Started by the Specplane extension with a prepared request; not a command.
user-invocable: false
disable-model-invocation: true
---
<!-- specplane-contract: architecture/agent-skills#plan-step@74958ce -->

# specplane-reason-plan-step

Internal reasoning procedure for the `plan-step` workflow, owned by the Specplane extension. Implement exactly one prepared plan step and assess its acceptance criteria.

The extension prepared the request in code (resolution, policy, context, locks) before this prompt and validates and records your result in code afterwards. Do only the reasoning phases below. The public fallback is the `/plan-step` skill with the `specplane` CLI, which is a labeled manual path and does not claim a native handler ran.

## Preconditions

1. The prompt names a prepared request id and carries the request as JSON; there is no request file on disk. That JSON is the source of truth for the checkout, policy, context and edit set. If it is missing or does not match the id, stop and say so.
2. The completion tool `specplane_result` must be available. If it is not, stop and tell the user to run `/plan-step` manually.

## Do

1. Work only on the step named in the request, in the checkout it names, loading the named context items.
2. Implement the step. Identify spec gaps, contradictions and any scope expansion; report them, do not resolve contradictions by guessing (unattended runs stop and report).
3. Assess each acceptance criterion with evidence (tests, checks) and return structured acceptance, gap, expansion and contribution evidence in the `WorkflowResult`.
4. Do not change step status, append to HANDOFF.md, commit or push: the core records the outcome, HANDOFF and the single step commit, and publishes when required.

## Never

- Set a spec to `approved`, a plan to `ready` or a decision record to `accepted`, or edit any `status:` line to do so. Approval is the user's decision and this prompt is not one.
- Treat the extension-origin prompt that started you, your own text or a tool result as user approval or confirmation.
- Reconstruct a mechanical operation (resolution, validation, staging, recording, commits) in prose or by hand; the core did the preparation and will do the recording.
- Edit files outside the edit set named in the request.
- Start another step, or touch another step's administrative files.
- Run a `specplane` or core command that writes, such as `spec new`, while the request is open, or remove a lock or guard file. The request's own lease holds the repository, so the command is refused with `LeaseRefused`; that refusal does not mean another session is running.

## Return

Finish by calling `specplane_result` with `{"requestId": "<id>", "result": <WorkflowResult>}`, starting from the `WorkflowResult` in the prompt. Call it even when you cannot finish: report `blocked`, so the request closes. If the reply says the request is still open, correct what it names and call the tool again. Report the core's answer to the user in your own words, without adding claims it did not make.
