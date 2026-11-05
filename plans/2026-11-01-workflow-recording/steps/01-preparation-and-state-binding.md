---
plan: 2026-11-01-workflow-recording
step: 1
title: "Preparation and state binding"
status: done
context:
  - spec: "architecture/reference-cli#Structured reasoning boundary"
  - spec: "architecture/agent-skills#plan-step"
  - file: "packages/cli/src/plan/next.ts"
---

## Goal

Prepare plan and non-plan workflow envelopes with compatibility/policy checks, resolved scope, expected suites and snapshots.

## Acceptance criteria

- [ ] Remote plan fast-forward precedes snapshot; divergence refuses.
- [ ] Dirty baseline, changed policy/criteria and wrong checkout are handled according to the settled contract; missing schema details become gaps before dependent code.

- [ ] Preparation binds target context and reviewed suite/report mappings; absent mappings remain uncertain.

## Tasks

1. Prepare plan and non-plan workflow envelopes with compatibility/policy checks, resolved scope, expected suites and snapshots.
2. Verify each acceptance criterion with the applicable automated checks or required host evidence.
3. Record results, limitations and any specification gaps through the plan-step workflow.

Additional tasks for the settled contracts:

- Resolve target state using target-lifecycle outputs before taking preparation snapshots.

## Guidance

Follow the architecture before feature details. Record missing or contradictory requirements in `spec-gaps.md` and resolve them before dependent implementation. Execute only in this plan’s designated checkout; let the workflow record progress.
