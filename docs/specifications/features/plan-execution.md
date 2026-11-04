---
id: feature/plan-execution
title: "Plan execution: backends, start/finish flows, merging, and stacking"
status: review
author: mixed
---

<!-- Revision 2026-11-01: extension/core separation and contribution provenance agreed in conversation; existing lifecycle status is unchanged. Implementation and integration review remain pending. -->

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

## Integration target and comparison baseline

A managed plan may develop against any user-selected integration branch. Reviewed feature definitions may precede architecture and implementation on any branch, including multiple feature branches; definitions and implementation may also evolve together. Branch names confer no required role. Neither workflow requires specs or plans on the repository default branch. Managed plan prerequisites below do not prohibit work without plans.

The integration target is selected explicitly at first start, otherwise from the plan's `target_branch`, otherwise `plans.target_branch`, otherwise the repository default branch. An explicit selection must agree with a target already declared in the plan. For a managed first start, the selected branch must exist and contain the committed ready plan and specs satisfying the explicitly configured start policy. Approval permits implementation in that context; it does not authorize merging into the target or promoting that target to another branch.

The first start records the resolved target and exact implementation starting commit. Later commands use that recorded target even if configuration or the repository default changes. A missing or renamed target requires explicit recovery; never silently substitute main. Changing the target requires explicit reconciliation through `plan retarget`; it must not be inferred from edited configuration. These constraints protect managed operations and do not prevent manual Git work.

Implementation still uses one `plan/<id>` branch per plan. For a candidate, finish merges that implementation into the candidate branch; the resulting candidate contains its specs, plans and implementation. Reviewing or promoting that candidate into main is a separate user-controlled action. Direct adoption of an arbitrary existing branch as a plan branch is not introduced here.

An optional `comparison_base` names an immutable commit used to evaluate alternatives. It is separate from the implementation starting commit and the moving integration target. Metrics, evaluation procedure and evidence belong in the plan's acceptance criteria and work records. Starting, rebasing, restacking or finishing never changes the comparison baseline. Automated candidate generation, ranking, winner selection and promotion are future work, not prerequisites for using this workflow.

The actual starting tree must contain the ready plan and approved specification revisions being implemented; if a stacked dependency lacks them, reconcile it explicitly before starting. Validation must not approve one snapshot and execute another.

Dependencies are evaluated in the selected target's context. A dependency completed only in another candidate does not satisfy a dependency here until its completed work and record are integrated into this target. Stacking requires the unfinished dependency to have the same recorded target. Candidate plans use distinct plan IDs; copying a plan ID does not create another independently executable candidate.

All references below to the integration target mean this resolved and recorded branch, including approval checks, claims, status, shelving/resume, abandonment, restacking, PR base, local merge and cleanup. The default branch remains the fallback, not a required landing point.

---

## Start flow

The start flow is initiated by `specplane plan start <id>`. A start is a **first start** when branch `plan/<id>` does not exist yet, and a **resume** otherwise.

```
1. Resolve the integration target, then fetch it so dependency statuses are current
   (skipped when the repository has no remote; the local integration target is used).

2. Validate plan:
   a. Plan exists on the selected target and has status: ready (or in_progress, when resuming with status_source: frontmatter).
   b. First start only — dependencies:
      wait_for_merge: every plan in depends_on has status: done.
      stack: see "Stacked plans".
   c. First start only — spec approval: specs in the plan's specs list meet the
      require_approved_specs policy.
   (A resume skips b and c: the plan's own spec edits must not block it; see
   feature/spec-precedence Rule 5.)

3. (status_source: frontmatter, first start only) Claim commit on the integration target:
   set status: in_progress in PLAN.md.

4. Create branch (first start only):
   create plan/<id> from the integration target (or from the dependency's branch tip,
   if stacking). A resume uses the existing branch.

   Record the target and exact starting commit before exposing executable work.

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
   c. (stack) Every dependency is done on the integration target.

2. Verify:
   a. Run plans.test_command, if non-empty. A non-zero exit stops the flow.
   b. Present the acceptance criteria from PLAN.md for confirmation
      (by the human, or by the agent in unattended mode, recording its evidence).

3. (status_source: frontmatter) Claim commit on the integration target:
   set status: review in PLAN.md.

4. Rebase onto the integration target:
   a. Fetch the integration target (skipped when there is no remote).
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
   merge: pull_request → push plan/<id> and open a pull request to the integration
     target (with plans.forge: none, push and ask the human to open it).
   merge: local_merge → after human confirmation, merge plan/<id> into the integration
     target locally (see "Local merge").

7. Cleanup, once merged (immediately for local_merge; later via
   `specplane plan cleanup <id>` for pull requests):
   a. Remove the worktree at <worktree_dir>/<repo-name>/<id>/ (worktree backend),
      or switch the main checkout back to the integration target (branch backend).
   b. Delete branch plan/<id>.
```

