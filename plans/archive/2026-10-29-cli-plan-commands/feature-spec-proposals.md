# Feature-spec proposals: plan-status and plan-index

**Applied 2026-10-29** (user-approved, pasted verbatim): (a), (b), (c).

This file is the applied proposal record: these edits are in the approved feature specs. The sections below are kept for traceability, not as pending suggestions.

## (a) `feature/plan-status`: abandon from which stored statuses

**Target**: `docs/specifications/features/plan-status.md`, section "Transition rules for stored statuses", the first bullet (also `feature/plan-execution` § "Abandoning a plan", which does not say which statuses are allowed either).

**Current text**:

> - Any stored plan may be set to `abandoned` from `draft` or `ready`.

The paragraph above it says `in_progress` or `review` may also move to `abandoned` in frontmatter mode. Taken together, the wording ("any stored plan", "any non-terminal plan" in the abandon flow) does not list which stored statuses are accepted, and `abandon` has to decide for each of `draft`, `ready`, `in_progress`, `review`, `done`, `abandoned`.

**Proposed replacement**:

> - A plan may be set to `abandoned` from any non-terminal stored status: `draft`, `ready`, and, with `status_source: frontmatter`, `in_progress` and `review`. With `status_source: git` the stored status of a started plan is still `ready`, so it is abandoned from `ready`.
> - Abandoning a plan whose stored status is `done` or `abandoned` fails: "Cannot abandon plan: `<id>` is `<status>`."

**Reason**: the command needs an exact accept list and an error for the rest; the explicit list also removes the apparent conflict between "from `draft` or `ready`" and the frontmatter-mode sentence.

## (b) `feature/plan-status`: stack mode, `ready` plan with two or more unmerged dependencies

**Target**: `docs/specifications/features/plan-status.md`, section "Edge cases", the stack-mode bullet (and "Effective status").

**Current text**:

> - When `dependency_mode: stack`, the `blocked` derived status is not computed. Stacked plans may start from the dependency's branch tip (see `feature/plan-execution` for the limits).

**Problem**: `feature/plan-execution` § "Start with stacking" makes a `ready` plan with two or more unmerged dependencies fail to start ("Cannot stack on more than one unmerged dependency: <a>, <b>."). Because `blocked` is not computed in stack mode, such a plan shows as plain `ready`, which suggests it can be started. It is neither startable nor described.

**Proposed replacement**:

> - When `dependency_mode: stack`, `blocked` is computed only for a `ready` plan that cannot start: it has two or more dependencies that are not done. Such a plan is displayed as `blocked`, with the message "Cannot stack on more than one unmerged dependency: <a>, <b>." A `ready` plan with at most one unmerged dependency is not `blocked`; it may start from that dependency's branch tip (see `feature/plan-execution` for the limits).

**Reason**: the displayed status should match what `plan start` will do; reusing `blocked` and the existing start-failure message keeps one status vocabulary and one wording.

## (c) `feature/plan-index`: split Scenario 5

**Target**: `docs/specifications/features/plan-index.md`, "Acceptance scenarios", Scenario 5.

**Current text**:

> ### Scenario 5: PLANS.md never manually edited
>
> Given a developer edits `PLANS.md` by hand,
> When `specplane generate` is run (or CI regenerates it),
> Then the manual edits are overwritten.
> And validation warns if `PLANS.md` does not match the generated version: "PLANS.md is stale; run `specplane generate` to update."

**Problem**: one scenario covers two behaviours, overwriting hand edits on generate, and validation reporting a stale file. Conflict handling is already Scenario 2 and is not part of this one. A test (or reader) cannot tell which "Then" belongs to which trigger, and the "And" clause has no trigger of its own.

**Proposed replacement**:

> ### Scenario 5: Hand edits are overwritten on generate
>
> Given a developer edits `PLANS.md` by hand,
> When `specplane generate` is run (or CI regenerates it),
> Then the manual edits are overwritten and `PLANS.md` equals the generated version.
>
> ### Scenario 5a: Validation warns when PLANS.md is stale
>
> Given `PLANS.md` differs from the version `specplane generate` would produce,
> When `specplane validate` is run,
> Then a warning is reported: "PLANS.md is stale; run `specplane generate` to update."

**Reason**: one trigger and one outcome per scenario; the numbering `5a` follows the existing `4a` and avoids renumbering Scenario 6 and anything that references it.
