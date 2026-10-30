---
plan: 2026-10-30-plan-primitives
step: 3
title: "Checkout in status and start output; degraded fetch"
status: pending
context:
  - spec: feature/plan-execution#Execution backends
  - spec: feature/plan-execution#Start flow
  - spec: architecture/reference-cli#Plan status
  - spec: architecture/agent-skills#plan-status
  - spec: architecture/agent-skills#plan-start
  - file: packages/cli/src/commands/plan.ts
  - file: packages/cli/src/plan/flows.ts
  - file: packages/cli/src/plan/activity.ts
  - file: harnesses/claude/templates/skills/plan-status/SKILL.md
  - file: harnesses/claude/templates/skills/plan-start/SKILL.md
---

## Goal

Make the hand-off from the CLI to a working session explicit. `plan list --live --json` already
carries `checkout` (`plan/activity.ts`), but the human output drops it, `plan start` says only "open a
session" in prose, and nothing notices that the operator is standing in the wrong directory.
`checkout` means the plan's working-copy path (the worktree), not a `git checkout`.

## Acceptance criteria

- [ ] `plan list --live` prints the `checkout` column (absolute path); it stays blank for
      `branch`/`external` backends where no per-plan checkout exists.
- [ ] `plan start` output states whether the checkout was **created** or **resumed** (the flow already
      returns `resumed` and `backend`), names the backend, and for `worktree` prints one copy-pasteable
      line: `cd <checkout> && claude`.
- [ ] With `execution.backend: external`, `plan start` prints that the environment runs the finish flow
      itself and that `specplane plan finish` must not be run locally.
- [ ] `fetchPlanBranches` failure (remote configured, fetch fails) during `--live` prints exactly one
      notice to stderr and the command still exits 0 using local refs; `--no-fetch` stays silent.
- [ ] `/plan-status` shows `checkout` per plan, highlights the plan whose checkout the session is in,
      and warns once when the session is on branch `plan/<id>` but `cwd` is not that plan's `checkout`
      (no warning when `checkout` is null).
- [ ] `/plan-start` replaces its "open a new session" prose with the exact command from the CLI output.
- [ ] `specplane validate` and `npm test` pass; contract pins re-pinned.

## Tasks

1. Add the `checkout` column to the human table in `planListCommand`; keep the existing `where` column
   meaning (branch/backend) distinct.
2. Extend the `startPlan` result rendering: `resumed`, `backend`, `path`, and a `nextCommand` string
   (null for `external`) so the skill does not compose commands itself.
3. Wrap the `--live` fetch: when `hasRemote` is true and the fetch returns false, emit
   `notice: could not fetch origin; showing local refs` and continue.
4. Add the `external` message to the start flow output.
5. Update the two skills to render `checkout`/`nextCommand` and to compare `cwd` with `checkout`
   (`plan-status`), pointing at the exact `cd` line (`plan-start`).
6. Spec edits: `feature/plan-execution` § Start flow (what the flow reports), `architecture/
   agent-skills` `plan-start`/`plan-status`, and the Claude overlay table if a skill's behaviour
   column changes. Re-pin.

## Guidance

- Compare paths with `fs.realpathSync` on both sides: worktrees are often symlinked on macOS and the
  naive string compare produces false warnings.
- Keep the warning out of `--json` output; `--json` gains `checkout` and `nextCommand` fields instead.
- Do not change the finish flow's behaviour in this step; only its messaging in the `external` case.