Rebasing before the final commit means the pull request contains the done-and-archive commit on top of an up-to-date base. Fixes requested in review are ordinary commits on the plan branch (see `feature/plan-status`, "The `done` transition and archiving").

### Local merge

With `merge: local_merge`, no pull request is opened and the human's confirmation in step 6 is the review. Together with `plans.forge: none`, this is the supported fully local mode: no remote or forge is needed.

- The merge runs in a checkout of the integration target with no uncommitted changes. Select that checkout by its branch, not by whether it is the main checkout. With the branch backend the main checkout is the plan checkout, so it first switches back to the integration target. If no suitable target checkout is available or it has uncommitted changes, the flow stops before merging and says what to fix; the done commit stays on `plan/<id>`, and re-running the finish flow resumes at step 6.
- The merge always creates a merge commit (no fast-forward), so the plan's commits stay grouped.
- If the integration target moved after step 4, the flow stops and asks for the finish flow to be re-run, which rebases again; it never merges an un-rebased branch.
- When a remote exists, the merged integration target is pushed.
- Confirmation needs a human. An unattended session stops after step 5 and reports that the plan is ready to merge.
- The `external` backend does not support `local_merge`; finishing such a plan fails with an error.

---

## Shelving and resuming a plan

`specplane plan shelve <id>` pauses an already-started, non-terminal plan. It records `shelved` and its prior stored status, retains the plan folder, branch, worktree and all step progress, and does not archive anything. Uncommitted implementation work is preserved; shelving does not stash, commit or discard it. Refuse while a worker or recording operation is active; the caller must stop it before shelving. A shelved plan cannot be advanced by start, step execution/recording, finish, restack, or the conductor.

`specplane plan resume <id>` explicitly restores the pre-shelving stored status and removes the shelving metadata. It recomputes effective status using current dependency and PR information. It preserves completed steps and the existing checkout, and does not execute a step, launch a session, rebase, or merge. If the checkout was removed separately, report that `plan start <id>` can recreate it from the retained branch after resume. Missing branch history is an error, not permission to create a replacement plan or reset progress.

Both operations require a user request and preserve approval history. Use a checkout of the recorded integration target; an unrelated main checkout need not switch branches. Repeated shelving or resuming a plan that is not shelved refuses without changes. They record the lifecycle change on the integration target, with the same checkout and publication constraints as claim commits, in both status-source modes. A protected integration target refusal must leave the operation visibly incomplete rather than report success. Readers and execution checks must honor integration-target shelving even when a retained plan checkout still contains its previous status. No command implicitly resumes a shelved plan.

---

## Abandoning a plan

A plan that will not be completed is abandoned with `specplane plan abandon <id>`:

```
1. On the integration target, set status: abandoned in PLAN.md; if archive_done: true,
   move the folder to <plans.dir>/archive/<id>/. Commit.
2. Remove the plan's worktree, if any (refuses if it has uncommitted changes,
   unless forced).
3. Keep branch plan/<id> (it may hold useful work) unless branch deletion is requested.
```

Abandonment retains plan records and committed work on the retained branch; removing the checkout is not deleting the plan. If the plan was shelved, remove its shelving metadata as part of the abandoned transition. There is no resume transition from abandoned. Archiving remains a separate filing operation, even when performed automatically here.

Plans that depend on an abandoned plan become invalid until their `depends_on` is updated (see `feature/plan-status`).

---

## Stacked plans (`dependency_mode: stack`)

When `dependency_mode: stack`, a dependent plan may start before its dependency is merged, by branching from the dependency's branch tip.

### Start with stacking

```
1. Every dependency must be done, except at most one. That one ("the base plan")
   must not be shelved and must have been started (stored status ready, in_progress, or review, and an
   existing branch plan/<base-id>).
   Two or more unmerged dependencies → start fails:
   "Cannot stack on more than one unmerged dependency: <a>, <b>."
   If all dependencies are done, the plan starts from the integration target as usual.
2. Create branch plan/<this-id> from the tip of plan/<base-id>.
3. Record the stack base: an empty marker commit on plan/<this-id> that names
   plan/<base-id> and the base commit (message format: architecture/file-formats §8).
```

