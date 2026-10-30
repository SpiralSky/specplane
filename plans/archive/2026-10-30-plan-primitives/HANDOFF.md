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

## Step 03: Checkout in status and start output; degraded fetch

**Date**: 2026-10-30
**Outcome**: done

### What changed

- `packages/cli/src/commands/plan.ts, packages/cli/src/cli.ts`: checkout column, fetch-failure notice, start output and --json
- `packages/cli/src/plan/flows.ts`: StartResult.nextCommand
- `packages/cli/src/plan/flows.test.ts`: tests for start output, external message, list --live checkout and fetch notice
- `docs/specifications/architecture/reference-cli.md, docs/specifications/architecture/agent-skills.md`: plan list, plan start, plan-start and plan-status contracts
- `harnesses/claude/templates/skills/plan-start, plan-status, plan-step, .claude/skills copies`: render checkout and nextCommand; pins moved to 82404ea
- `plans/2026-10-30-plan-primitives/spec-gaps.md`: G6-G8

### Deviations from the plan

None.

### Gaps found in specs

- G6 (proposal): `feature/plan-execution` § Start flow does not say what the flow reports. See `spec-gaps.md`.
- G7 (assumption): `checkout` for the `branch` backend differs between the brief and § Plan activity. See `spec-gaps.md`.
- G8 (assumption): `--json` for `plan start`. See `spec-gaps.md`.

### Open issues

None.

### What the next step must know

plan start gains --json (StartResult plus checkout, nextCommand); the human list prints checkout only for the worktree backend (G7). Any further agent-skills.md edit needs the skill pins re-moved (git hash-object, 7 chars). packages/cli/node_modules is an untracked symlink: do not stage it.

## Step 04: Creation paths — route spec and plan creation through the CLI

**Date**: 2026-10-30
**Outcome**: done

### What changed

- `docs/specifications/architecture/agent-skills.md`: creation-via-CLI rule and spec-assist, spec-draft-architecture, plan-create contracts
- `docs/specifications/architecture/reference-cli.md`: spec new scaffold described
- `harnesses/claude/templates/skills/spec-assist, spec-draft-architecture, plan-create, plan-start, plan-status, plan-step, .claude copies`: call spec new / plan new, validate after creation, /approve pointer; pins moved to 8c6880a
- `packages/cli/src/commands/spec.test.ts`: scaffold headings, duplicate and validate test
- `plans/2026-10-30-plan-primitives/spec-gaps.md`: G9

### Deviations from the plan

None.

### Gaps found in specs

- G9 (gap): step files have no creation command; `plan new` scaffolds only PLAN.md and HANDOFF.md. See `spec-gaps.md`.

### Open issues

None.

### What the next step must know

Skills now create files via spec new / plan new; any further agent-skills.md edit needs the skill pins re-moved (git hash-object, 7 chars). Step files are still hand-written (G9). The spec new scaffold already matched the templates, so no CLI behaviour change was needed.

## Step 05: Harness docs — operations table, model invocation, manual finish

**Date**: 2026-10-30
**Outcome**: done

### What changed

- `docs/specifications/architecture/agent-skills.md`: operations table, standing-instruction routing note, plan-finish manual mode, restack pointer
- `harnesses/claude/specifications/architecture/claude-integration.md`: disable-model-invocation rule, plan-finish manual mode
- `harnesses/claude/specifications/features/claude-integration.md`: /plan-finish description (G10)
- `harnesses/claude/templates/skills/*/SKILL.md, .claude/skills copies`: plan-finish manual sequence, shared preamble, pins moved to c01fd20
- `AGENTS.md`: routing table outside the managed block
- `packages/cli/src/commands/plan.ts, packages/cli/src/plan/lifecycle.test.ts`: plan list --live restack notice and test
- `plans/2026-10-30-plan-primitives/spec-gaps.md`: G10-G11

### Deviations from the plan

None.

### Gaps found in specs

- G10 (proposal): step 5 edits the approved `claude:feature/claude-integration`. See `spec-gaps.md`.
- G11 (assumption): `plan list --live` names restack as a stderr notice. See `spec-gaps.md`.

### Open issues

- G9 (deferred): no CLI command writes step files, so `plan-create` still writes them by hand. May overlap with work tracked in the plan-conductor plan or a future plan. Leave for a future pass.

### What the next step must know

Last step: run /plan-finish. The feature spec edit was committed separately (G10). Skills were all re-pinned to c01fd20; claude architecture spec re-pinned to the feature spec.
