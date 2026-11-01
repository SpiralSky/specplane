---
id: feature/plan-execution
title: "Plan execution: backends, start/finish flows, merging, and stacking"
status: review
author: mixed
---

<!-- Experimental development amendment 2026-11-01. Existing status records prior approval only; these branch changes await human final review. -->

# Plan execution: backends, start/finish flows, merging, and stacking

This spec defines how a plan is executed: how its branch and worktree are created, how steps are run, and how the plan is finished and merged.

---

## Branch model

One plan = one branch. The branch name is `plan/<plan-id>`.

**Why one branch per plan, not one per step**: steps must run sequentially on a single branch. If each step had its own branch or worktree, partial features would need to land on main between steps, exposing incomplete work and requiring stacked branches with complex rebase coordination. One branch keeps the plan's work atomic and reviewable as a whole.

**Why one session per step, not one commit per spec change**: see `feature/plan-steps`. The session boundary is the unit of context management; the branch is the unit of review and merge.

---

## Execution backends

The backend controls how the plan's branch is checked out.

### `worktree` (default)

A separate git worktree is created for the plan at `<worktree_dir>/<repo-name>/<plan-id>/`. The `<repo-name>` segment (the repository root directory name) is inserted to prevent plan ID collisions when multiple sibling repositories both use Specplane — they share the same base `worktree_dir` but have distinct subdirectories. Multiple plans within the same repository may run in parallel, each in its own worktree.

### `branch`

No worktree is created. The agent switches the main checkout to the plan branch; this requires a clean working tree. Only one plan may be active at a time with this backend.

### `external`

Plans are executed in external environments (cloud agents, remote machines, CI runners). These environments manage their own checkouts. Specplane tracks the branch name but not the worktree path. The external environment runs the finish flow itself (or an equivalent that produces the same final commit and pull request); sessions there are unattended (see `feature/spec-precedence`).

---

## Worktree concerns

When using the `worktree` backend, the following must be addressed:

### Setup hook

Dependencies are not shared between worktrees. The `setup_hook` command (see `feature/configuration`) is run once in a fresh worktree. It should install dependencies (e.g. `npm install`, `pip install -r requirements.txt`).

If the setup hook fails, worktree creation fails with the hook's error output.

### Untracked files

Files not tracked by git (`.env`, local config files, runtime secrets) are not present in the worktree. The plan's steps must not assume they are there. Agents must either generate them or note that manual intervention is required before the step can start.

### Port collisions

When running development servers in parallel worktrees, port collisions are possible. The setup hook or step guidance should use distinct ports for each plan (e.g. by appending a hash of the plan ID to a base port). This is a project-level concern and is not managed by Specplane.

### Cleanup

Worktrees are removed by cleanup after the plan's branch is merged (`specplane plan cleanup <id>`), or when a plan is abandoned. Removal refuses to delete a worktree that has uncommitted changes unless explicitly forced, so no work is lost silently.

---

## Start flow

The start flow is initiated by `specplane plan start <id>`. A start is a **first start** when branch `plan/<id>` does not exist yet, and a **resume** otherwise.

```
1. Fetch the default branch, so dependency statuses are current
   (skipped when the repository has no remote; the local default branch is used).

2. Validate plan:
   a. Plan exists and has status: ready (or in_progress, when resuming with status_source: frontmatter).
   b. First start only — dependencies:
      wait_for_merge: every plan in depends_on has status: done.
      stack: see "Stacked plans".
   c. First start only — spec approval: specs in the plan's specs list meet the
      require_approved_specs policy.
   (A resume skips b and c: the plan's own spec edits must not block it; see
   feature/spec-precedence Rule 5.)

3. (status_source: frontmatter, first start only) Claim commit on the default branch:
   set status: in_progress in PLAN.md.

4. Create branch (first start only):
   create plan/<id> from the default branch (or from the dependency's branch tip,
   if stacking). A resume uses the existing branch.

5. Check out:
   worktree backend: if no worktree exists at <worktree_dir>/<repo-name>/<id>/,
     create it there and run setup_hook if non-empty. If setup_hook fails,
     remove the worktree just created and report the error.
   branch backend: switch the main checkout to plan/<id> (requires a clean working tree).
   external backend: nothing to check out locally.

6. Announce:
   Output the worktree path (worktree backend) or branch name (branch/external backend),
   and the next step to execute (see feature/plan-steps).
```

