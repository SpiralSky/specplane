---
plan: 2026-10-30-plan-primitives
step: 5
title: "Harness docs — operations table, model invocation, manual finish"
status: done
context:
  - spec: architecture/agent-skills#Standing instructions
  - spec: architecture/agent-skills#plan-finish
  - spec: claude:architecture/claude-integration#Skill file format
  - spec: claude:architecture/claude-integration#Standing instructions (`.claude/rules/specplane.md`)
  - spec: claude:feature/claude-integration#Slash commands
  - file: AGENTS.md
  - file: harnesses/claude/templates/skills/plan-finish/SKILL.md
---

## Goal

Close the discoverability gaps. Three questions are currently answered only by omission: which
operations have a slash command and which are CLI-only; when a skill may run without being typed;
and what to do when the CLI is missing during `plan finish`. Answer all three in the specs and in the
project instructions, then implement the one behaviour change (`/plan-finish` manual mode).

## Acceptance criteria

- [x] `architecture/agent-skills` has an operations table: every CLI operation → skill, CLI-only, or
      not user-facing, with a one-line reason. It lists `plan next`, `plan step-done`, `plan restack`,
      `plan cleanup`, `plan archive`, `spec new`, `spec pin`, `generate`, `search`.
- [x] `claude:architecture/claude-integration` states the `disable-model-invocation` rule next to the
      existing table: `false` only for read-only/analysis skills; `true` for anything that writes,
      commits, merges, or spends quota. `spec-assist`, `plan-status`, `validate` stay `false`.
- [x] The project instructions carry a routing table outside the managed `specplane:begin/end` block:
      "user asks to start/step/finish/status a plan → run `specplane plan <op>`; do not hand-edit plan
      files". This makes natural-language requests work even though the skills stay non-invocable.
- [x] `/plan-finish` without the CLI prints the manual local-merge sequence (tests → rebase → archive
      → merge → delete branch/worktree) with the exact git commands and the `Specplane-Workflow:
      finish` trailer shape, labelled "manual mode: no stale-base or divergence checks", instead of
      stopping. `pull_request` merges print the push + open-PR variant.
- [x] `plan status` output names the `specplane plan restack <id>` command when a stacked base merged.
- [x] `specplane validate` and `npm test` pass; contract pins re-pinned; skill drift check is clean.

## Tasks

1. Add the operations table to `architecture/agent-skills` (new subsection under `## Contract
   structure`) and the restack pointer to `plan-status`'s section there.
2. Add the `disable-model-invocation` rule to `claude:architecture/claude-integration` § Skill file
   format, immediately after the existing table.
3. Update the per-skill table row for `plan-finish` (manual mode) in the same section and in
   `claude:feature/claude-integration` § Slash commands.
4. Implement the manual sequence in `plan-finish/SKILL.md` (it is prose plus `Bash` calls; the skill
   already degrades for other operations), reusing the finish flow's step order.
5. Edit `AGENTS.md` outside the managed block to add the routing table; keep the managed block
   untouched and re-run `specplane init --harness claude --force` mentally against the diff to confirm
   it remains idempotent.
6. Re-pin skill contracts (`specplane spec pin`) and run `specplane validate` to confirm no drift.

## Guidance

- Do not add `/plan-restack`, `/plan-cleanup`, or similar skills in this step. The table is the
  deliverable; a new skill duplicates the CLI and costs context in every session.
- The routing table must name the CLI, not the skill: `disable-model-invocation: true` hides the skill
  from the model but not the CLI from `Bash`.
- Manual finish is a second implementation of a stateful flow. Keep it to the two merge modes, state
  the missing checks in one line, and record the decision in `spec-gaps.md` if the spec's wording
  cannot absorb it.
