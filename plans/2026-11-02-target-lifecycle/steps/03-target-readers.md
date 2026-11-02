---
plan: 2026-11-02-target-lifecycle
step: 3
title: "Use target context in plan discovery and reports"
status: pending
context:
  - spec: "architecture/reference-cli#Plan status (`plan/status.ts`)"
  - spec: "architecture/reference-cli#Plan activity (`plan list --json`)"
---

## Goal

Use target context in plan discovery and reports

## Acceptance criteria

- [ ] List/show/live discovery report target, starting commit, comparison base and pending retarget state consistently.
- [ ] Missing/offline refs and manually declared done without integration are distinguished.

## Tasks

1. Implement the behavior stated in the goal using the listed contracts.
2. Add focused regression tests for each acceptance criterion, including its refusal and preservation cases.
3. Run the reviewed procedure and record commands, outcomes and limitations through the plan-step workflow.

## Guidance

Complete earlier steps first. Use the managed checkout after CLI start. Before preparation, bind each criterion to concrete suite IDs and a supported reporter (Node TAP v13 or JUnit XML on stdout); missing mappings remain uncertain until resolved. Test files are committed implementation. Manual CLI execution records observed results without claiming core receipts. Preserve body/status independence and unrelated edits.
