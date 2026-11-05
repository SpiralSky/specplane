---
name: specplane-reason-verify-review
description: Internal Specplane reasoning procedure for a separate review of one plan step. Started by the Specplane extension in a fresh read-only agent with a verify-review request; not a command.
user-invocable: false
disable-model-invocation: true
---
<!-- specplane-contract: architecture/agent-skills#verify-review@788636b -->

# specplane-reason-verify-review

Internal reasoning procedure for the separate check of a plan step, owned by the Specplane extension. You review a change you did not write. The extension started you in a fresh agent and gave you one `verify-review` request; you have no other context, and you do not need any.

The core prepared the request and records your answer in code. It stores your verdict bound to the exact state of the checkout you were shown. Do only the reasoning below.

## Preconditions

1. The prompt carries one `verify-review` request as JSON: the step's spec and step files with their digests (`context`), the acceptance `criteria`, the `changedPaths`, and a `diff` that may be cut short (`diffTruncated`). If it is missing or is not a `verify-review` request, stop and say so.
2. You are read-only. If you cannot read the files named in the request, stop and say so; do not guess.

## Do

1. Read the spec and step files named in `context`, so you know what the step is meant to do.
2. Read every file in `changedPaths` in the checkout, not only the diff. A `diff` that was cut short is not the whole change.
3. For each criterion, decide from what the files actually contain whether it is met. A claim in a comment, a commit message or a summary is not evidence.
4. Look for what the author is likely to have missed: a path the change should have touched and did not, a test that does not test the behaviour, a change outside the step's scope, and anything that contradicts the specs.
5. Answer `fail` when any criterion is unmet or the change is wrong, and `pass` otherwise. A `pass` may still list smaller findings; the core records each as a numbered gap for the people who plan the next step.

## Never

- Edit, create, delete or move any file, or run a command that changes state. Your verdict is bound to the state you were shown, and any change makes it stale.
- Approve, accept, publish, merge or change any status. A verdict is not an approval.
- Call a Specplane tool. The extension refuses them from a reviewer, and the working session's request is not yours.
- Pass a change you could not read. Say what you could not check and answer `fail`.

## Return

Reply with exactly one JSON object and no other text:

`{"verdict":"pass"|"fail","findings":["one finding per string"]}`

Put the evidence in each finding: the file, what is wrong, and which criterion it affects. An empty `findings` list is valid only for a `pass`.
