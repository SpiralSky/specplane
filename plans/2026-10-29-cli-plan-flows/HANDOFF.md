# HANDOFF — 2026-10-29-cli-plan-flows

## Step 01: Architecture spec edits for restack and flows

**Date**: 2026-10-29
**Outcome**: done

### What was done
- `architecture/reference-cli` Restack: added the three triggers (explicit `plan restack`, finish step 4, resume message only) and the not-stacked failure.
- Module structure: `restack` added to the `commands/plan.ts` list; `harness/` annotated as belonging to the harness plan.
- Error classes: `PlanStateError` examples extended with the stacking and restack texts.

### Decisions
- CHOICE: resume message text is "Base plan `<base-id>` has merged; run `specplane plan restack <id>`." and resume continues.
- CHOICE: restack of a non-stacked plan throws `PlanStateError` "Cannot restack: `<id>` is not stacked."

### Gaps found
- `feature/tooling` has no `plan restack` command; documented as an extension depending on step 02's proposal.

### Open issues
None.

### Notes for next step
No spec pins reference `reference-cli`; `spec pin --check` and `validate` pass.

## Step 02: Feature-spec proposals for tooling and plan-steps

**Date**: 2026-10-29
**Outcome**: done

### What changed

- `plans/2026-10-29-cli-plan-flows/feature-spec-proposals.md`: new; three proposals with quoted current text, proposed text, and reason: (1) `plan restack <id>` for `feature/tooling` with `--dry-run`, exit codes and errors; (2) `feature/plan-steps` HANDOFF behaviour when a `blocked` step is re-run (append a new section, latest wins, aligned with `architecture/file-formats` §4.1); (3) neutral replacements for the `src/...` examples that trip the leak guard (6 warnings).

### Deviations from the plan

None.

### Gaps found in specs

- `feature/plan-steps` does not say whether a re-run blocked step gets a second HANDOFF section; `architecture/file-formats` §4.1 does. Proposal 2 closes it.

### Open issues

- `feature-spec-proposals.md` needs user review; no feature spec was modified.

### What the next step must know

- The proposals file is `plans/2026-10-29-cli-plan-flows/feature-spec-proposals.md`: needs user review before any feature spec edit.
- CHOICE: neutral example paths are slash-free names (`CONTRIBUTING.md`, `STYLE.md`), because the guard flags any path containing a slash, not only `src/`.
- CHOICE: proposed `plan restack` errors: plan not found, "Cannot restack: `<id>` is not stacked.", and conflicts exit 1; `--dry-run` included per tooling general conventions.

## Step 03: Branch and worktree writes, setup hook, error classes

**Date**: 2026-10-29
**Outcome**: done

### What changed

- `packages/cli/src/git/branch.ts`: `createBranch`, `deleteBranch`, `rebaseOnto` (aborts and throws `RebaseConflictError` on conflict).
- `packages/cli/src/git/worktree.ts`: `createWorktree` (reuses an existing worktree of the branch), `removeWorktree` (`--force` only with `force`).
- `packages/cli/src/plan/hooks.ts`: `runSetupHook(cmd, cwd)` through the shell; hook output to stderr.
- Tests: `git/write.test.ts` (temp repos, real conflicting rebase) and `plan/hooks.test.ts`.
- The four error classes already existed in `errors.ts` with the spec texts; no change needed.

### Deviations from the plan

None.

### Gaps found in specs

- `rebaseOnto` in the spec has no `cwd`; the rebase checks `branch` out, so it must run in the checkout that owns the branch.

### Open issues

None.

### What the next step must know

- CHOICE: git helpers take an optional trailing `cwd` (default `process.cwd()`); `removeWorktree(planId, config, { force }, cwd)`.
- CHOICE: `rebaseOnto` treats a failure as a conflict only if `git rebase --abort` succeeds; otherwise the original `GitError` is rethrown. `RebaseConflictError` id is the branch with `plan/` stripped.
- CHOICE: `runSetupHook` does not remove the worktree on failure; the start flow must do that (the error message says "Worktree removed.").
- CHOICE: the dirty-worktree refusal is git's own `GitError` (exit 2), propagated as the spec says.

## Step 04: plan start

**Date**: 2026-10-29
**Outcome**: done

### What changed

- `packages/cli/src/plan/flows.ts`: `startPlan` (validate, then write): plan and specs read from the default branch tip via `git show`; status, dependency (wait-for-merge and stacking), and approval checks; claim commit (frontmatter mode, pushed when a remote exists); marker commit through `git commit-tree`; remote-only branch tracking; worktree/branch/external checkout; setup hook with worktree removal on failure.
- `packages/cli/src/commands/plan.ts`, `cli.ts`: `plan start <id>` (no flags).
- `git/exec.ts`: `run` takes an optional `input` (stdin) for `-F -`. `errors.ts`: `PlanStateError` now takes the full message. `plan/activity.ts` exports `lenientFrontmatter`; `spec/resolve.ts` exports `TYPE_DIRS`.
- `plan/flows.test.ts`: 12 integration tests with a bare origin (Scenarios 1, 2, 3, 6, 7, 8, two-dependency stacking, backends, claim commit).

### Deviations from the plan

None.

### Gaps found in specs

- `PlanStateError` was specified as `Cannot <action> plan ...` in the class but the feature texts differ ("Cannot start plan: `<id>` ..."); the constructor now takes the verbatim message.
- Start flow does not say what a resume of a `review`/`in_progress` plan accepts with `status_source: git`: stored status stays `ready` there, so only `ready` is needed.

### Open issues

None.

### What the next step must know

