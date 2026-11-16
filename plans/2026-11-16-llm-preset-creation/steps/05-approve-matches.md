---
plan: 2026-11-16-llm-preset-creation
step: 5
title: R70 typed approve lists matches for an inexact name
---
## Goal

Make the typed approve command (CLI `approve`, harness `/approve`) approve nothing and list the closest IDs when a name is not an exact ID. Spec: `feature/harness` R70 and `architecture/agent-skills` "Required permissions" bullet (last sentence). Code: the approve command in `packages/cli/src/commands` (find where `Specification \`X\` not found. Known IDs:` is produced), and the Claude plugin command table in `harnesses/claude/plugin/hooks/commands.ts` (approve entry, `modelWithArgs: false`).

## Acceptance criteria

- An exact ID approves as before under the user's permissions with no model turn.
- A name that is not an exact ID approves nothing, starts no model turn, and lists up to ten best matches grouped by specification, plan and decision, matched case-insensitively on words in IDs and titles; a name that matches nothing says so.
- Tests cover exact, inexact, no match and multi-word names (`preset creation`).

## Tasks

1. Add a mechanical matcher over the specification, plan and decision indexes.
2. Replace the "not found. Known IDs" failure with the match listing for the typed command; keep the failure for the LLM action, which resolves IDs itself.
3. Write the tests and update `docs/user/commands.md`.
