---
plan: 2026-10-30-plan-primitives
step: 1
title: "plan next — read-only resolver"
status: done
context:
  - spec: architecture/reference-cli#Plan status
  - spec: architecture/reference-cli#Plan parsing and validation
  - spec: feature/plan-status#Derived statuses
  - spec: architecture/file-formats#Step files
  - file: packages/cli/src/plan/activity.ts
  - file: packages/cli/src/plan/parse.ts
  - file: packages/cli/src/plan/resolve.ts
  - file: packages/cli/src/commands/plan.ts
---

## Goal

Add `specplane plan next <id> [--json]`, a read-only resolver that answers "what should happen next
for this plan, and can an agent start it without asking anyone?" It is the primitive the conductor
and every harness will call; it must not write files, spawn anything, or mutate git state.

## Acceptance criteria

- [x] `plan next <id>` prints a human summary; `--json` prints the object below and nothing else on
      stdout.
- [x] The next step is the lowest-numbered step not `done`/`skipped`, and an earlier `pending` or
      `blocked` step wins over a later one (same rule as `plan-step` step 2), with the reason stated.
- [x] Context items are resolved to concrete paths with anchors; unresolved specs are reported as
      `warnings`, not errors.
- [x] `attention` is derived, never stored, and uses a closed set of kinds: `blocked`, `gap_decision`,
      `finish_ready`, `restack`, `diverged`, `dirty`.
- [x] `action` is exactly one of `spawn_step`, `ask_human`, `finish`, `restack`, `none`, and the
      `--json` object is documented in `architecture/reference-cli`.
- [x] Running it twice leaves `git status` and the worktree unchanged (assert in a test).
- [x] `specplane validate` and `npm test` pass; the spec section is updated in the same commit.

## Tasks

1. Read `plan/activity.ts` (`getPlanActivity`, `fetchPlanBranches`) and `plan/parse.ts`'s next-step
   resolution plus `plan/status.ts` for effective status; reuse them rather than re-deriving.
2. Define the JSON shape in `architecture/reference-cli` (new subsection under `## Plan status`):
   `{ plan, title, effectiveStatus, step: {number, title, status, file} | null, context: [{kind, id,
   path, anchor}], checkout, blocked, openGaps, warnings, attention, action, reason }`.
3. Implement `src/plan/next.ts` (pure) plus `planNextCommand` in `src/commands/plan.ts`; register
   `plan next <id> [--json]` in `src/cli.ts`.
4. Derive `attention` from existing sources only (step/HANDOFF outcomes, `spec-gaps.md` entries of
   kind `proposal` or `assumption` still `open`, `effective_status === review`, stacked base merged,
   local/remote divergence, dirty worktree). Do not read or write a new state file.
5. Map `attention` + step state to `action`, with `blocked` and `gap_decision` taking precedence over
   `spawn_step`.
6. Tests: next step selection with an earlier blocked step, context resolution with a missing file
   (warning), `checkout: null` on the `branch` and `external` backends, attention dedupe by kind, and
   the no-side-effects assertion.

## Guidance

- Keep the command usable without `--live` (no fetch) so it is safe to call in a loop; accept
  `--no-fetch` and default to the same behaviour as `plan list --live` minus fetching.
- `plan next` must stay harness-neutral: no `claude` words in the output. The harness maps `action`
  to its spawn mechanism.
- Do not implement `--run` here. The conductor calls `plan next`, checks gates, then spawns.
