---
plan: 2026-11-16-llm-preset-creation
step: 6
title: R71 Requires lines in the contracts
---
## Goal

Give the contracts that cannot do anything without a fixed permission a `Requires:` line and a matching "must not be deny" sentence, and a test that keeps them equal. Spec: `architecture/agent-skills` "Required permissions". Contracts: `harnesses/claude/templates/skills/specplane-*/SKILL.md` and `harnesses/codex/templates/contracts/*.md`. Lines: plan-create `plan.create`, plan-abandon `plan.abandon`, plan-finish `plan.complete`, validate, verify and spec-review `info.retrieve`. No line for spec-assist, spec-draft-architecture, decision-new, plan-step, migrate, plan-start, plan-status, approve and spec-view.

## Acceptance criteria

- Each listed contract has the `Requires:` line and the sentence in both harness template folders; the others have none.
- A test fails when a contract's "must not be deny" sentence and its `Requires:` line differ, and `harnesses/claude/tests/check-sync.sh` passes.

## Tasks

1. Add the lines and any missing sentences (spec-review, plan-finish and verify currently lack the sentence).
2. Add the consistency test in `packages/cli/src/harness`.
3. Run `check-sync.sh`.
