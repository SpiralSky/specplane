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

1. Render the stored preview in `requests show`.
2. Show it in the Claude pane and dialogue, reusing the same text.
3. Edit the docs and steering text.
4. Fix the stale sentences in `docs/user/permissions.md` (around lines 76 and 92) and `docs/user/commands.md` (around line 312) that say an LLM cannot manage presets or that a request cannot stand in for it: carve out creation, and add a `preset.create` entry.
5. Make the activation request (`config set permissions.preset <custom>`) show the same preview in its `diff`.
6. Rebuild the plugin and run `harnesses/claude/tests/check-sync.sh`.
