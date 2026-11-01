---
plan: 2026-11-01-core-foundation
step: 4
title: "Delegation and cancellation"
status: pending
context:
  - spec: "architecture/reference-cli#Shared conductor and extension boundary"
  - spec: "architecture/reference-cli#Writer coordination"
---

## Goal

Implement worker generation/token delegation, stop acknowledgment and recovery on the lease primitive.

## Acceptance criteria

- [ ] Dead parent/live worker cannot be reclaimed; stale tokens cannot record.
- [ ] Cancellation retains edits; uncertain stop requires recovery; delegated operations do not recursively lock.

## Tasks

1. Implement worker generation/token delegation, stop acknowledgment and recovery on the lease primitive.
2. Verify each acceptance criterion with the applicable automated checks or required host evidence.
3. Record results, limitations and any specification gaps through the plan-step workflow.

## Guidance

Complete step 3 before this step.

Follow the architecture before feature details. Record missing or contradictory requirements in `spec-gaps.md` and resolve them before dependent implementation. Execute only in this plan’s designated checkout; let the workflow record progress.
