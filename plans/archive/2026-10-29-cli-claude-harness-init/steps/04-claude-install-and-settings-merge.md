---
plan: 2026-10-29-cli-claude-harness-init
step: 4
title: Claude installer and settings merge
status: done
context:
  - spec: claude:architecture/claude-integration#Files produced
  - spec: claude:architecture/claude-integration#Settings merge
  - spec: claude:architecture/claude-integration#`specplane init` output for Claude Code
  - spec: claude:feature/claude-integration#Standing instructions
  - spec: feature/agent-integration
  - file: packages/cli/src/harness/claude.ts
  - file: harnesses/claude/templates/
---

## Goal

Install the Claude files and merge the settings registration.

## Acceptance criteria

- [x] All template files are created, or overwritten when different, with one `Created`/`Updated`/`Skipped` line each; hook scripts are mode 0755; `CLAUDE.md` is never read or written.
- [x] Settings merge covers: absent file, invalid JSON (report and skip, no clobbering), already registered (no duplicates), partial registration, existing `statusLine` (kept).
- [x] The AGENTS.md block uses the Claude Workflows line; the final line "Claude Code integration files written to `.claude/`." is printed.
- [x] Tests cover each merge case and idempotence.

## Tasks

1. Implement `install` and the merge.
2. Wire the harness Workflows line into `agents/standing.ts`.
3. Write the tests.

## Guidance

- Never touch `.claude/settings.local.json`.
