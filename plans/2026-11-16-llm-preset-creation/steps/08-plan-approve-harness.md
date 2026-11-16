---
plan: 2026-11-16-llm-preset-creation
step: 8
title: Approve plans and decision records from the harness
---
## Goal

Let the harness approve plans. The CLI already does (`plan approve <id>`, requestable as `plan approve`, guarded by `spec.approve.feature`), and `approveSpecs` in `packages/cli/src/spec/human.ts` already routes decision record IDs (`isDecisionId`, `approveDecisions`) and rejects mixing decisions with specifications. Plan IDs are the missing part: approving one from a session fails with "Specification `<plan-id>` not found". Resolution order is specification, then plan, then decision record (`architecture/reference-cli`, "Approving plans and decision records"); keep the mixed-ID rule. Code: `packages/cli/src/harness/actions.ts` (the `spec.approve` action), `approvePlan` in `packages/cli/src/plan/create.ts` (about line 73, takes a `PlanCtx`), `packages/cli/src/harness/run.ts` (`specApproveHuman`, about lines 110 and 131), `packages/cli/src/spec/human.ts`, and the matcher from step 5.

## Acceptance criteria

- `spec.approve` (harness) and `/approve` accept a plan ID and a decision record ID as well as specification IDs, under `spec.approve.feature` and the same checks as the CLI.
- With the LLM role's `spec.approve.feature` as request user, approving a plan sends a `plan approve` request; as deny it refuses; as allow it approves.
- The match listing of step 5 includes plans and decision records.
- A test covers plan and decision approval through the harness action and the typed command.

## Tasks

1. Route plan IDs in the harness approve action and in `specApproveHuman` to `approvePlan`; keep the decision path.
2. Make the typed `/approve` resolve them too and reuse the step 5 matcher for inexact names.
3. Write the tests and update `docs/user/commands.md`.

## Worker conventions (every step)

- Work only in this plan's worktree. Run `npx tsc --noEmit -p .` in `packages/cli` before every `npm run build`, then `npm test` (it builds first). Run `sh harnesses/claude/tests/hooks.test.sh` and `sh harnesses/claude/tests/check-sync.sh` whenever hooks, templates or `.claude/` files change; `docs/user` edits must pass `npm run build` (`validate-docs.mjs`, `build-command-docs`).
- Stage specific paths only (never `git add -A`; `demo.cast` is untracked). Commit messages follow `file-formats` §8 and end with the `Co-Authored-By` trailer given in the session context; add the `Specplane-Agent` and `Specplane-Session` trailers when those variables are set.
- Record gaps in the step handoff (`plan step-done`), not in code comments.
