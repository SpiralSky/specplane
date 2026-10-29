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
