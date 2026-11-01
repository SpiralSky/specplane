> Experimental implementation exists on `dot/complete-framework-20261031`; see proposed ADR 0005 and `docs/work-records/2026-11-01-experimental-conductor.md`. Live Claude compatibility remains unverified. No plan has been finalized or merged; this note is not an approval.

# Harness orchestration — design note

> **Status:** review input, 2026-10-30. This is **not a spec**. It records a proposed rework of the
> harness workflow and the review findings that led to it. Touching `feature/*` specs needs the
> user's authorship (`llm_role: assist`); the spec edits listed under "Impact" are a checklist, not
> applied changes. Related open questions: OQ-12 … OQ-15 in `docs/OPEN-QUESTIONS.md`.

## Why

Today the harness wraps one command per workflow, and the human is the orchestrator:

```
/plan-start <id>        → CLI creates branch + worktree, prints the path
   (human opens a new session in the worktree)
/plan-step <id>         → one step, one session, commits + HANDOFF
   (repeat)
/plan-finish <id>       → tests, rebase, archive, merge
```

The pieces are sound, but the hand-off is manual, the human decides how many plans/step sessions to
run, and nothing escalates "this needs your decision" other than the agent printing text into a
session the human may not be watching. Claude Code now has native background sessions, so the
harness can own the session-by-session loop instead of the human.

## Verified Claude Code capabilities

Checked with `claude --version` = `2.1.312` on 2026-10-30 (`claude --help`, `claude agents --help`,
`claude logs/attach/stop/rm --help`) — re-verify before implementing.

- `claude --bg` / `--background`: start a session in the background, return immediately, print the
  session id. Works with `--resume <session-id>` (continues in the background) and `--name <name>`.
- `claude agents [--json] [--cwd <path>] [--all]`: list active (or all completed) sessions; `--json`
  is a machine-readable array. `claude logs <id>`, `claude attach <id>`, `claude stop <id>`,
  `claude rm <id>` form the lifecycle.
- `claude -p` with `--output-format json|stream-json`, `--json-schema`, `--max-budget-usd`,
  `--permission-mode`, `--permission-prompts host|none`, `--session-id <uuid>`.
- **Conflict:** `claude -w/--worktree [name]` and `--tmux` create Claude Code's *own* git worktree,
  and `claude rm` cleans up "its worktree". Specplane's `execution.backend: worktree` already creates
  the worktree. Never combine the two by default: launch with `claude --bg` from (or `--cwd`) the
  Specplane worktree and do **not** pass `--worktree`.
- No `--max-turns` in this version; bound cost with `--max-budget-usd` and a step limit in the
  conductor instead.
- `--cloud` / `--environment` exist and map to the already-specified `execution.backend: external`
  (the environment runs its own checkout and finish equivalent).

Consequence: the "background session is not possible → use a subagent" fallback is unnecessary.
It would also be unsound: `Agent` has no `cwd` parameter, subagents inherit the parent session's
checkout, and `cd` inside Bash does not move file tools or hook roots. Recorded as rejected.

## Proposed flow: `plan start --run` (harness option)

1. Run `specplane plan start <id>` unchanged (validation, branch, worktree, setup hook) and keep its
   JSON/`next` result.
2. If `--run` was passed, the harness spawns the first step session in the returned checkout:
   `claude --bg --name "specplane/<id>/<step>" [--session-id <uuid>] "<prompt>"` with the worktree as
   cwd. Prompt: run `/plan-step <id> --unattended` (the skill already defines unattended mode).
3. Without `--run`, keep today's behaviour: report the checkout and next step and stop. `--run` is
   opt-in; the interactive default does not change (OQ-13).
4. The conductor polls `claude agents --json` plus `specplane plan list --live --json`, and starts the
   next step's session when the previous one exited `done`. It never runs two sessions for the same
   plan (the branch invariant already forbids it).
5. On `blocked`, open gaps that need a human, a policy denial, budget exhaustion, divergence, or a
   finish-ready plan, it stops and raises an alert (below). It does not merge on its own.

Session identity: derive a deterministic UUID (`uuid5` of `<plan-id>/<step-number>`) and pass
`--session-id`, so a restarted conductor is idempotent and the `Specplane-Session` trailer is stable.
The `plan-step` skill already writes that trailer from `$SPECPLANE_SESSION`; the harness must make
sure the value is visible to the session (env or session-context hook), or discover it from
`claude agents --json` by cwd/name. That is OQ-15.

## The bigger rework: a conductor, not a command suite

Options considered:

| Option | Where the loop lives | Pros | Cons |
|---|---|---|---|
| A | Each harness skill (Claude-only) | fastest to ship; native `--bg` | duplicates the loop per harness; not testable in the CLI |
| B | CLI `specplane plan run` + harness spawn adapter | harness-neutral; testable; same loop for any agent | new config/contract surface; CLI must know how to launch an agent |
| C | External orchestrator (CI, cloud) | fits `external` backend; no local quota | hooks/permissions differ; more setup |

Recommendation: **B**, with the harness supplying only `detect/install/spawn/observe`. The
harness-neutral contract already exists (`architecture/agent-skills`); this extends it with a
`plan-run` workflow and keeps Claude-specific detail in the overlay. Concretely:

- `specplane plan next <id> [--json]` — resolved next step + context items + checkout (also fixes the
  no-harness gap below).
- `specplane plan run <id> [--until step|finish] [--max-parallel N] [--max-steps N]` — conductor.
  Spawns via `execution.agent_command` (or the harness registry), observes via the harness adapter.
- `specplane plan list --json --live` gains an `attention` array, so any front end can render the
  queue without parsing files.

Concurrency and limits:

- Parallelism is per **plan**, not per step: `--max-parallel` (default 1) plans at a time; one
  session per plan, ever.
- Per-session budget (`--max-budget-usd`), per-run step limit, and a hard stop on `blocked`/`skipped`
  or a dirty/diverged worktree.
- No unattended merge. `plan finish` with `merge: local_merge` still needs a human confirmation; the
  conductor stops at `review`/finish-ready and alerts. (The existing `/plan-finish` unattended
  contract already refuses to merge without `confirm`.)

Alerting ("standard alert user if considerations"):

Define a **consideration** as any state the unattended contract is not allowed to resolve on its
own: contradiction between specs, a `spec-gaps.md` entry that is a spec-edit proposal, a blocked
step, a policy-guard denial, a budget/step stop, a diverged remote, or a plan ready to finish/merge.
The data already exists (blocked issues, open gaps, effective status); do not add a fourth file.

- `plan list --json --live`: add `attention: [{kind, detail}]`, derived from those sources.
- Harness rendering: status line/pane for the active plan, `claude agents --json` for liveness, and
  one desktop/terminal notification per new consideration per plan. Deduplicate by plan+kind so a
  polling conductor does not spam.
- The alert text must say the decision and the command that resolves it (e.g. "plan X ready to
  finish: run /plan-finish X").

Lifecycle and cleanup:

- `claude stop` keeps the conversation; `claude attach` resumes it; `claude logs` is the audit trail.
  Do not copy logs into the plan folder — `HANDOFF.md` is the durable record.
- Cleanup stays `specplane plan cleanup/abandon`. Do not let `claude rm` remove the Specplane
  worktree; verify on first implementation whether a `--bg` session started with `--cwd` (rather than
  `--worktree`) makes `claude rm` attempt a worktree removal, and avoid it if so.

Permissions and trust:

- Unattended sessions cannot answer prompts, so the run configuration must choose
  `--permission-mode` (default `acceptEdits`) and `--permission-prompts none`, with the policy guard
  still enforcing `llm_role`. Hook denials must surface as a stop, not be worked around.
- `--dangerously-skip-permissions` is excluded. Note `-p` skips the workspace-trust dialog; only run
  in checkouts the user trusts.
- Cost/plan limits: background sessions consume the user's quota; the budget cap and `--max-parallel`
  are the guard rails.

## Impact (needs user-approved spec edits)

- `feature/plan-execution` — auto-run/orchestration as an optional mode, concurrency limits, stop and
  finish-confirmation rules.
- `feature/agent-integration` (or a new feature spec) — harness-neutral conductor contract and the
  definition of a consideration/alert.
- `architecture/agent-skills` — `plan-start` step 4 (spawn instead of "open a session"); new
  `plan-run` contract; session-identity rule.
- `claude:feature/claude-integration` + `claude:architecture/claude-integration` — `--bg` spawn,
  `--cwd`/no `--worktree`, session naming, alerts, trust/permission defaults.
- `architecture/reference-cli` — `plan next`, `plan run`, `attention` field, session mapping.
- `feature/configuration` — `execution.agent_command`, `execution.permission_mode`,
  `execution.max_parallel` (names TBD).
- Probably ADR 0005: orchestration in the CLI vs. in each harness (OQ-12).

## Review backlog (independent of orchestration)

- **No step primitive in the CLI.** After `plan start`, everything is manual without a harness. Add
  `plan next` and a structured `plan step-done` that writes the HANDOFF section and the commit
  trailers (the formats currently live only in the skill).
- **Checkout hand-off.** `/plan-status` does not show `checkout` even though `plan list --live --json`
  provides it; `/plan-start` tells the user to "open a session" in prose instead of printing a
  `cd`/`claude` command. Add both, and a warning when the current checkout is not the plan's.
- **Creation paths diverge.** `/plan-create` uses `plan new`, but `spec-assist` and
  `/spec-draft-architecture` write files directly instead of using `spec new <type> <slug>`; two
  writers for one format. Add `/spec-new` or call `spec new` first, then `spec validate <id>`.
- **Coverage gaps.** No slash command for `plan restack` (the CLI prints it as the fix for a merged
  base), nor for `cleanup`/`archive`/`spec pin`/`generate`/`search`. Either add `/plan-restack` or
  state explicitly which operations are CLI-only.
- **Natural language is partly disabled.** All skills except `spec-assist`, `plan-status`, `validate`
  set `disable-model-invocation: true`, so prose like "start the login plan" will not trigger them.
  Decide per skill and document the rule.
- **Smaller items.** `/plan-status` should fall back to `--no-fetch` after a failed fetch; `plan start`
  should announce resume distinctly; `/plan-create` should point at `/approve`; `external` backend
  should say at start that the environment runs finish itself; `/plan-finish` without the CLI should
  print the manual sequence instead of stopping (skill-pin normalisation is tracked separately in
  `HANDOFF.md`).
