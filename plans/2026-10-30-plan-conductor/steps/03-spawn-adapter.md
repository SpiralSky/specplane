---
plan: 2026-10-30-plan-conductor
step: 3
title: "Harness spawn adapter — background sessions in the plan checkout"
status: pending
context:
  - spec: architecture/agent-skills#plan-start
  - spec: claude:architecture/claude-integration#Worktree and cloud sessions
  - spec: claude:architecture/claude-integration#Subagent step execution
  - spec: feature/plan-execution#Worktree concerns
  - spec: feature/configuration#Key reference
  - file: packages/cli/src/harness
  - file: packages/cli/src/plan/flows.ts
  - file: harnesses/claude
---

## Goal

Give the conductor one way to start and observe a session, with all Claude Code specifics behind the
adapter. Launch in the Specplane checkout, pick a deterministic session id, and resume rather than
duplicate.

## Acceptance criteria

- [ ] The adapter interface is `spawn({checkout, name, sessionId, prompt, budgetUsd}) → {sessionId,
      pid}`, `observe(sessionId|checkout) → running|done|failed|missing`, and `logs/stop/attach`
      command strings; it is harness-neutral and testable with a fake.
- [ ] Claude adapter spawns `claude --bg --cwd <checkout> --name specplane/<plan>/<step>
      --session-id <uuid5(plan/step)> --permission-mode acceptEdits --permission-prompts none
      [--max-budget-usd N] "<prompt>"` and **never** passes `--worktree` or `--tmux`.
- [ ] The prompt is "run `/plan-step <id> --unattended`"; the adapter does not restate the step
      contract.
- [ ] `SPECPLANE_SESSION` is visible to the session (env or settings hook), and equals the value of
      the `Specplane-Session` trailer; when it cannot be injected, the fallback is discovery from
      `claude agents --json` by `--name`, and the chosen path is logged.
- [ ] Restarting the conductor resumes the same session (`claude --bg --resume <id>`), not a new one;
      an existing session for the same `<plan>/<step>` is adopted.
- [ ] `execution.backend: external` makes the adapter refuse with "the external environment runs its
      own sessions" instead of spawning locally.
- [ ] A test asserts that spawning creates no additional worktree (`git worktree list` unchanged) and
      that the generated session id is stable across runs.

## Tasks

1. Extend the harness registry with the spawn/observe contract and a `fake` implementation used by
   tests; keep the existing detect/install entries untouched.
2. Implement the Claude spawn adapter with the exact flag set above, verifying each flag against
   `claude --help` at implementation time and recording the verified version in the code comment.
3. Resolve the checkout from the `plan start` result / `plan next` output; fail if it is null.
4. Implement session-id derivation (`uuid5` over `<plan-id>/<step-number>`) and the resume path.
5. Deliver `SPECPLANE_SESSION`: prefer the session-context hook/settings env (documented in the
   overlay); fall back to `claude agents --json` discovery by name, and log which was used.
6. Record the capability check in `claude:architecture/claude-integration` § Worktree and cloud
   sessions (version, flags, no `--worktree`, permissions, cost).

## Guidance

- `claude rm` can attempt worktree cleanup for sessions it owns. Verify on the first implementation
  whether a `--cwd` session is affected; if it is, the adapter must not use `claude rm` and cleanup
  stays with `specplane plan cleanup`.
- `--dangerously-skip-permissions` is excluded; do not add a config escape hatch for it.
- Do not copy session logs anywhere. `HANDOFF.md` is the durable record; the adapter exposes
  `claude logs` as a string for humans.
