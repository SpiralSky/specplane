---
name: specplane-reason-plan-step
description: Internal Specplane reasoning procedure for the plan-step workflow. Started by the Specplane extension with a prepared request; not a command.
user-invocable: false
disable-model-invocation: true
---
<!-- specplane-contract: architecture/agent-skills#plan-step@788636b -->

# specplane-reason-plan-step

Internal reasoning procedure for the `plan-step` workflow, owned by the Specplane extension. Implement exactly one prepared plan step and assess its acceptance criteria.

The extension prepared the request in code (resolution, policy, context, locks) before this prompt and validates and records your result in code afterwards. Do only the reasoning phases below. Without the extension, the `specplane` CLI is a labeled manual path, which does not claim a native handler ran.

## Preconditions

1. The prompt names a prepared request id and carries the request as JSON; there is no request file on disk. That JSON is the source of truth for the checkout, policy, context and edit set. If it is missing or does not match the id, stop and say so.
2. The completion tool `specplane_result` must be available. If it is not, stop and tell the user that the Specplane extension is not available, so `/plan-step` cannot run here; the `specplane` CLI is the labeled manual path.

## Do

1. Work only on the step named in the request, in the checkout it names, loading the named context items.
2. Implement the step. Identify spec gaps, contradictions and any scope expansion; report them, do not resolve contradictions by guessing (unattended runs stop and report).
   - Record a gap as the next numbered six-field entry in the plan's `spec-gaps.md`, list that file in `changes`, and name the entry in `gaps`. Finish these edits before requesting a review. If a review has findings, core writes that file itself: restore it, report your gap in `openIssues`, and request a new review.
3. Assess each acceptance criterion with evidence (tests, checks) and return structured acceptance, gap, expansion and contribution evidence in the `WorkflowResult`.
   - A criterion with empty `testRequirements` is assessed by citing files, and is recorded as self-assessed. Each cited file is an `artifacts` entry `{"path", "digest", "kind": "file"}`, where `digest` is the 64-character hex SHA-256 from `sha256sum <path>`.
   - Run tests only by calling `specplane_run_tests` with `{"requestId": "<id>"}` after the edits are final. It runs the suites the repository configures for this step. The core finds step-level receipts itself; cite a receipt in `criterionEvidence[].artifacts` only for a criterion whose `testRequirements` are not empty. Never run a test command yourself or write a receipt: a receipt the core did not produce is not evidence.
   - Run every configured suite the step's tier requires.
   - Request a separate review by calling `specplane_request_review` with `{"requestId": "<id>"}` when the step changes a path under `risk_paths` or inside a spec root, when the prompt or a refusal says the verification settings changed after the plan started (only a human check meets that), or when you are unsure of your own judgment. Request it after the edits and tests are final. The reviewer is a fresh read-only agent that sees the spec context, the criteria and the diff, not this conversation. Call the tool again with the same `requestId` to read the verdict. A change to any file afterwards makes the review stale, so do not edit while it runs.
   - A `fail` verdict does not meet the check. Fix what the findings name and request a new review, or end the step `blocked`. Do not retype the findings as gaps: the core writes them to `spec-gaps.md` when it records the step.
   - If no review can be started, or the settings changed, put `verificationRequest` `{"kind": "human-check", "reason": "<why>"}` in the result. The user is shown your reason and confirms or declines it. To skip a check or lower the minimum, put `requestedTier` (the lower tier) and `verificationRequest` `{"kind": "lower-minimum", "reason": "<why>"}` in the result. Your own statement never meets a check or lowers a minimum, and a request with no one to ask (unattended, or no confirmation dialog) is refused: end the step `blocked` and name the missing check in a `BLOCKED:` open issue.
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
