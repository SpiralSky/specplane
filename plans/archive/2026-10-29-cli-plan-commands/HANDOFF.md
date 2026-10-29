# HANDOFF — 2026-10-29-cli-plan-commands

## Step 01: Architecture spec edits for plan commands and activity

**Date**: 2026-10-29
**Outcome**: done

### What changed
- `docs/specifications/architecture/reference-cli.md`: new section "Plan commands (`commands/plan.ts`)" with `plan new`, `plan list`, `plan show`, `plan graph` (inputs, outputs, errors, exit codes).
- Plan activity table: added `backend` and `where`; clarified `checkout` for the branch backend (main checkout root while on `plan/<id>`).
- No `based_on` pin or skill marker references reference-cli; `spec pin --check` and `validate` pass (0 errors).

### Deviations from the plan
None.

### Gaps found in specs
- CHOICE: `where` is `local` (local branch exists), `remote` (only `origin/plan/<id>`), `none`; `feature/tooling` only says "local checkout or remote branch only".
- CHOICE: `plan new` without `--id` and without a TTY fails with "Plan ID needed: pass `--id`."; non-TTY title defaults from the slug like `spec new`; `steps/` gets a `.gitkeep`.
- CHOICE: `plan list` sorts by ID descending; `plan graph` throws `DependencyCycleError` on a cycle.

### Open issues
None.

### What the next step must know
`checkout` is null for the external backend and whenever `where` is not `local`. `plan list --live` includes remote-only plans, taking `stored_status` from PLAN.md at the branch tip.

## Step 02: Feature-spec proposals for plan-status and plan-index

**Date**: 2026-10-29
**Outcome**: done

### What changed
- `plans/2026-10-29-cli-plan-commands/feature-spec-proposals.md`: new; three proposals (abandon statuses, stack-mode `blocked` for two or more unmerged dependencies, split plan-index Scenario 5) with current text, problem, proposed text, and reason.
- No feature spec file was modified.

### Deviations from the plan
None.

### Gaps found in specs
- CHOICE: proposal (b) reuses `blocked` as the effective status, with the `feature/plan-execution` start-failure message.
- CHOICE: proposal (c) names the second scenario `5a` to avoid renumbering.

### Open issues
- `feature-spec-proposals.md` needs user review.

### What the next step must know
`plans/2026-10-29-cli-plan-commands/feature-spec-proposals.md` needs user review; until accepted, implement `plan abandon` and stack-mode status as the architecture spec and current feature text allow, and record choices.

## Step 03: git/commit.ts, branch queries, worktree listing

**Date**: 2026-10-29
**Outcome**: done

### What changed
- `packages/cli/src/git/commit.ts`: `formatMessage`, `cliTrailers`, `readTrailers`, `findLatest`, `Trailers` type.
- `packages/cli/src/git/branch.ts`: `branchExists`, `remoteBranchExists`.
- `packages/cli/src/git/worktree.ts`: `listWorktrees`, `parseWorktreeList`, `worktreePath`.
- `packages/cli/src/errors.ts`: `CommitFormatError` (exit 1).
- `packages/cli/src/git/commit.test.ts`: tests on temp repos; `npm test` passes (140).

### Deviations from the plan
None.

### Gaps found in specs
- CHOICE: git helpers take an optional trailing `cwd` (default `process.cwd()`), matching `git/repo.ts`, so tests and worktree callers can target a repo.
- CHOICE: `formatMessage` puts known `Specplane-*` keys in §8.2 order, then any other trailer (e.g. `Co-Authored-By`) after, in insertion order.
- CHOICE: `cliTrailers` takes an optional `env` argument for testability.

### Open issues
None.

### What the next step must know
`createBranch`, `deleteBranch`, `rebaseOnto`, `createWorktree`, `removeWorktree` are not implemented (plan-flows plan). `listWorktrees` returns the main checkout first.

## Step 04: Effective status and plan list

**Date**: 2026-10-29
**Outcome**: done

### What changed
- `packages/cli/src/plan/status.ts`: `getEffectiveStatus(plan, plansById, config, git)` and `StatusGit` (`branchExists`, optional `hasOpenPr` forge extension point).
- `packages/cli/src/commands/plan.ts`: `planList`, `formatPlanList`, `planListCommand` (`--status`, `--json`; no `--live`).
- `packages/cli/src/cli.ts`: `plan` is now a command group with `list`; other plan subcommands are not registered yet.
- `packages/cli/src/commands/plan.test.ts`: integration tests for Scenarios 1, 2, 4, 6, frontmatter mode, JSON, filter; `npm test` passes (146).

