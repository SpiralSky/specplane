---
id: feature/plan-status
title: "Plan status model: stored vs. derived statuses and status sources"
status: approved
author: mixed
---

# Plan status model: stored vs. derived statuses and status sources

Plan status tracks where a plan is in its lifecycle. Specplane separates **stored** statuses (written to frontmatter) from **derived** statuses (computed from git and forge state) to avoid requiring commits to `main` just to record progress.

---

## Stored statuses

Stored statuses live in `PLAN.md` frontmatter and are changed through normal commits and PRs.

| Status | Meaning |
|--------|---------|
| `draft` | The plan is not yet ready to execute. Specs may be incomplete, steps may not be fully defined. |
| `ready` | The plan is approved for execution. Dependencies and spec requirements will be checked at start time. |
| `done` | The plan is complete. Set in the final commit of the plan branch; it reaches the default branch when that branch is merged. |
| `abandoned` | The plan will not be completed. Kept for traceability. |
| `shelved` | Started work is paused with the intention that it may resume. Plan records, branch, worktree, and step progress are retained. Stored in both status-source modes. |

With `status_source: frontmatter`, `in_progress` and `review` are also stored statuses (see below).

### Transition rules for stored statuses

```
draft ──► ready ──► done
  ▲         │
  └─────────┘  (returned to draft for rework)
draft ──► abandoned
ready ──► abandoned
```

With `status_source: frontmatter` the path through execution is stored as well: `ready ──► in_progress ──► review ──► done`, and `in_progress` or `review` may also move to `abandoned`.

- A plan may be set to `abandoned` from any non-terminal stored status: `draft`, `ready`, `shelved`, and, with `status_source: frontmatter`, `in_progress` and `review`. With `status_source: git` the stored status of a started plan is still `ready`, so it is abandoned from `ready`.
- Abandoning a plan whose stored status is `done` or `abandoned` fails: "Cannot abandon plan: `<id>` is `<status>`."
- `done` is a terminal state; a done plan is not re-opened (create a new plan instead).
- `abandoned` is a terminal state. It retains the plan; it does not mean deleted.
- A started, non-terminal plan may move to `shelved`: in Git mode its stored status is `ready` and its plan branch exists; in frontmatter mode its stored status is `in_progress` or `review`. An unstarted plan, `draft`, `done`, or `abandoned` cannot be shelved.
- Explicit resume restores the pre-shelving stored status, then recomputes derived status from current dependencies, branch and PR state. It does not reset completed steps or grant a new approval. In Git mode: `ready` with a branch → `shelved` → `ready` with a branch. In frontmatter mode: `in_progress` or `review` → `shelved` → the previous stored status.
- A shelved plan may instead be abandoned. A shelved dependency remains valid but is not complete; it does not satisfy a wait-for-merge dependency or qualify as a base for starting new stacked work.
- Shelving is not a step status. Existing step outcomes and recorded progress remain unchanged.

---

## Derived statuses

Derived statuses are computed at read time from plan frontmatter, git, and forge state. They are never stored in frontmatter (by default).

| Derived status | Condition |
|----------------|-----------|
| `blocked` | At least one plan in `depends_on` is not `done`, and `dependency_mode: wait_for_merge`. |
| `in_progress` | The branch `plan/<id>` exists (locally or on the remote). Only with `status_source: git`. |
| `review` | An open pull request exists for the branch `plan/<id>`. Only with `status_source: git` and forge integration (see `plans.forge`). |

### Effective status

Derived statuses apply **only to plans whose stored status is `ready`**. Every other stored status (`draft`, `shelved`, `done`, `abandoned`, and the stored `in_progress`/`review` of frontmatter mode) is displayed as-is. For a `ready` plan, the first matching rule wins:

```
blocked  >  review  >  in_progress  >  ready
```

Examples:
- `ready` + branch exists + no PR → `in_progress`
- `ready` + branch exists + open PR → `review`
- `ready` + dependency not done → `blocked`
- `done` + branch still exists → `done`
- `shelved` + branch exists + open PR → `shelved`, with no automatic execution
- `shelved` + unmet dependencies → `shelved`; dependency details remain visible
- `draft` + branch exists → `draft` (a draft plan cannot be started; the stray branch is not treated as progress)

