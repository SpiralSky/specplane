---
plan: 2026-11-01-workflow-recording
step: 2
title: "Execution receipts"
status: done
context:
  - spec: "architecture/reference-cli#Structured reasoning boundary"
  - spec: "architecture/reference-cli#Structured reasoning boundary"
---

## Goal

Implement execution ledger, output capture, supported reporters and receipt validation.

## Acceptance criteria

- [ ] Successful expected suites validate; failed/skipped-only/missing child suites do not.
- [ ] Changed input, output, receipt or request identity invalidates evidence; tests count actual reporter cases.

- [ ] executeWorkflowTest retains the active lease, launches through the host permission port, and captures stdout reporters in the private ledger.
- [ ] Permission refusal, cancellation, nonzero exit, skipped child, missing suites, stale/forged receipts and concurrent execution cannot establish passing criteria.

## Tasks

1. Implement execution ledger, output capture, supported reporters and receipt validation.
2. Verify each acceptance criterion with the applicable automated checks or required host evidence.
3. Record results, limitations and any specification gaps through the plan-step workflow.

Additional tasks for the settled contracts:

- Exercise prepare → edit → execute → validate under real child-process fixtures; remove inherited NODE_TEST_CONTEXT.

## Guidance

Complete step 1 before this step.

Follow the architecture before feature details. Record missing or contradictory requirements in `spec-gaps.md` and resolve them before dependent implementation. Execute only in this plan’s designated checkout; let the workflow record progress.