### Deviations from the plan
None.

### Gaps found in specs
- CHOICE: `review` is never derived without `hasOpenPr`; the forge client plugs in there (documented in the interface comment).
- CHOICE: an abandoned dependency yields `blocked` under `wait_for_merge` (not done); under `stack` it stays `ready`, and `validate` reports the error (Scenario 4 is a validation rule).
- CHOICE: unknown `--status` value exits 1 with a `PlanUsageError`; valid values are the stored statuses plus `blocked`.
- CHOICE: empty result prints `No plans.`.

### Open issues
None.

### What the next step must know
`planListCommand` has no `--live`/`--no-fetch` yet; `getEffectiveStatus` takes a `StatusGit` object so the forge lookup can be added without changing callers.

## Step 05: Plan activity, plan list --live, generate --print --live

**Date**: 2026-10-29
**Outcome**: done

### What changed
- `packages/cli/src/plan/activity.ts`: `getPlanActivity`, `fetchPlanBranches` (one fetch, skipped without `origin`), `remotePlanIds`, `remotePlanFrontmatter`; step files, HANDOFF and PLAN.md read with `git show <ref>:<path>`.
- `packages/cli/src/commands/plan.ts`, `cli.ts`: `plan list --live`, `--no-fetch`; remote-only plans included; human output gets an activity line per plan.
- `packages/cli/src/generate/plans-md.ts`, `commands/generate.ts`: `generatePlansMd(config, root, { live })`; `generate --print --live` uses effective statuses.
- `packages/cli/src/plan/activity.test.ts`: tests with a bare remote, local-only, remote-only, no-remote, shallow clone, worktree checkout; `npm test` passes (154).

### Deviations from the plan
None.

### Gaps found in specs
- CHOICE: `generate --live` without `--print` exits 1 with a message, so the committed `PLANS.md` never holds live statuses.
- CHOICE: `blocked_issues` entries are the whole `BLOCKED:` line, trimmed, with a leading list bullet removed.
- CHOICE: `steps`/`blocked_issues` read from the branch tip (local, else `origin/`), else the default branch; `next` is the lowest-numbered step that is not done or skipped; unreadable step files are ignored.
- CHOICE: `last_step_commit.step` is null when the trailer is missing or non-numeric; `generate --live` never fetches.

### Open issues
None.

### What the next step must know
`getPlanActivity(id, config, root)` is reusable by `plan show`. A remote-only plan with an invalid PLAN.md at the tip is skipped with a stderr note.

## Step 06: plan new, show, graph

**Date**: 2026-10-29
**Outcome**: done

### What changed
- `packages/cli/src/commands/plan.ts`, `cli.ts`: `plan new` (`--id`, `--title`, `--specs`, `--depends-on`), `plan show <id>`, `plan graph`.
- `packages/cli/src/plan/new-template.ts`: plan ID pattern and PLAN.md template body (file-formats §2.2 sections).
- `packages/cli/src/commands/spec.ts`: exports `ask`, `csv`, `interactive` for reuse.
- `packages/cli/src/commands/plan.test.ts`: integration tests for the three commands; `npm test` passes (159).

### Deviations from the plan
None.

### Gaps found in specs
- CHOICE: `plan graph` extracts the Mermaid block from `generatePlansMd` (non-live), so it is identical to PLANS.md and prints without a code fence.
- CHOICE: `plan new` prompts (slug, title, specs, dependencies) only on a TTY; otherwise `--title` and `--specs` are required, and `--id` is required (default date+slug applies only to the prompted slug).
- CHOICE: `steps/` is created empty (git does not track it until a step exists); HANDOFF.md holds only the header line.
- CHOICE: `plan show` prints the whole PLAN.md file including frontmatter; unknown ID uses `PlanNotFoundError`.
- CHOICE: a self-dependency fails as an unknown plan ID; the cycle check runs on the combined graph as a safeguard.

### Open issues
None.

### What the next step must know
This is the last step; run the finish flow.