If any validation check fails, the start flow exits with a non-zero exit code and a human-readable error message. No commit, branch, or worktree is created.

---

## Finish flow

The finish flow is initiated by `specplane plan finish <id>`, run in the plan's checkout.

```
1. Check readiness:
   a. The checkout is on branch plan/<id> with no uncommitted changes.
   b. Every step is done or skipped. A pending or blocked step stops the flow,
      naming the step.
   c. (stack) Every dependency is done on the default branch.

2. Verify:
   a. Run plans.test_command, if non-empty. A non-zero exit stops the flow.
   b. Present the acceptance criteria from PLAN.md for confirmation
      (by the human, or by the agent in unattended mode, recording its evidence).

3. (status_source: frontmatter) Claim commit on the default branch:
   set status: review in PLAN.md.

4. Rebase onto the default branch:
   a. Fetch the default branch (skipped when there is no remote).
   b. Rebase plan/<id> onto it. A stacked plan (one with a stack marker commit)
      is restacked instead, replaying only its own commits (see "Restacking").
      Conflicts stop the flow and are surfaced to the human; they are never
      resolved automatically.
   c. If the rebase brought in new commits, re-run 2a.

5. Final commit:
   a. Set status: done in PLAN.md.
   b. If archive_done: true, move the plan folder to <plans.dir>/archive/<id>/.
   c. Commit, using the finish commit format (architecture/file-formats §8).

6. Merge:
   merge: pull_request → push plan/<id> and open a pull request to the default
     branch (with plans.forge: none, push and ask the human to open it).
   merge: local_merge → after human confirmation, merge plan/<id> into the default
     branch locally (see "Local merge").

7. Cleanup, once merged (immediately for local_merge; later via
   `specplane plan cleanup <id>` for pull requests):
   a. Remove the worktree at <worktree_dir>/<repo-name>/<id>/ (worktree backend),
      or switch the main checkout back to the default branch (branch backend).
   b. Delete branch plan/<id>.
```

Rebasing before the final commit means the pull request contains the done-and-archive commit on top of an up-to-date base. Fixes requested in review are ordinary commits on the plan branch (see `feature/plan-status`, "The `done` transition and archiving").

### Local merge

With `merge: local_merge`, no pull request is opened and the human's confirmation in step 6 is the review. Together with `plans.forge: none`, this is the supported fully local mode: no remote or forge is needed.

- The merge runs in the main checkout, which must be on the default branch with no uncommitted changes. With the branch backend the main checkout is the plan checkout, so it first switches back to the default branch. If the main checkout is on another branch or has uncommitted changes, the flow stops before merging and says what to fix; the done commit stays on `plan/<id>`, and re-running the finish flow resumes at step 6.
- The merge always creates a merge commit (no fast-forward), so the plan's commits stay grouped.
- If the default branch moved after step 4, the flow stops and asks for the finish flow to be re-run, which rebases again; it never merges an un-rebased branch.
- When a remote exists, the merged default branch is pushed.
- Confirmation needs a human. An unattended session stops after step 5 and reports that the plan is ready to merge.
- The `external` backend does not support `local_merge`; finishing such a plan fails with an error.

---

## Abandoning a plan

A plan that will not be completed is abandoned with `specplane plan abandon <id>`:

```
1. On the default branch, set status: abandoned in PLAN.md; if archive_done: true,
   move the folder to <plans.dir>/archive/<id>/. Commit.
2. Remove the plan's worktree, if any (refuses if it has uncommitted changes,
   unless forced).
3. Keep branch plan/<id> (it may hold useful work) unless branch deletion is requested.
```

