---
plan: 2026-10-29-cli-claude-harness-init
step: 1
title: Architecture spec edits for agent skills, Claude harness, registry
status: pending
context:
  - spec: architecture/agent-skills#`plan-finish`
  - spec: architecture/agent-skills#`validate`
  - spec: architecture/agent-skills#`plan-step`
  - spec: architecture/agent-skills#`spec-draft-architecture`
  - spec: architecture/agent-skills#Keeping skills in sync with specs
  - spec: claude:architecture/claude-integration#Subagent step execution
  - spec: claude:architecture/claude-integration#Testing
  - spec: claude:architecture/claude-integration#`specplane init` output for Claude Code
  - spec: architecture/reference-cli#Standing instructions (`agents/standing.ts`)
  - spec: architecture/reference-cli#Module structure
  - file: docs/specifications/architecture/agent-skills.md
  - file: harnesses/claude/specifications/architecture/claude-integration.md
  - file: docs/specifications/architecture/reference-cli.md
---

## Goal

Resolve the deferred agent-skills, claude-architecture, and harness-registry review findings as architecture edits.

## Acceptance criteria

- [ ] `architecture/agent-skills`: an agent-side leak self-check (agents checking their own drafts), an ordering check, and a CLI-unavailable fallback are specified for the relevant skills; `plan-finish` and `validate` each gain a `Policy check` section.
- [ ] `claude:architecture/claude-integration`: in § Subagent step execution the parent, not the subagent, performs the push step; § Testing describes the `settings.json` comparison in check-sync as a subset comparison, not byte-identical.
- [ ] `architecture/reference-cli`: `src/harness/` is in the module structure; the harness registry contract names how skill directories are registered (`skillDirs`) and how freshness of the rules file is checked (byte-compare with the bundled template, warning type `freshness`).
- [ ] Pins and skill contract markers are refreshed; validation passes (skill-drift warnings are expected until step 02).

## Tasks

1. Edit the three specs.
2. Re-pin dependents.
3. Run validate and list expected `skill-drift` warnings in HANDOFF for step 02.

## Guidance

- Spec edits on a plan branch keep their `approved` status (`feature/plan-status`); do not change `status:`. Do not edit feature specs: they have `llm_role: assist`.
- After editing an approved base spec, run `specplane spec pin` for dependent overlay specs and skill contract comments that pin it (see `feature/spec-overlays` § Base pins), then `specplane spec pin --check`.
- Skill contract markers will go stale for the skills whose contracts changed: step 02 updates them.
