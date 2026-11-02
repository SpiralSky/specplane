# Cloud input snapshot handoff

This snapshot is the input to the hosted overnight run, not a completed plan or
an implementation run. Start from `snapshot/specplane-overnight-inputs-20261102`.
Follow `docs/work-records/overnight-codex-prompt.md` for the authorized isolated
review-branch workflow; create a new review branch rather than modifying this
input branch or invoking managed lifecycle approvals.

## Included state

- Integration history through `6a620d7`, including base `37a77e1`, prompt
  `3a5b997`, and the proposed path-history remediation checklist.
- Original target-lifecycle step-1 commit `346425f`, retained as an ancestor by
  merging its branch history rather than cherry-picking or changing its SHA.
- The three previously uncommitted target-lifecycle step-2 files, preserved
  byte-for-byte and committed solely for transport. Hashes are in
  `docs/work-records/cloud-input-snapshot.json`.
- The proposed step-2 decomposition, copied as a proposal only. Managed plan
  steps and lifecycle records have not been changed to apply that proposal.

## Completion status and next work

Core foundation is finished and archived. Target-lifecycle step 1 is recorded
as done. Step 2 has only partial plan-creation support: target/comparison inputs,
validation and dry run. Start, first-start binding/recovery and resume criteria
are still incomplete. Do not mark step 2 complete based on its transport commit.

There are 32 remaining original roadmap steps. Splitting original step 2 into
four worker assignments yields 35 assignments without changing original scope.
Start by reviewing the preserved partial work and remaining step-2 criteria;
completion assessment can proceed in a separate independent worktree.

Historical observations: target step 1 build and 34 focused tests passed before
its branch validation repair; build and 5 context tests passed after repair.
The partial plan-creation work had build, 14 command tests and diff checks
reported passing. These are prior observed results, not fresh snapshot tests
or core-issued receipts. Revalidate as required by subsequent changes.

The earlier 50–102-hour estimate is not a reliable execution forecast. Later
session-log analysis suggested roughly four hours of worker critical-path work,
excluding integration overhead and based on sparse historical measurements.
Neither estimate is a deadline or a reason to stop.

## Deliberate exclusions and preservation

Unrelated local edits, `problems.md`, old incomplete draft archives and private
session logs are not inputs to this run and were not copied. Original local
worktrees and their dirty files are unchanged. The old conductor branch/worktree
must not be resumed or deleted. Required current requirements and completed core
implementation are present; historical scratch evidence is not needed to begin.

Skip live Claude/Codex host/model testing and package publication, while running
applicable non-live checks. Preserve explicit blocked/deferred certification.
The path-history removal checklist is a separate proposed maintenance task:
do not rewrite history, force-push or execute that checklist during this run.

## Cloud setup

Select this input branch when configuring the hosted repository. If the platform
only initially checks out `main`, fetch and switch to this branch using permitted
Git access, then verify the original commits and file hashes before dispatch.
A published environment created earlier may need its source branch updated and
a new task started. Publishing an old snapshot does not import these files.
Use cloud-local paths and verify that execution is independent of my computer.
