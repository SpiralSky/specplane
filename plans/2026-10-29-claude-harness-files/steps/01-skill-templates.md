---
plan: 2026-10-29-claude-harness-files
step: 1
title: Skill templates
status: pending
use_subagent: true
context:
  - spec: claude:architecture/claude-integration#Skill file format
  - spec: claude:architecture/claude-integration#Subagent step execution
  - spec: claude:architecture/claude-integration#Template source
  - spec: architecture/agent-skills
  - spec: claude:feature/claude-integration
  - spec: feature/spec-precedence
  - spec: architecture/file-formats#HANDOFF.md
---

## Goal

Write the six skill templates under `harnesses/claude/templates/skills/<name>/SKILL.md`.

## Acceptance criteria

- [ ] Six files exist: `spec-assist`, `spec-draft-architecture`, `plan-create`, `plan-step`, `plan-finish`, `validate`.
- [ ] Each has frontmatter `name`, `description`, and the `argument-hint` / `disable-model-invocation` values from the per-skill table (omit `argument-hint` for `validate`).
- [ ] Each body has, in order: H1 title, purpose paragraph, `## Preconditions` (the shared preamble), `## Policy check` (write "None." where the contract has none), `## Steps`, `## Output`.
- [ ] Steps restate every step of the matching `architecture/agent-skills` contract in the same order, adding only Claude Code detail from the per-skill table; no hardcoded spec/plan paths except as config-default examples.
- [ ] `plan-step` includes: session-mode detection (§ Session mode) stated at the start of its output; the `use_subagent: true` branch with the exact Agent call shape from § Subagent step execution (fresh `general-purpose` subagent, paths not contents, unattended); `$ARGUMENTS` handling for `[plan-id] [--unattended]`.
- [ ] `spec-assist` refuses to produce a feature spec body under `llm_role: assist` (feature scenario 4).

## Tasks

1. Read the context items. Write the shared `## Preconditions` text once and reuse it verbatim in all six skills.
2. Write each SKILL.md.
3. Self-review each file against its contract in `architecture/agent-skills`, step by step.

## Guidance

- Keep each skill concise (aim for under ~80 lines); it is a procedure, not documentation.
- `description` must say when to use the skill, e.g. "Execute the next step of a Specplane plan. Use when the user runs /plan-step."
- The commit message format in `plan-step` is `plan/<id> step NN: <slug>` followed by a blank line and a bullet summary.
