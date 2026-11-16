---
plan: 2026-11-16-llm-preset-creation
step: 6
title: R71 refuse denied commands before the model turn
---
## Goal

Before a typed command with arguments starts a model turn, refuse it when the LLM role has a required permission as deny. Spec: `feature/harness` R71 and `architecture/agent-skills` "Required permissions". Code: the contracts in `harnesses/claude/templates/skills/*/SKILL.md` and `harnesses/codex/templates/contracts/*.md` (their Preconditions already say "`plan.start` must not be deny"), the Claude plugin command dispatch (`harnesses/claude/plugin/hooks/commands.ts`, `modelWithArgs`), and the harness command runner in `packages/cli/src/harness`.

## Acceptance criteria

- Each contract that starts a model turn has a `Requires:` line listing its required permissions; a test fails when it differs from the "must not be deny" sentence.
- A deny on a required permission refuses at once with the standard denial text naming the permission and starts no model turn; allow and request user start the turn; a deny on a permission that is not required (for example `plan.edit` for plan-create) starts it.
- Tests cover each of those three cases through the harness command path, for Claude; Codex has no typed commands and keeps the contract text only.

## Tasks

1. Add the `Requires:` lines to the contracts in both harness template folders and keep `check-sync.sh` green.
2. Read the lines in the command path and check the LLM role's modes with the same function as the guard.
3. Refuse with the denial text; otherwise start the turn as before.
4. Write the tests; note the behaviour in `docs/user/harnesses.md`.
