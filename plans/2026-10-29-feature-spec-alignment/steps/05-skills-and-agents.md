---
plan: 2026-10-29-feature-spec-alignment
step: 5
title: Skills and standing instructions record spec-gaps.md entries
status: done
context:
  - spec: architecture/agent-skills
  - spec: claude:architecture/claude-integration
  - spec: claude:feature/claude-integration
  - spec: feature/spec-precedence#Spec gaps record
  - spec: "feature/spec-precedence#Rule 6: Cases neither spec covers"
  - file: harnesses/claude/templates/
  - file: packages/cli/src/agents/standing.ts
---

## Goal

Make every workflow record gaps, assumptions, and proposals in `spec-gaps.md`, and list the entry IDs in HANDOFF.

## Acceptance criteria

- [x] `architecture/agent-skills` `plan-step` and `plan-finish` contracts describe writing and listing `spec-gaps.md` entries; `proposal` entries replace `feature-spec-proposals.md`.
- [x] `claude:architecture/claude-integration` matches; the Claude templates and the standing instructions (`.claude/rules/specplane.md`, the `AGENTS.md` block) follow.
- [x] Skill contract markers re-pinned; `.claude/` synced; `check-sync.sh` and `hooks.test.sh` pass.
- [x] `npm test` and `specplane validate` pass.

## Tasks

1. Edit the two architecture specs; re-pin (one commit per level).
2. Update the templates and `agents/standing.ts`; copy to `.claude/`.
3. Run the harness tests.

## Guidance

- Edit `harnesses/claude/templates/`, then copy to `.claude/`; never edit `.claude/` first.
