---
plan: 2026-10-29-cli-plan-flows
step: 2
title: Feature-spec proposals for tooling and plan-steps
status: pending
context:
  - spec: feature/tooling#`specplane plan`
  - spec: feature/plan-steps#Step grouping guidance
  - spec: feature/plan-steps#HANDOFF.md
  - spec: feature/plan-execution#Restacking
  - file: HANDOFF.md
---

## Goal

Record the feature findings assigned to this plan as proposals.

## Acceptance criteria

- [ ] The proposal file covers: (a) adding `specplane plan restack <id>` to `feature/tooling` (with exit codes and errors); (b) `feature/plan-steps`: what happens to the HANDOFF section when a `blocked` step is re-run (append a new section, latest wins; align with `architecture/file-formats` §4.1); (c) `feature/plan-steps` example step files use `src/...` paths, which trip the leak guard; propose neutral paths.
- [ ] No feature spec file is modified.

## Tasks

1. Write `plans/2026-10-29-cli-plan-flows/feature-spec-proposals.md` (feature specs are `llm_role: assist`, so agents never edit them). One section per finding: target spec and anchor, the problem, proposed replacement text, and the reason. Proposals only; list the file in this step's HANDOFF 'What the next step must know' and 'Open issues' as 'needs user review'.

## Guidance

- Quote the current text in each proposal.
