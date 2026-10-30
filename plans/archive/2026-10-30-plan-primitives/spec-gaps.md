# Spec gaps — 2026-10-30-plan-primitives

## G1: `plan next` is not described in `feature/tooling`
**Kind**: proposal
**Step**: 1
**Case**: `feature/tooling` lists the user-visible commands under `specplane plan`, but has no entry for `plan next`. The feature spec is human-authored (`llm_role: assist`), so the agent did not edit it; the command is specified only in `architecture/reference-cli` § Plan next.
**Resolution**: Add a `### specplane plan next <id> [--json]` entry to `feature/tooling` describing the read-only resolver and its `action` values, once the user finalises the text.
**Target spec**: feature/tooling
**Status**: open

## G2: `--no-fetch` semantics for `plan next`
**Kind**: assumption
**Step**: 1
**Case**: The step guidance says `plan next` must work without `--live` (no fetch) and also accept `--no-fetch`. Read literally, the command never fetches, which makes `--no-fetch` a no-op.
**Resolution**: Implemented as a no-op accepted for symmetry with `plan list --live`; `plan next` never fetches. Documented in `architecture/reference-cli` § Plan next.
**Target spec**: architecture/reference-cli
**Status**: open

## G3: `review` effective status and the closed `attention` set
**Kind**: assumption
**Step**: 1
**Case**: The step task lists `effective_status === review` as an attention source, but the closed attention set has no `review` kind.
**Resolution**: `finish_ready` is derived from "started and every step done or skipped", independent of `review`; a plan in `review` with steps left still resolves to its next step. `review` itself is not an attention kind.
**Target spec**: architecture/reference-cli
**Status**: open

## G4: refusing `--outcome done` on a `blocked` step contradicts re-running a blocked step
**Kind**: assumption
**Step**: 2
**Case**: The step criteria say `plan step-done` refuses when the step is `blocked` and `--outcome done` is passed. `architecture/file-formats` §4.1 (repeated sections) says a `blocked` step is run again and may then end `done`. Taken literally, a blocked step could never be finished through the CLI.
**Resolution**: The refusal is implemented as specified, and a new `--resume` flag confirms that the blocker is resolved and the step was run again; with it the command appends the new section and keeps the earlier `blocked` one. Documented in `architecture/reference-cli` § `plan step-done`.
**Target spec**: architecture/reference-cli
**Status**: open

## G5: `plan step-done` is not described in `feature/tooling`
**Kind**: proposal
**Step**: 2
**Case**: `feature/tooling` lists the `specplane plan` commands but has no entry for `plan step-done`, and the options added beyond the step brief (`--type`, `--trailer`, `--gap`, `--resume`, the `skipped` rule that a `--deviation` is required) are specified only in `architecture/reference-cli`. The feature spec is human-authored (`llm_role: assist`), so the agent did not edit it.
**Resolution**: Add a `### specplane plan step-done <id>` entry to `feature/tooling` once the user finalises the text, stating that the CLI writes the HANDOFF.md section and the step commit and never pushes.
**Target spec**: feature/tooling
**Status**: open

## G6: `feature/plan-execution` § Start flow does not say what the flow reports
**Kind**: proposal
**Step**: 3
**Case**: The Start flow's "Announce" step names only the worktree path or branch and the next step. The step brief wants it to state whether the checkout was created or resumed, the backend, the exact command to open the session, and, for `external`, that `specplane plan finish` must not be run locally. The feature spec is human-authored (`llm_role: assist`), so the agent did not edit it; the behaviour is specified in `architecture/reference-cli` § `plan start`.
**Resolution**: Extend § Start flow step 6 once the user finalises the text.
**Target spec**: feature/plan-execution
**Status**: open

## G7: `checkout` for the `branch` backend differs between the brief and § Plan activity
**Kind**: assumption
**Step**: 3
**Case**: The step criteria say the `checkout` column stays blank for `branch` and `external`. `architecture/reference-cli` § Plan activity defines the `checkout` JSON field for `branch` as the main checkout root while it is on `plan/<id>`. The two cannot both hold for the human output.
**Resolution**: The JSON field is unchanged (spec wins); the human `plan list --live` line prints `checkout <path>` only for the `worktree` backend. For `branch`, `plan start` gives `nextCommand` `claude` (the session is already in the checkout); `external` gets `null`.
**Target spec**: architecture/reference-cli
**Status**: open

## G8: `--json` for `plan start`
**Kind**: assumption
**Step**: 3
**Case**: The guidance says `--json` output gains `checkout` and `nextCommand` fields, but `plan start` had no `--json` and `plan list --json` has no start-time command.
**Resolution**: Added `plan start --json` (the `StartResult` plus `checkout`); `plan list --json` is unchanged apart from its existing `checkout` field. Documented in `architecture/reference-cli` § `plan start`.
**Target spec**: architecture/reference-cli
**Status**: open

## G9: step files have no creation command; `plan new` scaffolds only PLAN.md and HANDOFF.md
**Kind**: gap
**Step**: 4
**Case**: The step brief says `plan-create` creates files only via the CLI, but `specplane plan new` writes `PLAN.md` and `HANDOFF.md` and an empty `steps/` directory, and no command writes `steps/NN-<slug>.md`. Separately, `architecture/reference-cli` § `spec new` said the body was empty, while the scaffold writes the title and the section headings of `architecture/file-formats` §1.3/§1.4 (which it matches; no section was missing).
**Resolution**: `plan-create` writes the step files by hand and says so; the CLI is not extended (adding step scaffolding is new capability, out of scope for an adoption step). `reference-cli` § `spec new` now describes the scaffold. A `plan new --step` or `plan step new` command could be a later plan.
**Target spec**: architecture/reference-cli
**Status**: open

## G10: step 5 edits the approved `claude:feature/claude-integration`
**Kind**: proposal
**Step**: 5
**Case**: Task 3 asks for the `/plan-finish` row of § Slash commands in `claude:feature/claude-integration` to mention manual mode. That spec is `status: approved`, `author: mixed`, under `llm_role: assist`, so the text should be user-finalised. The agent made the one-cell description edit because the step names it, in its own commit (`Specplane-Workflow: spec`), so it can be reverted alone.
**Resolution**: Review the cell ("Run the finish flow for the current plan; without the CLI, prints the manual merge sequence") and revert commit if not wanted; the architecture spec carries the full behaviour.
**Target spec**: claude:feature/claude-integration
**Status**: open

## G11: `plan list --live` names restack as a stderr notice
**Kind**: assumption
**Step**: 5
**Case**: The criterion says `plan status` output names `specplane plan restack <id>` when a stacked base merged, but neither `plan list` nor its JSON has a field for it, and the human lines are per plan on stdout.
**Resolution**: `plan list --live` prints the same notice the start-resume path uses ("Base plan `<base-id>` has merged; run `specplane plan restack <id>`.") on stderr, once per such plan, skipping done, abandoned, archived plans and plans without a local branch. The JSON is unchanged. `reference-cli` was not edited beyond what agent-skills § plan-status says.
**Target spec**: architecture/reference-cli
**Status**: open
