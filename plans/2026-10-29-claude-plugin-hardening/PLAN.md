---
id: 2026-10-29-claude-plugin-hardening
title: Claude plugin hardening — hook guards and HANDOFF button
status: ready
specs:
  - claude:architecture/claude-integration
  - claude:feature/claude-integration
depends_on: []
---

# Claude plugin hardening — hook guards and HANDOFF button

## Goal

Fix the two open plugin items: add rejection handling to the plugin's gating hooks, and make the pane's "Read HANDOFF" button work (or degrade cleanly) in non-interactive `claude -p` sessions.

## Scope

- Rejection (`.catch`) guards on the async gating hooks in `harnesses/claude/plugin/hooks/register.tsx`.
- "Read HANDOFF" button behaviour in `claude -p`.
- Plugin tests for both.

## Non-goals

- New plugin features.
- Changing the data source or CLI.

## Specs implemented

| Spec | Coverage |
|------|----------|
| `claude:architecture/claude-integration` | Live view and Specplane mode |
| `claude:feature/claude-integration` | Live view and Specplane mode (optional) |

## Acceptance criteria

- [ ] Every promise-returning gating hook handler in the plugin handles rejection and fails open (allows the tool call) with a logged note; `specplane validate` no longer warns about missing `.catch` guards.
- [ ] In `claude -p` (no prompt buffer), the pane does not offer a dead button: it shows the HANDOFF path as text, or injects the read request in a way that works; interactive behaviour is unchanged.
- [ ] `claude plugin test` passes with the new cases.

## Risks

1. Plugin API behaviour in non-interactive sessions is not documented here: detect capability at run time rather than assuming.

## Steps

1. `catch-guards`: Add `.catch` handling to gating hooks.
2. `read-handoff-button`: Fix the pane button outside interactive mode.