---

## Status source setting

The `plans.status_source` config key controls how `in_progress` and `review` are handled.

### `status_source: git` (default)

`in_progress` and `review` are **derived** from git and forge state. The frontmatter is not updated for these states.

**Advantages**:
- No "claim commits" needed on main. Main is not dirtied by status updates.
- Compatible with protected branches (no direct pushes to main required).
- Status is always accurate; it cannot be stale.

**Disadvantages**:
- Requires reading git state (branch list) and optionally forge state (PR list) on every status query.
- Without forge integration, `review` cannot be derived; it falls back to `in_progress`. With `merge: local_merge` no pull request is opened, so a plan is shown as `in_progress` until it is merged and `done`.
- Status is not visible in the frontmatter file itself; tools must know to compute it.

### `status_source: frontmatter`

`in_progress` and `review` are **stored** in frontmatter like `draft`, `ready`, `done`, and `abandoned`. They are written by **claim commits** made directly on the default branch, so that the default branch — the place people read status from — shows them:

1. **Start**: before the plan branch is created, a claim commit sets `status: in_progress` on the default branch. The plan branch is then created from that commit, so it carries the same value.
2. **Finish**: before the final commit, a claim commit sets `status: review` on the default branch; the plan branch is then rebased onto the default branch (picking up `review`), and the final commit changes `review` to `done`.

Because each claim commit is made before the plan branch picks it up, the plan branch never edits the status line concurrently with the default branch, and merging does not conflict.

**Advantages**:
- Status is explicit and readable in the file without running git commands.
- Works in environments with no git tooling (reading the file is enough).
- Status history is tracked in git blame.

**Disadvantages**:
- Claim commits require direct pushes to the default branch, so this mode does not suit protected branches.
- Status can become stale if a claim commit is skipped (for example, when work starts without the start flow).
- Manual status edits made on the plan branch can still conflict with claim commits on `PLAN.md`.

### When to choose `frontmatter`

Use `status_source: frontmatter` when:
- The team prefers explicit, auditable status changes.
- Git tooling is not available in the environment reading status.
- The branch does not have protected branch restrictions on direct pushes.

Use the default `status_source: git` for most projects.

---

## Shelving, archiving, and deletion

Shelving is a resumable lifecycle state. It retains the existing checkout by default, including uncommitted work, and leaves plan records in their non-archived location. `plan start`, step execution/recording, finish, and automatic execution must refuse to advance a shelved plan until the user explicitly resumes it. Listing, inspection, validation, and abandonment remain available. An existing branch or open PR never overrides shelving.

Archiving is a filing operation for `done` or `abandoned` plan records, not a lifecycle state. It moves the records without changing their status and does not itself retain or remove a worktree. Worktree cleanup removes a checkout; it does not delete the plan records. Abandonment removes the checkout under the execution contract but retains the plan and, by default, its branch and committed work. Deleting/pruning plan records would be a separate operation; this specification introduces no deletion command or `deleted` state.

---

## The `done` transition and archiving

`done` is set in the plan branch's **final commit**, together with the archive operation (when `archive_done: true`). The finish flow (see `feature/plan-execution`) does this after rebasing onto the default branch:

1. The agent or user edits `PLAN.md` to set `status: done`.
2. The agent moves the plan folder to `<plans.dir>/archive/<id>/` (including its steps and `HANDOFF.md`).
3. Both changes are committed to the plan branch.
4. The plan branch is merged into the default branch through a pull request or a local merge.

When the merge happens, the plan becomes done and archived at the same moment its work appears on the default branch. The default branch never contains a `ready` plan that is actually finished but not yet marked.

Commits made after the final commit (for example, fixes requested in review) are ordinary plan-branch commits; any edit to the plan's own files happens under its archived path. If review rejects the plan outright, the final commit is reverted on the plan branch, and the plan is either resumed or abandoned.

---

## Validation rules

