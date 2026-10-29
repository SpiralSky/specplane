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
