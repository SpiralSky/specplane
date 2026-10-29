---
plan: 2026-10-29-claude-plugin-hardening
step: 2
title: Read HANDOFF in claude -p
status: done
context:
  - spec: claude:architecture/claude-integration#Plans pane
  - spec: claude:feature/claude-integration#Live view and Specplane mode (optional)
  - file: harnesses/claude/plugin/hooks/register.tsx
  - file: harnesses/claude/plugin/plugin.test.tsx
---

## Goal

Make the "Read HANDOFF" button not a no-op when the session is `claude -p`.

## Acceptance criteria

- [x] When the plugin detects a non-interactive session (prompt fill unavailable or ineffective), the button is replaced by the HANDOFF path as plain text or copies the path.
- [x] In interactive sessions the button still fills the prompt with `Read <path>`.
- [x] If the architecture's Plans pane text must change to describe this, the change is made as a spec edit (architecture spec, approved status kept) and pins refreshed.
- [x] Tests cover both modes.

## Tasks

1. Detect capability at run time and test with a stubbed `$.prompt`.
2. Make the spec edit if needed.

## Guidance

- Spec edits on a plan branch keep `approved`; refresh pins with `specplane spec pin`.
