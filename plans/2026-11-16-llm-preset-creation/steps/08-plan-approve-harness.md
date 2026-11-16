---
plan: 2026-11-16-llm-preset-creation
step: 8
title: Approve plans and decision records from the harness
---
## Goal

Let the harness approve plans and decision records, which the CLI already does (`plan approve <id>`, requestable as `plan approve`, guarded by `spec.approve.feature`). Today the harness action `spec.approve` and the typed `/approve` command only resolve specification IDs, so approving a plan from a session fails with "Specification `<plan-id>` not found" even though the approve skill and the `spec.approve.feature` steering both say they approve plans and decision records. Code: `packages/cli/src/harness/actions.ts` (the `spec.approve` action), `packages/cli/src/commands/plan-cli.ts` (`plan approve`) and its core function, the typed approve path in `harnesses/claude/plugin/hooks/commands.ts`, and the match listing from step 5.

## Acceptance criteria

- `spec.approve` (harness) and `/approve` accept a plan ID and a decision record ID as well as specification IDs, under `spec.approve.feature` and the same checks as the CLI.
- With the LLM role's `spec.approve.feature` as request user, approving a plan sends a `plan approve` request; as deny it refuses; as allow it approves.
- The match listing of step 5 includes plans and decision records.
- A test covers plan and decision approval through the harness action and the typed command.

## Tasks

1. Route plan and decision IDs in the harness approve action to the existing approval functions.
2. Make the typed `/approve` resolve them too and reuse the step 5 matcher for inexact names.
3. Write the tests and update `docs/user/commands.md`.
