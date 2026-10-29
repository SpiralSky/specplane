---
plan: 2026-10-29-cli-plan-commands
step: 2
title: Feature-spec proposals for plan-status and plan-index
status: pending
context:
  - spec: feature/plan-status#Transition rules for stored statuses
  - spec: feature/plan-execution#Abandoning a plan
  - spec: feature/plan-status#Validation rules
  - spec: feature/plan-index#Acceptance scenarios
  - file: HANDOFF.md
---

## Goal

Record the plan-status and plan-index findings as written proposals.

## Acceptance criteria

- [ ] `plans/2026-10-29-cli-plan-commands/feature-spec-proposals.md` has a section per finding below.
- [ ] No feature spec file is modified.

## Tasks

1. Write `plans/2026-10-29-cli-plan-commands/feature-spec-proposals.md` (feature specs are `llm_role: assist`, so agents never edit them). One section per finding: target spec and anchor, the problem, proposed replacement text, and the reason. Proposals only; list the file in this step's HANDOFF 'What the next step must know' and 'Open issues' as 'needs user review'. Findings: (a) `feature/plan-status`: the abandon wording says "any non-terminal plan" without listing which stored statuses; propose the explicit list. (b) `feature/plan-status`: in `stack` mode, a `ready` plan with two or more unmerged dependencies is neither startable nor described; propose its effective status and message. (c) `feature/plan-index`: Scenario 5 mixes two behaviours (never hand-edited, and conflict handling); propose splitting it into two scenarios.

## Guidance

- Quote the current text in each proposal.
