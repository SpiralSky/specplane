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
