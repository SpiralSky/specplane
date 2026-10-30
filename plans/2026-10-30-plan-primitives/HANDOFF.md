# HANDOFF — 2026-10-30-plan-primitives

## Step 01: plan next — read-only resolver

**Date**: 2026-10-30
**Outcome**: done

### What changed

- `packages/cli/src/plan/next.ts`: `computeNext` (pure) and `planNext` (read-only gatherer), `formatNext`; closed `attention` kinds and `action` values.
- `packages/cli/src/plan/flows.ts`: new exported `mergedStackBase`, shared by the start-resume notice and `plan next` (behaviour of `startPlan` unchanged).
- `packages/cli/src/commands/plan.ts`, `cli.ts`: `plan next <id> [--json] [--no-fetch]`.
- `packages/cli/src/plan/next.test.ts`: 7 tests (earlier blocked step wins, missing-context warnings, `checkout: null` on `branch`/`external`, gap precedence and `finish_ready`, dirty, attention dedupe, no-side-effects).
- `docs/specifications/architecture/reference-cli.md`: new § Plan next and `plan next <id>` command entry with the JSON object.
- `plans/2026-10-30-plan-primitives/spec-gaps.md`: G1-G3.

### Deviations from the plan

None. `node_modules` in the checkout is a symlink to the main repo's (git-ignored) so tests could run.

### Gaps found in specs

- G1 (proposal): `feature/tooling` has no `plan next` entry. See `spec-gaps.md`.
- G2 (assumption): `--no-fetch` is a no-op because `plan next` never fetches. See `spec-gaps.md`.
- G3 (assumption): `review` effective status is not an attention kind; `finish_ready` depends only on step state. See `spec-gaps.md`.

### Open issues

None.

### What the next step must know

`plan next` JSON uses camelCase keys (`effectiveStatus`, `openGaps`). `blocked` is a string array of HANDOFF `BLOCKED:` lines, populated only when the next step is `blocked`. Step 2 (`plan step-done`) should keep step status and HANDOFF outcome in agreement, since `plan next` trusts step file status. The `plan-step` skill text still describes the manual flow; changing it belongs to later steps. `specplane validate` has pre-existing warnings (out-of-date `plans/PLANS.md`, plan-conductor context file not yet existing).

## Step 02: plan step-done — CLI owns the HANDOFF and commit formats

**Date**: 2026-10-30
**Outcome**: done

### What changed

- `packages/cli/src/plan/step-done.ts`: stepDone builds the §4.1 section, sets the step status, and commits with ordered trailers; refusals run before any write and a failed commit restores the files
- `packages/cli/src/commands/plan.ts, packages/cli/src/cli.ts`: plan step-done <id> with the flags of the step brief plus --type, --gap, --trailer, --resume
- `packages/cli/src/plan/step-done.test.ts`: 10 tests (format and trailer order, session trailer, each refusal, resume, skipped, rollback)
- `docs/specifications/architecture/reference-cli.md`: new plan step-done command contract
- `docs/specifications/architecture/agent-skills.md`: plan-step steps 7-9 delegate to the CLI, manual fallback kept
- `harnesses/claude/templates/skills/plan-step/SKILL.md, .claude/skills/plan-step/SKILL.md`: call the CLI for the HANDOFF and commit; contract pin moved to dbfad2e
- `plans/2026-10-30-plan-primitives/spec-gaps.md`: G4-G5

### Deviations from the plan

The refusal for done on a blocked step is paired with a --resume flag so blocked steps can still be re-run (G4). Only the plan-step skill was re-pinned; other skills keep their pre-existing drift warnings.

### Gaps found in specs

- G4 (assumption): refusing `--outcome done` on a `blocked` step contradicts re-running a blocked step. See `spec-gaps.md`.
- G5 (proposal): `plan step-done` is not described in `feature/tooling`. See `spec-gaps.md`.

### Open issues

None.

### What the next step must know

Use `plan step-done` for HANDOFF sections and step commits in later steps (stage the work first; pass --trailer for Co-Authored-By and SPECPLANE_AGENT for the agent trailer). It commits whatever is staged plus the plan folder and never pushes. `--outcome skipped` requires a --deviation. Steps 3-4 may change the skill text again, which needs another pin update (git hash-object of agent-skills.md).
