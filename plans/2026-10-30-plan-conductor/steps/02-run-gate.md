---
plan: 2026-10-30-plan-conductor
step: 2
title: "The rerun gate, --force, and exit codes"
status: pending
context:
  - spec: architecture/reference-cli#Plan status
  - spec: feature/plan-steps
  - spec: feature/plan-execution#Start flow
  - spec: architecture/file-formats#HANDOFF.md
  - file: packages/cli/src/plan/next.ts
  - file: packages/cli/src/plan/flows.ts
  - file: packages/cli/src/commands/plan.ts
  - file: packages/cli/src/git/repo.ts
---

## Goal

Define exactly when a step may run, so an unattended loop cannot duplicate work. The gate is
evaluated from git and the step files only; no new status file.

## Acceptance criteria

- [ ] Gate refusals, each with a distinct message and a documented exit code:
      `2` blocked, `3` refused (already done / half-finished / live session / lock held), `4` limit
      reached (steps or budget), `5` precondition (dirty, diverged, wrong backend).
- [ ] Already run: the resolved step's `status` is `done` or `skipped` → refuse; `--force --reason
      <text>` overrides, writes `Specplane-Force-Reason` into the step's next commit trailers, and
      notes it in the HANDOFF section.
- [ ] Half-finished: a commit on the plan branch carries `Specplane-Step: NN` while the step file
      still reads `pending` → refuse and print the recovery command (`plan show <id>`, then `plan
      step-done` with the right outcome, or `plan run --force --reason …` if the work must be redone).
- [ ] Live session: refuse when a session for the plan is observed as active, and when
      `<checkout>/.specplane-run.lock` exists with a live pid; a stale lock (dead pid) is reclaimed
      with a notice.
- [ ] Dirty/diverged: refuse on uncommitted changes in the checkout, on local/remote divergence, and
      on any backend other than `worktree` for the conductor path.
- [ ] `--dry-run` prints the decision (would run step NN / refused, why) and never spawns.
- [ ] `--until step|finish`, `--max-steps`, `--max-parallel`, `--max-budget-usd` are parsed and
      validated; `--max-parallel > 1` runs distinct plans only, never two steps of one plan.
- [ ] Unit tests cover every refusal, the force path, and stale-lock reclamation.

## Tasks

1. Implement `src/plan/gate.ts` returning `{ allowed, action, reason, code }`; it consumes `plan next`
   output rather than re-resolving.
2. Add trailer handling: extend the trailer writer to include `Specplane-Force-Reason` only when
   forced, and document the position in `architecture/file-formats` §8.
3. Implement the lock (`<checkout>/.specplane-run.lock`, JSON `{pid, sessionId, startedAt}`), with
   reclaim and a clear error when another conductor holds it.
4. Add the exit-code table to `architecture/reference-cli` and a `--json` failure shape
   (`{ ok: false, code, reason, action }`).
5. Wire the flags into `plan run` (the loop arrives in step 4; this step compiles the command surface
   and the gate with `--dry-run` only).

## Guidance

- Never infer "already run" from the HANDOFF text alone; the commit trailer is the durable evidence
  and the step status is the authority. Disagreement between them is itself a refusal.
- Do not reuse the `blocked` exit code for refusals: a conductor must be able to tell "a human is
  needed" from "this invocation is invalid".
- `--force` must never skip the live-session or lock checks; it only overrides the completed-step
  check.
