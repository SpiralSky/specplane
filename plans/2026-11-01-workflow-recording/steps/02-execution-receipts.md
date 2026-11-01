---
plan: 2026-11-01-workflow-recording
step: 2
title: "Execution receipts"
status: pending
context:
  - spec: "architecture/reference-cli#Structured reasoning boundary"
---

## Goal

Implement execution ledger, output capture, supported reporters and receipt validation.

## Acceptance criteria

- [ ] Successful expected suites validate; failed/skipped-only/missing child suites do not.
- [ ] Changed input, output, receipt or request identity invalidates evidence; tests count actual reporter cases.

## Tasks

1. Implement execution ledger, output capture, supported reporters and receipt validation.
2. Verify each acceptance criterion with the applicable automated checks or required host evidence.
3. Record results, limitations and any specification gaps through the plan-step workflow.

## Guidance

Complete step 1 before this step.

Follow the architecture before feature details. Record missing or contradictory requirements in `spec-gaps.md` and resolve them before dependent implementation. Execute only in this plan’s designated checkout; let the workflow record progress.
