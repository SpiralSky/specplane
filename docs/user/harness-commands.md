---
title: Harness commands
summary: The typed commands of a harness and what each reports back.
related: [harnesses, commands, permissions]
---

# Harness commands

These descriptions are packaged as the default command documentation. Custom instructions replace this documentation only; action checks and command procedures remain. Commands without arguments do not start a model turn. Typed approval by ID, spec viewing and the requests pane are user-only operations.

## spec-assist

Write or edit a feature or architecture specification with the user (`harness R19`, `specifications R4`).

Say what changed, that changed content is awaiting-review, and that approval is a separate permission-checked action.

## spec-draft-architecture

Generate an architecture specification from features, or a feature specification from requirements (`specifications R67`).

Name the new awaiting-review specification, its source cites, uncovered parts and open questions, and its model author.

## plan-create

Create an optional plan, or propose later changes to one (`plans R69`, `plan-execution R31`).

Give the plan ID, path and steps. Nothing has started; approval is separate.

## plan-start

Start a plan in its own branch and worktree (`plan-execution R27`, `R27.6`). This contract is wholly mechanical.

Give the plan ID, branch, worktree and actual session-launch result. The original checkout stays unchanged.

## plan-step

Execute the next selected plan steps in order, one at a time (`plan-execution R27`, `R27.4`, `plans R28`).

Report outcome, files changed, tests, gap IDs, open issues, requests and the next step.

## plan-finish

Present the final review and the user decision, with merging separate (`plan-execution §2`, `plans R28`, `R28.1`).

Show the review, decision or pending request, and separate merge options.

## plan-status

Show plan execution state and what is waiting (`plan-execution R31`, `architecture/reference-cli §11.2`). This contract is wholly mechanical.

List each plan with status, stop reason, next step and waiting specifications or requests.

## validate

Check specifications and show warnings and coverage (`verification R12`, `R64`).

Report findings, coverage gaps and suggested fixes; distinguish errors from warnings.

## verify

Judge an architecture specification against its implementation and record evidence (`verification R36.1`, `R61.2`, `R61.3`).

Give per-section outcomes, recorded versus unrecorded evidence, and implementation status at the checked commit.

## approve

Approve specified IDs under the acting role and dependency checks (`harness R20`, `R20.1`, `cli R16`).

Name the approved IDs or exact pending request or refusal, including any approval group.

## spec-view

Show the user one specification with its status and the change since its last approval, with no model turn (`harness R21`, `R21.1`).

Type `spec-view <id>` (a bare slug such as `plan-execution` works when it names one spec) to see the spec's status, authors and approval, then the change since the last approval as a diff, then the text. In a terminal additions are green and deletions red; elsewhere they keep the `+` and `-` markers. A spec never approved is shown as all new; a requirement file, which has no approval record, shows its change since the last commit. Without an ID the command lists every spec with its status. Viewing is a read and uses the `info.retrieve` permission; it has no permission of its own. It needs the viewing capability, so it is offered on Claude Code only (see `harnesses`).

## requests

Open the requests pane for the user, with no model turn (`requests R52.1`, `R52.2`, `R52.4`).

Show pending requests and their results in the pane; start no model turn.

## plan-abandon

End a plan that will not be completed (`plan-execution §3`).

Report the result, kept branch or dirty worktree, and dependent plans that can no longer start.
