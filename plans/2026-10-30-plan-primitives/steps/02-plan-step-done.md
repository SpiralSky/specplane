---
plan: 2026-10-30-plan-primitives
step: 2
title: "plan step-done — CLI owns the HANDOFF and commit formats"
status: pending
context:
  - spec: architecture/file-formats#HANDOFF.md
  - spec: architecture/file-formats#Step files
  - spec: architecture/agent-skills#plan-step
  - spec: architecture/reference-cli#Plan status
  - file: packages/cli/src/plan/flows.ts
  - file: packages/cli/src/commands/plan.ts
  - file: harnesses/claude/templates/skills/plan-step/SKILL.md
---

## Goal

Add `specplane plan step-done <id>` so the HANDOFF section and the step commit are produced by code,
not by prose. The `plan-step` skill keeps the reasoning (read context, do the work, judge the
outcome) and calls the CLI for the two mechanical writes.

## Acceptance criteria

- [ ] `plan step-done <id> --outcome done|blocked --summary <text> [--changed <path>:<reason>]…
      [--deviation <text>]… [--open-issue <text>]… [--next-knows <text>] [--step NN]` appends exactly
      one section matching `architecture/file-formats` §4.1, with every required subsection and the
      literal `None.` for empty ones.
- [ ] The commit uses §8: `<type>(<slug>): <summary>`, blank line, bullet list, blank line, then
      `Specplane-Workflow: step`, `Specplane-Plan`, `Specplane-Step`, `Specplane-Agent`,
      `Specplane-Session` (omitted when unset), `Co-Authored-By`.
- [ ] It refuses (non-zero, no writes) when: the step is already `done`; the step is `blocked` and
      `--outcome done` was passed; `--outcome blocked` has no `--open-issue` beginning with `BLOCKED:`;
      or `spec-gaps.md` has no entry for a `--gap` ID that was passed.
- [ ] The step frontmatter `status` and the new HANDOFF `**Outcome**` are written in the same
      operation, so they can never disagree in a commit.
- [ ] The `plan-step` skill instructs calling the CLI for steps 8–9 and drops its own format
      description to a pointer; without the CLI it still performs the writes by hand.
- [ ] `specplane validate`, `npm test`, and a skill-contract re-pin (`specplane spec pin`) pass.

## Tasks

1. Add `src/plan/step-done.ts`: build the §4.1 section text, append to `<plans.dir>/<id>/HANDOFF.md`,
   set the step's frontmatter status, stage the plan folder, and commit with the trailer block.
2. Register `plan step-done <id>` with the flags above; print the commit hash and the section path.
3. Implement the refusal matrix from the acceptance criteria as validation before any write; print
   the exact fix for each refusal.
4. Update `architecture/file-formats` §4.1/§8 only if the operation reveals an ambiguity (record it in
   `spec-gaps.md` otherwise).
5. Update `architecture/reference-cli` with the command contract and `architecture/agent-skills`
   `plan-step` steps 7–9 to delegate.
6. Update the Claude skill template and re-pin; add tests for each refusal and for the trailer order.

## Guidance

- `--changed` is repeatable; order is preserved as given (the bullet list is the author's ordering).
- Do not let the command push. `plan-step` step 10 stays with the agent (it knows whether the backend
  is `external`).
- Keep `--outcome skipped` working: "What changed" is `None.` and "Deviations" explains the skip.
- Fail loudly if `HANDOFF.md` has a later section for the same step than the one being appended (the
  append-only rule makes that state invalid).
