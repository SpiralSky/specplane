---
plan: 2026-10-29-assist-and-approve
step: 5
title: Claude skills, policy guard, and .claude sync
status: pending
context:
  - spec: claude:feature/claude-integration
  - spec: claude:architecture/claude-integration
  - spec: architecture/agent-skills
  - spec: "feature/spec-policies#Refine-then-write (`llm_role: assist`)"
  - file: harnesses/claude/templates/
  - file: harnesses/claude/tests/hooks.test.sh
  - file: harnesses/claude/tests/check-sync.sh
  - file: packages/cli/src/harness/
---

## Goal

Expose the new roles and commands in Claude Code: the reworked `/spec-assist`, five new slash commands, and a guard that keeps approval with the user.

## Acceptance criteria

- [ ] `/spec-assist` runs Describe → Refine → Finalise → Write under `assist` (writes only after approval, `author: mixed`, status unchanged) and review-only under `review`; `/spec-draft-architecture` follows the same split.
- [ ] New skills `approve` (`disable-model-invocation: true`, supports `--reopen`), `plan-start`, `decision-new`, `plan-status`, `plan-abandon`, each with a contract marker.
- [ ] The guard hook asks under `review` and `assist`, and denies agent edits that set `status: approved`, `ready`, or `accepted`; `hooks.test.sh` covers both.
- [ ] `specplane init --harness claude` installs the new skills; the templates are copied to `.claude/`; `check-sync.sh` and `hooks.test.sh` pass.
- [ ] Contract markers re-pinned; `specplane validate` has 0 errors.

## Tasks

1. Edit and add the skill templates; update the guard hook and its tests.
2. Register the new skills in the harness installer; copy to `.claude/`; run both harness tests.
