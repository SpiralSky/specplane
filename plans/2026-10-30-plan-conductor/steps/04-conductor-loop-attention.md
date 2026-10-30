---
plan: 2026-10-30-plan-conductor
step: 4
title: "The conductor loop, attention field, and alert dispatch"
status: pending
context:
  - spec: architecture/reference-cli#Plan status
  - spec: feature/agent-integration
  - spec: feature/plan-execution#Finish flow
  - spec: feature/configuration#Key reference
  - file: packages/cli/src/commands/plan.ts
  - file: packages/cli/src/plan/gate.ts
  - file: packages/cli/src/plan/next.ts
  - file: packages/cli/src/harness
---

## Goal

Run the loop: resolve, gate, spawn, observe, repeat — stopping only where a human is required, and
telling them (through the configured transport) what to run. Never merge.

## Acceptance criteria

- [ ] `plan run <id>` iterates until a terminal condition and prints a one-line outcome per
      iteration (`step 03 started`, `step 03 done (commit abc1234)`, `stopped: blocked`).
- [ ] Loop stops on: `blocked` step, `attention` kind `gap_decision`, `finish_ready`, `restack`,
      `diverged`, step/budget limit, or a spawn/observe failure. It never runs `plan finish`, never
      merges, never rebases the default branch.
- [ ] `plan list --live --json` gains `attention: [{kind, detail, command}]` per plan, derived from
      the same sources as `plan next` (no new file), and the human output prints the count per plan.
- [ ] Each new consideration produces exactly one alert on the configured transport, deduplicated by
      `plan + kind + hash(detail)` and persisted under `.specplane/` (gitignored) so a restart does
      not re-alert; a consideration that disappears and later returns is treated as new.
- [ ] Alert text states the decision and the resolving command, e.g. "plan 2026-10-30-plan-primitives
      is ready to finish: run `/plan-finish 2026-10-30-plan-primitives`".
- [ ] `transport: none` sends nothing; `harness` emits to the session/harness only; `command` runs the
      command with the documented env and ignores a non-zero exit (logged, not fatal).
- [ ] `plan start <id> --run` runs exactly one iteration and prints checkout, session id, and
      `claude attach`/`claude logs`; without `--run` the current output is unchanged.
- [ ] `--max-parallel N` runs up to N *plans* concurrently, one session each, with per-plan locks;
      tests cover two plans and refuse a second session for one plan.

## Tasks

1. Implement the loop in `src/plan/run.ts` over `next → gate → spawn → observe`, with a bounded poll
   interval and an interrupt handler that stops the loop but leaves the session running.
2. Add the `attention` derivation to the activity/status layer (shared with `plan next`) and expose it
   on `plan list --live --json` and the human table.
3. Implement alert dispatch: kind filter from `execution.notify.on`, transport switch, dedupe store,
   and the message template with `command`.
4. Add `--run` to `plan start`: run one iteration after the start flow and print the attach commands.
5. Update `architecture/reference-cli` (`plan run`, `attention`), `architecture/agent-skills`
   (new `plan-run` contract; `plan-start` step 4 spawns instead of "open a session"),
   `feature/plan-execution` (auto-run mode, concurrency, stop rules, no merge) and
   `feature/agent-integration` (consideration → alert), then re-pin skills.
6. Tests: stop conditions, dedupe across restart, `none`/`harness`/`command` transports, `--run`
   single iteration, and the two-plan parallel case.

## Guidance

- Do not add a fourth per-plan state file for progress. The only new persisted state is the alert
  dedupe cache, which is derived data and safe to delete.
- The loop's exit code is the last gate decision's code; `0` only when `finish_ready` or all steps are
  done.
- Alerting must not be able to fail the run: wrap transport calls and log.