Plans that depend on an abandoned plan become invalid until their `depends_on` is updated (see `feature/plan-status`).

---

## Stacked plans (`dependency_mode: stack`)

When `dependency_mode: stack`, a dependent plan may start before its dependency is merged, by branching from the dependency's branch tip.

### Start with stacking

```
1. Every dependency must be done, except at most one. That one ("the base plan")
   must have been started (stored status ready, in_progress, or review, and an
   existing branch plan/<base-id>).
   Two or more unmerged dependencies → start fails:
   "Cannot stack on more than one unmerged dependency: <a>, <b>."
   If all dependencies are done, the plan starts from the default branch as usual.
2. Create branch plan/<this-id> from the tip of plan/<base-id>.
3. Record the stack base: an empty marker commit on plan/<this-id> that names
   plan/<base-id> and the base commit (message format: architecture/file-formats §8).
```

### Restacking

The dependent branch is rebased with an explicit base, replaying **only its own commits**:

```
rebase --onto <new-base> <recorded stack base> plan/<this-id>
```

- **When the base plan merges**: `<new-base>` is the default branch. This works whether the base plan was merged with a merge commit, a squash, or a rebase. Afterwards the plan is no longer stacked.
- **When the base plan's branch is rewritten before merging** (for example, by its own finish-flow rebase): `<new-base>` is the new tip of `plan/<base-id>`, and a new marker commit records it.

The most recent marker commit on the branch is authoritative. Conflicts during restacking are surfaced to the human or agent; they are not resolved automatically. A stacked plan cannot finish until its base plan is done (finish flow step 1c).

### Trade-offs

| | `wait_for_merge` | `stack` |
|--|--|--|
| Risk | Lower: base is stable at start | Higher: rebase onto changing base |
| Throughput | Serialised by merge cadence | Higher: can start sooner |
| Conflict scope | Conflicts visible at PR time | Conflicts visible at rebase time |

Use `stack` only when throughput is the priority and the team is comfortable with rebase workflows.

---

## Acceptance scenarios

### Scenario 1: Plan start — all checks pass

Given `2026-10-28-search-indexer` has `status: ready`,
And its dependency `2026-10-20-parser` has `status: done`,
And its feature spec `feature/search` is `approved`,
And `require_approved_specs: feature`,
When `specplane plan start 2026-10-28-search-indexer` is run,
Then branch `plan/2026-10-28-search-indexer` is created from main,
And a worktree is created at `../.specplane-worktrees/<repo-name>/2026-10-28-search-indexer/`,
And the setup hook runs (if configured).

### Scenario 2: Plan start — spec not approved

Given `feature/search` has `status: draft`,
And `require_approved_specs: feature`,
When `specplane plan start 2026-10-28-search-indexer` is run,
Then start fails: "Cannot start plan: `feature/search` is `draft`, not `approved`."

### Scenario 3: Plan start — dependency not done

Given `2026-10-20-parser` has `status: ready`,
And `dependency_mode: wait_for_merge`,
When `specplane plan start 2026-10-28-search-indexer` is run,
Then start fails: "Cannot start plan: dependency `2026-10-20-parser` is not done."

### Scenario 4: Finish flow — tests pass

Given steps 01–03 of `2026-10-28-search-indexer` are all `done`,
And `plans.test_command` passes,
When `specplane plan finish 2026-10-28-search-indexer` is run,
Then the branch is rebased onto main, `PLAN.md` is updated to `status: done`, the folder is archived, a final commit is made, and a PR is opened.

### Scenario 5: Finish flow — tests fail

Given `plans.test_command: make test`,
And the test command exits non-zero,
When `specplane plan finish` runs,
Then it stops after the verification step and reports: "Verification failed: `make test` exited with code 1. Fix failing tests before finishing."
And no commit is made.

### Scenario 4a: Finish flow — local merge without a remote

