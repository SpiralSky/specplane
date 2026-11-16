---
plan: 2026-11-16-llm-preset-creation
step: 7
title: R71 refuse denied commands before the model turn
---
## Goal

Before a typed command with arguments starts a model turn, read the command's `Requires:` line and refuse it when the LLM role has a required permission as deny. Spec: `feature/harness` R71, `architecture/agent-skills` "Required permissions". Code: the Claude plugin dispatch in `harnesses/claude/plugin/hooks/commands.ts` (commands with `modelWithArgs: true`) and the mode lookup the guard uses in `packages/cli/src/perm/permissions.ts`; expose the check as a core read so the plugin does not duplicate the mode logic.

## Acceptance criteria

- A deny on a required permission shows the standard denial text, names the permission, and starts no model turn; allow and request user start the turn; a command with no `Requires:` line always starts it.
- Tests cover these cases for `plan-abandon` and `validate` through the plugin command path. Codex has no typed commands and is unchanged.

## Tasks

1. Add the core read that returns the required permissions of a command and the LLM role's mode for each.
2. Call it from the plugin dispatch before the turn and print the refusal as the command output.
3. Write the tests; note the behaviour in `docs/user/harnesses.md`.
