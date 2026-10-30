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
