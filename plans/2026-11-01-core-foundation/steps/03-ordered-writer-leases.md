---
plan: 2026-11-01-core-foundation
step: 3
title: "Ordered writer leases"
status: done
context:
  - spec: "architecture/reference-cli#Writer coordination"
  - file: "packages/cli/src/plan/gate.ts"
---

## Goal

Implement canonical repository/checkout/plan lock identities and ordered acquisition as a reusable primitive.

## Acceptance criteria

- [ ] Alias paths share one checkout lock; competing non-plan and plan writers cannot overlap.
- [ ] Multi-checkout contention releases acquired subsets safely; malformed coordination data fails closed.

## Tasks

1. Implement canonical repository/checkout/plan lock identities and ordered acquisition as a reusable primitive.
2. Verify each acceptance criterion with the applicable automated checks or required host evidence.
3. Record results, limitations and any specification gaps through the plan-step workflow.

## Guidance

Complete step 2 before this step.

Follow the architecture before feature details. Record missing or contradictory requirements in `spec-gaps.md` and resolve them before dependent implementation. Execute only in this plan’s designated checkout; let the workflow record progress.