### Restacking

The dependent branch is rebased with an explicit base, replaying **only its own commits**:

```
rebase --onto <new-base> <recorded stack base> plan/<this-id>
```

- **When the base plan merges**: `<new-base>` is the integration target. This works whether the base plan was merged with a merge commit, a squash, or a rebase. Afterwards the plan is no longer stacked.
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
- Starting a plan whose stored status is `draft`, `shelved`, `done`, or `abandoned` fails: "Cannot start plan: `<id>` is `<status>`, not `ready`."
- Claim and abandon commits are made in a checkout of the integration target and need it on that branch without changes to the plan's `PLAN.md`; otherwise the flow stops and says what to fix. They are pushed when a remote exists. Like `local_merge`, they write to the integration target directly, so they fail on a protected branch.
- `merge: local_merge` with a protected integration target will fail at the git level. Teams using protected branches must use `merge: pull_request`.
- Cleanup (branch and worktree deletion) is idempotent: running it on an already-cleaned-up plan does nothing.
- Cleanup requires the plan to be done on the integration target and evidence of integration. Status alone does not prove a merge. Where squash/rebase history leaves integration ambiguous, require explicit reconciliation and preserve the branch and worktree.

## Extension-owned opt-in conductor

Standalone `plan start` prepares or resumes the plan's checkout and reports its next step without selecting or launching a harness. Its output is harness-neutral. An extension can explicitly compose preparation with automated execution, supplying its own adapter before preparation starts. Invalid or unavailable execution capabilities are rejected before claiming a plan or creating its checkout.

The standalone CLI exposes neither `plan run` nor `plan start --run`. Extensions expose automation through their ecosystem's command interface and a shared conductor. Automated execution accepts only isolated worktree-backed plans. The iteration target is one step or finish-review readiness; the latter never runs the finish flow. The default maximum is one session; longer runs require an explicit bound. Parallelism applies to distinct plans only. The host is fixed by the extension, with no default or detected runtime selection.

An explicit `--step N --force --reason TEXT` reruns a completed step once and records a single-line reason. It cannot override live sessions, locks, dirty/diverged checkouts, half-finished commits, human decisions, drafts, or unmerged dependency gates. Normal runs select the first pending step. A session that exits without advancing status is not retried automatically. Interrupting observation leaves the session running; inspect/attach before retrying. No automatic production notification configuration or permission changes occur.

### Scenario 8: Candidate development without a main merge

Given an existing candidate branch containing a committed ready plan and its approved specs, absent from main,
When the user starts the plan with that candidate as the integration target,
Then the plan branch starts from the candidate, records its exact starting commit and target, and can execute without changing main.
When the human authorizes finish, the PR or local merge targets the candidate, not main.

### Scenario 9: Team integration branch and stable selection

Given `plans.target_branch: dev`,
When a plan starts without an override, its target is recorded as dev.
Changing the config default later does not retarget the running plan.
A different explicit target may be selected for another unstarted plan.

### Scenario 10: Parallel candidates and comparison

Given distinct candidate plans with the same recorded comparison commit and evaluation criteria,
When each is implemented and evaluated, its own spec approvals, target and evidence remain separate.
Completing one candidate does not authorize selecting it, completing another candidate's dependencies, or merging either candidate into main.

## Explicit target reconciliation

`specplane plan retarget <id> --target <branch>` updates the current destination of managed work explicitly. It preserves the original starting commit, original target provenance and comparison baseline, and records the old/new target. It does not rebase, merge, push, change approval or alter completion automatically. Config edits never silently retarget started work.

Before writing, inspect active workers and leases, unresolved operations, target existence, plan identity and the applicable records/specs/dependencies on the proposed target. An unfinished stacked dependency must share the proposed target. If authoritative records, shelving/abandonment state or an existing PR base conflict, report reconciliation requirements and leave everything unchanged. Do not silently transplant plans or lifecycle records. Preview the actual target change with `--dry-run`; support structured receipts. Safe refusal of this convenience command does not restrict manual Git operations. Missing historical target refs do not authorize guessing a replacement.

### Acceptance: ordinary Git remains available

Users can work on arbitrary branches without plans, commit spec and code changes together or separately, and declare completion manually. Managed plan conventions do not become universal Git rules. Manual rebase, squash, cherry-pick or merge may require managed metadata reconciliation, but never trigger silent retargeting, fabricated historical provenance or cleanup of unverified work.
