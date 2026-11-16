---
plan: 2026-11-16-llm-preset-creation
step: 7
title: R71 refuse denied commands before the model turn
---
## Goal

Before a typed command with arguments starts a model turn, read the command's `Requires:` line and refuse it when the LLM role has a required permission as deny. Spec: `feature/harness` R71, `architecture/agent-skills` "Required permissions". Code: the Claude plugin dispatch in `harnesses/claude/plugin/hooks/commands.ts` (commands with `modelWithArgs: true`) and the mode lookup the guard uses in `packages/cli/src/perm/permissions.ts`; `dispatch` in the plugin only has `core.run(argv)`, so expose the check as a core subcommand, for example `harness run requires <command> --json`, that reads the `Requires:` lines from the embedded templates in `dist/templates` and the LLM role's modes, and returns the first denied permission or none. Call it before the `modelWithArgs` branch (`commands.ts` about line 343). Plugin tests live in `packages/cli/src/harness/claude-plugin-commands.test.ts`.

## Acceptance criteria

- A deny on a required permission shows the standard denial text, names the permission, and starts no model turn; allow and request user start the turn; a command with no `Requires:` line always starts it.
- Tests cover these cases for `plan-abandon` and `validate` through the plugin command path. Codex has no typed commands and is unchanged.

## Tasks

1. Add the core read that returns the required permissions of a command and the LLM role's mode for each.
2. Call it from the plugin dispatch before the turn and print the refusal as the command output.
3. Write the tests; note the behaviour in `docs/user/harnesses.md`.

## Worker conventions (every step)

- Work only in this plan's worktree. Run `npx tsc --noEmit -p .` in `packages/cli` before every `npm run build`, then `npm test` (it builds first). Run `sh harnesses/claude/tests/hooks.test.sh` and `sh harnesses/claude/tests/check-sync.sh` whenever hooks, templates or `.claude/` files change; `docs/user` edits must pass `npm run build` (`validate-docs.mjs`, `build-command-docs`).
- Stage specific paths only (never `git add -A`; `demo.cast` is untracked). Commit messages follow `file-formats` §8 and end with the `Co-Authored-By` trailer given in the session context; add the `Specplane-Agent` and `Specplane-Session` trailers when those variables are set.
- Record gaps in the step handoff (`plan step-done`), not in code comments.
