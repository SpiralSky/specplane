---
plan: 2026-11-02-target-lifecycle
step: 4
title: "Use recorded destinations for finish and restack"
status: done
context:
  - spec: "architecture/reference-cli#Finish"
  - spec: "architecture/reference-cli#Restack"
---

## Goal

Use recorded destinations for finish and restack

## Acceptance criteria

- [ ] Rebase, PR base and local merge use the recorded destination; ambiguous legacy provenance refuses.
- [ ] Target changes or rebase invalidate prior acceptance; cross-target stacks refuse; failed operations preserve recoverable state.

## Tasks

1. Implement the behavior stated in the goal using the listed contracts.
2. Add focused regression tests for each acceptance criterion, including its refusal and preservation cases.
3. Run the reviewed procedure and record commands, outcomes and limitations through the plan-step workflow.

## Guidance

Complete earlier steps first. Use the managed checkout after CLI start. Before preparation, bind each criterion to concrete suite IDs and a supported reporter (Node TAP v13 or JUnit XML on stdout); missing mappings remain uncertain until resolved. Test files are committed implementation. Manual CLI execution records observed results without claiming core receipts. Preserve body/status independence and unrelated edits.
