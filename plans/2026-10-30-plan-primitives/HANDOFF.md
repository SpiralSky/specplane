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
