---
plan: 2026-11-16-llm-preset-creation
step: 4
title: Show the preview and update the docs
---
## Goal

Show the preview wherever a request is shown: `requests show`, the Claude `/requests` pane (`harnesses/claude/plugin/hooks/commands.ts`) and the arrival dialogue (`harnesses/claude/plugin/hooks/channel.ts`). Update `docs/user/permissions.md`, `docs/user/harnesses.md` and the steering so the LLM sends a permission or preset request when an action is denied and it needs it.

## Acceptance criteria

- `requests show <id>` for a preset request prints the preview, with the more-permissive modes marked.
- The pane and the arrival dialogue show the same preview text.
- The steering names `preset.create` and says activation is a separate request.

## Tasks

1. Render the stored preview in `requests show`. The pane and the arrival dialogue read what `requests show --json` returns and print the `diff` field verbatim; they do not rebuild the preview.
2. Show it in the Claude pane and dialogue, reusing the same text.
3. Edit the docs and steering text.
4. Fix the stale sentences in `docs/user/permissions.md` (the preset list sentence in the LLM permissions section and the sentence saying an LLM cannot manage presets and a request cannot stand in for it) and `docs/user/commands.md` (the `preset create` text that says the LLM role may not) that say an LLM cannot manage presets or that a request cannot stand in for it: carve out creation, and add a `preset.create` entry.
5. Make the activation request (`config set permissions.preset <custom>`) show the same preview in its `diff`.
6. Rebuild the plugin and run `harnesses/claude/tests/check-sync.sh`.

## Worker conventions (every step)

- Work only in this plan's worktree. Run `npx tsc --noEmit -p .` in `packages/cli` before every `npm run build`, then `npm test` (it builds first). Run `sh harnesses/claude/tests/hooks.test.sh` and `sh harnesses/claude/tests/check-sync.sh` whenever hooks, templates or `.claude/` files change; `docs/user` edits must pass `npm run build` (`validate-docs.mjs`, `build-command-docs`).
- Stage specific paths only (never `git add -A`; `demo.cast` is untracked). Commit messages follow `file-formats` §8 and end with the `Co-Authored-By` trailer given in the session context; add the `Specplane-Agent` and `Specplane-Session` trailers when those variables are set.
- Record gaps in the step handoff (`plan step-done`), not in code comments.
