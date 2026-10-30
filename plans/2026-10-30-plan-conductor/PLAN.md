---
id: 2026-10-30-plan-conductor
title: "Plan conductor — plan run, session mode, and alerts"
status: ready
specs: ["architecture/reference-cli","architecture/agent-skills","feature/plan-execution","feature/configuration","feature/spec-precedence","feature/agent-integration","claude:architecture/claude-integration","claude:feature/claude-integration"]
depends_on: ["2026-10-30-plan-primitives"]
---

# Plan conductor — plan run, session mode, and alerts

## Goal

Move the session-by-session loop from the human into the CLI: `specplane plan run <id>` resolves the
next step with `plan next`, refuses to re-run anything already done without an explicit
`--force --reason`, spawns one unattended session per step through the harness adapter, observes it,
and stops with a resolvable alert whenever a human decision is required. It never merges.
`plan start --run` becomes sugar for the first iteration.

## Scope

- `execution.session_mode` and the notification policy (`execution.notify.*`): Specplane decides
  *whether* to alert and *what* the alert says; the transport belongs to the harness/user.
- `specplane plan run <id> [--until step|finish] [--max-steps N] [--max-parallel N] [--force --reason
  <text>] [--dry-run] [--json]`, with a closed set of exit codes and a per-plan lock.
- The rerun gate: already-`done`, half-finished (trailer without status), live session, dirty or
  diverged worktree. `--force` overrides only the status check and records the reason.
- Harness spawn adapter (`claude --bg` in the Specplane checkout, deterministic session id, resume
  instead of respawn), with `external` refusals.
- `attention` on `plan list --live --json` and the conductor's stop/alert rules, including dedupe.

## Non-goals

- No merge, rebase, or push of the default branch by the conductor. `plan finish` keeps its human
  confirmation.
- No new per-plan state file for status; run state is derived from git and the step files.
- No scheduler, daemon, web UI, or CI runner. The conductor is a foreground process that exits.
- No support for harnesses other than Claude Code in this plan; the adapter contract is written so a
  second harness can be added without changing the loop.

## Specs implemented

| Spec | Coverage |
|------|----------|
| `architecture/reference-cli` | `plan run`, its flags, exit codes, `attention` field |
| `architecture/agent-skills` | `plan-run` contract, `plan-start` step 4 (spawn), session identity |
| `feature/plan-execution` | auto-run as an optional mode, concurrency and stop rules |
| `feature/configuration` | `execution.session_mode`, `execution.notify.*`, `execution.max_parallel` |
| `feature/spec-precedence` | session mode as configured input, never downgrading a detected unattended session |
| `feature/agent-integration` | harness-neutral conductor contract, definition of a consideration |
| `claude:architecture/claude-integration` | `--bg` spawn, `--cwd`/no `--worktree`, naming, permissions |
| `claude:feature/claude-integration` | notifications delegated to the user's Claude Code settings |

## Acceptance criteria

- [ ] `plan run` refuses to run a step that is already `done`, a step whose commit exists without a
      status change, a plan with a live session, or a dirty/diverged worktree; `--force --reason` is
      required to override the first and the reason lands in the commit trailer.
- [ ] A restarted `plan run` resumes the same session (deterministic id) instead of spawning a second
      one for the same step; tests cover the restart and the double-invocation race.
- [ ] `plan start --run` runs exactly one iteration and prints the checkout, session id, and the
      `claude attach`/`claude logs` commands; without `--run` nothing changes.
- [ ] The conductor stops and alerts on `blocked`, a `proposal`/`assumption` gap needing a decision,
      finish-ready, restack-needed, divergence, budget/step exhaustion, and never on ordinary progress.
- [ ] Alerts are one per new consideration per plan (dedupe by plan+kind+detail), say the decision and
      the resolving command, and use no transport when `execution.notify.transport: none`.
- [ ] With `transport: harness`, Specplane emits the alert into the session/harness and sends nothing
      itself; with `transport: command`, it invokes the configured command with the documented env.
- [ ] `execution.session_mode: unattended` forces unattended behaviour; nothing can force an attended
      session where the harness detected no human.
- [ ] ADR 0005 records the CLI-vs-harness decision; OQ-12…OQ-15 are resolved with links; `specplane
      validate` and `npm test` pass.

## Risks

1. **Quota burn.** A loop that spawns sessions unattended can spend real money. Mitigation:
   `--max-steps`, `--max-budget-usd` passthrough, `--max-parallel` default 1, and a mandatory
   `--dry-run` check in the plan's own docs; the default `plan start` stays interactive.
2. **Two worktrees.** `claude --worktree` would create a second checkout. Mitigation: never pass it;
   launch with `--cwd <checkout>`, and assert in a test that no new worktree ref appears.
3. **Half-finished steps.** A crashed session leaves a `Specplane-Step` trailer with `pending` status.
   Mitigation: the gate refuses and points at the recovery command rather than silently re-running.
4. **Alert fatigue.** A polling conductor can re-alert. Mitigation: dedupe on plan+kind+detail hash,
   persisted under `.specplane/` (gitignored), and never alert on progress.
5. **Spec drift on session mode.** `feature/spec-precedence` already defines unattended behaviour;
   this plan must extend it, not restate it. Mitigation: edit the definition of the decision inputs
   only, and reference the existing rules for the consequences.

## Steps

1. `01-session-mode-and-notify`: `execution.session_mode` and `execution.notify.*` in config, spec,
   and the harness contract.
2. `02-run-gate`: the rerun gate, `--force --reason`, exit codes, per-plan lock, resume semantics.
3. `03-spawn-adapter`: harness spawn/observe adapter for Claude Code (`--bg`, `--cwd`, session id).
4. `04-conductor-loop-attention`: the loop, stop rules, `attention` field, alert dispatch and dedupe,
   `plan start --run`.
5. `05-adr-and-rollout`: ADR 0005, OQ resolutions, documentation, and the end-to-end test suite.
