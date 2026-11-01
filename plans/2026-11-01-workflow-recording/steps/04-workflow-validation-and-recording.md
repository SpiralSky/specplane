---
plan: 2026-11-01-workflow-recording
step: 4
title: "Workflow validation and recording"
status: pending
context:
  - spec: "architecture/reference-cli#Structured reasoning boundary"
  - spec: "architecture/agent-skills#plan-step"
---

## Goal

Connect criterion/provenance validation to the shared recorder, proposal revalidation and recoverable receipts.

## Acceptance criteria

- [ ] Core alone writes status/HANDOFF; stale proposals and lost leases refuse.
- [ ] Matching retry returns existing commit; failed push retries publication without implementation or duplicate commit.
- [ ] Non-plan results cannot set lifecycle states or bypass creation operations.

## Tasks

1. Connect criterion/provenance validation to the shared recorder, proposal revalidation and recoverable receipts.
2. Verify each acceptance criterion with the applicable automated checks or required host evidence.
3. Record results, limitations and any specification gaps through the plan-step workflow.

## Guidance

Complete step 3 before this step.

Follow the architecture before feature details. Record missing or contradictory requirements in `spec-gaps.md` and resolve them before dependent implementation. Execute only in this plan’s designated checkout; let the workflow record progress.
