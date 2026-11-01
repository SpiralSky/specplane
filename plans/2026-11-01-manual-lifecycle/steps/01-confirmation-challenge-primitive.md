---
plan: 2026-11-01-manual-lifecycle
step: 1
title: "Confirmation challenge primitive"
status: pending
context:
  - spec: "architecture/reference-cli#Revision-bound human confirmation"
---

## Goal

Implement direct interaction port, one-use challenges, payload/state/evidence binding and expiry.

## Acceptance criteria

- [ ] Model tool input cannot consume a human response port.
- [ ] Decline, timeout, replay and changed bytes refuse without mutation.

## Tasks

1. Implement direct interaction port, one-use challenges, payload/state/evidence binding and expiry.
2. Verify each acceptance criterion with the applicable automated checks or required host evidence.
3. Record results, limitations and any specification gaps through the plan-step workflow.

## Guidance

Follow the architecture before feature details. Record missing or contradictory requirements in `spec-gaps.md` and resolve them before dependent implementation. Execute only in this plan’s designated checkout; let the workflow record progress.