- CHOICE: the two-dependency error lists ids in backticks: "Cannot stack on more than one unmerged dependency: `a`, `b`."
- CHOICE: an unstarted stack base fails with "Cannot start plan: dependency `<id>` has not been started."
- CHOICE: the default branch tip is the local branch, or `origin/<default>` when the local one is strictly behind it; a claim commit moves the local branch, and the plan branch is cut from it.
- CHOICE: a setup-hook failure removes only the worktree; the branch (and any claim commit) stays, so a retry is a resume. The hook runs only when the worktree is newly created.
- CHOICE: claim preconditions (main checkout on the default branch, `PLAN.md` unchanged) and the branch-backend clean-tree check run before any write, with `PlanStateError` messages.
- CHOICE: resume prints the restack hint on stderr when the stack marker's base plan is `done` on the default tip, and continues. The base ID is parsed from the marker subject.
- CHOICE: `plan start` prints `Started|Resumed <id>`, `Worktree: <path>` or `Branch: <name>`, and `Next step: NN <title> (<status>)` on stdout.

## Step 05: plan finish and local merge

**Date**: 2026-10-29
**Outcome**: done

### What changed

- `packages/cli/src/plan/flows.ts`: `finishPlan` (async): readiness checks, `test_command`, acceptance-criteria notice, frontmatter `review` claim, rebase/restack via `rebaseOnto`, tests re-run when the rebase moved HEAD, final `finish` commit (done + archive), `pull_request` push and `local_merge` (`--no-ff`, push, cleanup). `claimPlan` takes a status.
- `packages/cli/src/commands/plan.ts`, `cli.ts`: `plan finish <id> [--yes]`.
- `packages/cli/src/plan/finish.test.ts`: 13 integration tests (Scenarios 4, 4a, 5, 5a; conflict; resume; bare origin and no remote; branch and external backends; frontmatter claim).

### Deviations from the plan

None.

### Gaps found in specs

- `feature/plan-execution` does not say what unattended `pull_request` finish does with the criteria confirmation; criteria are printed to stderr only.
- `architecture/file-formats` §8.3 has no workflow for the merge commit.

### Open issues

None.

### What the next step must know

- CHOICE: the merge commit uses git's default style message `Merge plan/<id>` with no Specplane trailers (no workflow exists for it in §8.3).
- CHOICE: without `--yes` and without a TTY, finish stops after the final commit and prints "ready to merge" (exit 0); a re-run resumes (a plan already `done` on HEAD skips tests, claim and final commit, but still rebases).
- CHOICE: `cleanupMerged` in `flows.ts` is a private minimal cleanup (worktree removal without force, branch delete); step 06 should replace it with the shared `cleanup(id)`.
- CHOICE: the branch backend skips the frontmatter `review` claim, since the main checkout is the plan checkout; `pull_request` without a remote `origin` fails before any write.
- CHOICE: non-stacked plans rebase via `rebaseOnto(tip, tip, branch)`; the tip is `origin/<default>` when the local default branch is strictly behind it. The merge precondition is that local default is an ancestor of the plan branch.
- CHOICE: "no uncommitted changes" checks ignore untracked files; PR creation is a single `openPullRequest` stub returning `null`.

## Step 06: abandon, cleanup, archive, restack

**Date**: 2026-10-29
**Outcome**: done

### What changed

- `packages/cli/src/plan/flows.ts`: `abandonPlan`, `cleanupPlan`, `archivePlan`, `restackPlan`; `finishPlan` now calls the shared `cleanupPlan` (private `cleanupMerged` removed).
- `packages/cli/src/commands/plan.ts`, `cli.ts`: `plan abandon <id> [--delete-branch] [--force]`, `plan cleanup <id> [--force]`, `plan archive <id>`, `plan restack <id> [--dry-run]`.
- `packages/cli/src/plan/lifecycle.test.ts`: 8 integration tests in temp repos (abandon, idempotence, dirty worktree and `--force`, cleanup, archive, Scenario 6a squash restack, unmerged-base restack, conflict).

### Deviations from the plan

None.

### Gaps found in specs

- Restack onto the default branch leaves the old marker (with its `Specplane-Stack-Base`) as the newest marker, which would make a later `finish` or `restack` rebase from a stale base; the spec adds a marker only for the unmerged case.
- `feature/tooling` does not say what `abandon` does for an already-abandoned plan, or `cleanup` for a plan that is not `done` with no branch.

### Open issues

None.

### Notes for next step

This was the last step; run `/plan-finish`.
- CHOICE: after restacking onto the default branch, an empty marker `chore(specplane): unstack <id> from <base-id>` (`Specplane-Workflow: stack`, no `Specplane-Stack-Base`) is appended; a marker without a base means "not stacked", so a second restack errors and the resume hint disappears.
- CHOICE: restack needs `plan/<id>` checked out (a worktree, or the main checkout) and clean; otherwise `PlanStateError` pointing to `plan start`. A restack with an unchanged unmerged base reports "already on the tip" and appends no marker.
- CHOICE: `abandon` of an already-abandoned plan skips the commit but still removes the worktree and honours `--delete-branch`; of a `done` plan it fails ("Cannot abandon plan: `<id>` is `done`.").
- CHOICE: `cleanup` with an existing `plan/<id>` that is not `done` on the default branch fails with no writes; with no branch it is a no-op (error only when the plan is also unknown). Dirty worktrees refuse without `--force` before any write. A branch-backend checkout on `plan/<id>` is switched to the default branch first.
- CHOICE: `archive` refuses when the plan folder has uncommitted changes or the archive target exists.
