---
plan: 2026-10-29-claude-plugin-hardening
step: 1
title: Rejection guards for gating hooks
status: pending
context:
  - spec: claude:architecture/claude-integration#Specplane mode
  - spec: claude:architecture/claude-integration#Testing
  - file: harnesses/claude/plugin/hooks/register.tsx
  - file: harnesses/claude/plugin/plugin.test.tsx
---

## Goal

Make every gating hook in the plugin safe against rejected promises.

## Acceptance criteria

- [ ] Each gating hook (the `step`-mode edit denials and similar) returns a result even when its internal promise rejects; the failure mode is allow plus a logged message, matching the shell hooks' fail-open rule.
- [ ] No unhandled rejection is possible from the registered handlers.
- [ ] Tests inject a rejecting dependency and assert allow plus log.
- [ ] Whatever `validate` reports about the guards is clean.

## Tasks

1. Find the async handlers via `register` and wrap them with a shared helper.
2. Add tests.

## Guidance

- Do not change which calls are denied; only failure handling.
