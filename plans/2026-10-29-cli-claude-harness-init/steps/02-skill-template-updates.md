---
plan: 2026-10-29-cli-claude-harness-init
step: 2
title: Update skill templates and dogfood copies
status: pending
context:
  - spec: architecture/agent-skills#Keeping skills in sync with specs
  - spec: claude:architecture/claude-integration#Skill file format
  - spec: claude:architecture/claude-integration#Testing
  - file: harnesses/claude/templates/skills/
  - file: .claude/skills/
  - file: harnesses/claude/tests/check-sync.sh
---

## Goal

Update the skill templates, the dogfood `.claude/` copies, and check-sync to match the edited specs.

## Acceptance criteria

- [ ] Each template reflects the amended contract: `plan-finish` and `validate` have `## Policy check`; the self-check, ordering check, and fallback are present where specified; the `plan-step` subagent flow leaves the push to the parent.
- [ ] `.claude/skills/*` are byte-identical copies; `sh harnesses/claude/tests/check-sync.sh` and `sh harnesses/claude/tests/hooks.test.sh` pass.
- [ ] The `specplane-contract` marker of every changed skill carries the new blob; no `skill-drift` warnings remain.
- [ ] The check-sync comments describe the settings comparison as a subset.

## Tasks

1. Edit templates, copy them to `.claude/`, run the sync check.
2. Refresh the markers with `specplane spec pin`.

## Guidance

- Edit templates, never only the dogfood copies (repo `CLAUDE.md` convention).
