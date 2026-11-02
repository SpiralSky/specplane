---
plan: 2026-11-02-plan-index
step: 2
title: "Deliver plan index and deterministic rendering"
status: pending
context:
  - spec: "architecture/reference-cli#PLANS.md generation (`generate/plans-md.ts`)"
  - spec: "architecture/ci"
---

## Goal

Deliver plan index and deterministic rendering

## Acceptance criteria

- [ ] Default head rendering is deterministic with the Target column; --live requires --print and print writes nothing.
- [ ] Old generate command refuses with migration guidance; CI targets the selected branch and uses head; unchanged output is not rewritten.

## Tasks

1. Implement the behavior stated in the goal using the listed contracts.
2. Add focused regression tests for each acceptance criterion, including its refusal and preservation cases.
3. Run the reviewed procedure and record commands, outcomes and limitations through the plan-step workflow.

## Guidance

Complete earlier steps first. Use the managed checkout after CLI start. Before preparation, bind each criterion to concrete suite IDs and a supported reporter (Node TAP v13 or JUnit XML on stdout); missing mappings remain uncertain until resolved. Test files are committed implementation. Manual CLI execution records observed results without claiming core receipts. Preserve body/status independence and unrelated edits.