- No plan in `depends_on` may be `abandoned`. A plan depending on an abandoned plan is itself invalid and must be updated.
- A `done` plan may not be restarted. A new plan must be created.
- A dependency cycle (plan A depends on plan B which depends on plan A) is a validation error.
- A shelved plan requires `shelved_from`: `ready` in Git mode, or `in_progress`/`review` in frontmatter mode. Missing, invalid, or incompatible values are errors. The field must be absent in other states. Shelved plans must not be archived.
- A dangling `depends_on` ID (plan does not exist) is a validation error.
- When `status_source: frontmatter`, storing `in_progress` or `review` in frontmatter is valid. When `status_source: git`, storing these statuses is a validation warning (not an error, because a project migrating between modes should not be hard-blocked).

---

## Acceptance scenarios

### Scenario 1: Effective status with branch present

Given `2026-10-28-search-indexer` has `status: ready` in frontmatter,
And branch `plan/2026-10-28-search-indexer` exists on the remote,
And `status_source: git`,
When the plan's status is queried,
Then the effective status is `in_progress`.

### Scenario 2: Effective status blocked

Given `2026-10-28-search-indexer` has `status: ready`,
And its `depends_on` includes `2026-10-20-parser` which has `status: ready` (not done),
When the plan's status is queried,
Then the effective status is `blocked`, regardless of whether the branch exists.

### Scenario 3: Done transition on the plan branch

Given the last step of `2026-10-28-search-indexer` is complete,
When the agent sets `status: done` and moves the folder to `plans/archive/2026-10-28-search-indexer/`,
And commits both changes to the plan branch,
Then after merge, the plan appears as `done` and `archived` on main.

### Scenario 4: Abandoned dependency

Given plan `2026-10-28-search-indexer` lists `depends_on: [2026-10-20-parser]`,
And `2026-10-20-parser` has `status: abandoned`,
When validation runs,
Then an error is reported: "`2026-10-28-search-indexer` depends on `2026-10-20-parser` which is abandoned."

### Scenario 5: Review status with forge integration

Given `status_source: git`,
And branch `plan/2026-10-28-search-indexer` exists,
And an open PR exists for that branch,
When the plan's status is queried,
Then the effective status is `review`.

### Scenario 6: Review status without forge integration

Given `status_source: git`,
And branch `plan/2026-10-28-search-indexer` exists,
And forge integration is not configured,
When the plan's status is queried,
Then the effective status is `in_progress` (review falls back to in_progress).

### Scenario 7: Frontmatter mode status update

Given `status_source: frontmatter`,
And plan `2026-10-28-search-indexer` has `status: ready`,
When the start flow runs,
Then a claim commit setting `status: in_progress` is made on the default branch,
And the branch `plan/2026-10-28-search-indexer` is created from that commit,
And reading `PLAN.md` on the default branch shows `in_progress`.

---

### Scenario 8: Shelving overrides branch and PR activity

Given a started plan with completed and pending steps and an existing worktree,
When the user shelves it,
Then its stored and effective status are `shelved` in either status-source mode,
And its branch, checkout, uncommitted files and step outcomes are retained,
And an open PR or unmet dependency does not override that status,
And no step is launched or recorded until explicit resume.

### Scenario 9: Resume retains progress

Given a shelved plan,
When the user explicitly resumes it,
Then its pre-shelving stored status is restored and current derived status is recomputed,
And the next step remains the lowest step not done or skipped,
And no implementation step or model session is started by the resume operation.

---

## Edge cases

- A plan may have `status: done` in frontmatter but its branch still exists (e.g. the branch was not deleted after merge). The effective status is still `done`; `in_progress` does not override `done`.
- `blocked` is only derived for plans with `status: ready`. A `draft` plan with unmet dependencies is not shown as `blocked` — it is simply `draft`.
- When `dependency_mode: stack`, `blocked` is computed only for a `ready` plan that cannot start: a dependency is shelved, or it has two or more dependencies that are not done. A shelved dependency reports "Cannot stack on shelved dependency: <id>; resume it first.". Otherwise, a plan with two or more unmerged dependencies is displayed as `blocked`, with the message "Cannot stack on more than one unmerged dependency: <a>, <b>." A `ready` plan with at most one unmerged dependency that is not shelved is not `blocked`; it may start from that dependency's branch tip (see `feature/plan-execution` for the limits).
- Derived statuses depend on the reader's git state (which branches have been fetched). Two people may see different effective statuses until they fetch; the stored status is the same for everyone.
