---
plan: 2026-10-29-cli-claude-harness-init
step: 5
title: Replace skillDirs stand-in; rules freshness check
status: pending
context:
  - spec: architecture/reference-cli#Skill contract drift (`spec/skill-drift.ts`)
  - spec: architecture/reference-cli#Standing instructions (`agents/standing.ts`)
  - spec: architecture/agent-skills#Keeping skills in sync with specs
  - spec: claude:architecture/claude-integration#Standing instructions (`.claude/rules/specplane.md`)
  - spec: architecture/file-formats#1.5 Pin, anchor, and skill-contract findings
  - file: packages/cli/src/spec/skill-drift.ts
  - file: packages/cli/src/agents/standing.ts
  - file: packages/cli/src/harness/
---

## Goal

Replace the stand-in `skillDirs()` with the registry and add the rules-file freshness check.

## Acceptance criteria

- [ ] `skill-drift` finds skills through registered harness `skillDirs` (installed harnesses and, in this repository, `harnesses/*/templates/skills/`), and the stand-in function is deleted.
- [ ] `validate` warns with type `freshness` when an installed harness's rules file is missing or differs from the bundled template, and not when it matches.
- [ ] Standing-instruction freshness accepts the block in `AGENTS.md` or a harness file registered by an installed harness.
- [ ] Tests cover both warnings and their absence.
- [ ] `specplane validate` on this repository shows neither warning.

## Tasks

1. Replace `skillDirs` and update callers.
2. Add the freshness check to the validate command.
3. Tests.

## Guidance

- Close the gap recorded in the core plan's HANDOFF (skill discovery).
