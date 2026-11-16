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
4. Rebuild the plugin and run `harnesses/claude/tests/check-sync.sh`.