Given `plans.merge: local_merge` and `plans.forge: none`,
And the repository has no remote,
And every step of `2026-10-28-search-indexer` is `done`,
When `specplane plan finish 2026-10-28-search-indexer` is run and the human confirms the merge,
Then no fetch or push is attempted,
And `plan/2026-10-28-search-indexer` is merged into main with a merge commit in the main checkout,
And the worktree and branch are removed.

### Scenario 5a: Finish flow — step not done

Given step 02 of `2026-10-28-search-indexer` has `status: blocked`,
When `specplane plan finish` runs,
Then it stops and reports: "Cannot finish: step 02 is `blocked`."

### Scenario 6: Stacked plan start

Given `2026-10-20-parser` is `in_progress` on branch `plan/2026-10-20-parser`,
And `dependency_mode: stack`,
When `specplane plan start 2026-10-28-search-indexer` is run,
Then branch `plan/2026-10-28-search-indexer` is created from the tip of `plan/2026-10-20-parser`,
And a marker commit records that tip as the stack base.

### Scenario 6a: Restacking after a squash merge

Given `2026-10-28-search-indexer` is stacked on `2026-10-20-parser`,
And `plan/2026-10-20-parser` is squash-merged into main,
When `plan/2026-10-28-search-indexer` is restacked,
Then only the search-indexer commits made after the recorded stack base are replayed onto main, and none of the parser's original commits are reapplied.

### Scenario 7: Setup hook failure

Given `setup_hook: make deps`,
And `make deps` exits non-zero (e.g. network failure),
When the start flow runs the setup hook,
Then the worktree is removed and start fails: "Setup hook failed: `make deps` exited with code 1. Worktree removed."

### Scenario 8: Resuming a plan in progress

Given `plan/2026-10-28-search-indexer` already exists,
When `specplane plan start 2026-10-28-search-indexer` is run again,
Then the existing branch is used (not re-created), and a new worktree is created if one does not already exist,
And the dependency and spec-approval checks are skipped, so spec edits made on the plan branch do not block the resume.

---

## Edge cases

- If the worktree already exists at the expected path (e.g. from a crashed previous run), the start flow reuses it rather than failing.
- The finish flow's rebase may fail with conflicts. In this case it is surfaced to the human and not automatically resolved.
- Starting a plan whose stored status is `draft`, `done`, or `abandoned` fails: "Cannot start plan: `<id>` is `<status>`, not `ready`."
- Claim and abandon commits are made in the main checkout and need it on the default branch without changes to the plan's `PLAN.md`; otherwise the flow stops and says what to fix. They are pushed when a remote exists. Like `local_merge`, they write to the default branch directly, so they fail on a protected branch.
- `merge: local_merge` with a protected main branch will fail at the git level. Teams using protected branches must use `merge: pull_request`.
- Cleanup (branch and worktree deletion) is idempotent: running it on an already-cleaned-up plan does nothing.
- Cleanup deletes `plan/<id>` only when the plan is `done` on the default branch. That status proves the merge regardless of merge method (git alone does not recognise a squash-merged branch as merged).

## Experimental opt-in conductor

`plan start --run` starts one unattended step iteration after the ordinary start flow. Without `--run`, start behavior is unchanged. `plan run <ids...>` accepts only isolated worktree-backed plans. `--until step|finish` controls iteration; `finish` means stop at finish-review readiness, never run the finish flow. The default maximum is one session; increase `--max-steps` explicitly for a longer bounded run. `--max-parallel` applies to distinct plans only.

An explicit `--step N --force --reason TEXT` reruns a completed step once and records a single-line reason. It cannot override live sessions, locks, dirty/diverged checkouts, half-finished commits, human decisions, drafts, or unmerged dependency gates. Normal runs select the first pending step. A session that exits without advancing status is not retried automatically. Interrupting observation leaves the session running; inspect/attach before retrying. No automatic production notification configuration or permission changes occur.
