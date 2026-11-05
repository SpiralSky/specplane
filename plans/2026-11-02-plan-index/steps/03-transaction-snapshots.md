---
plan: 2026-11-02-plan-index
step: 3
title: "Integrate prospective lifecycle and recovery snapshots"
status: done
context:
  - spec: "architecture/reference-cli#Snapshot selection and transactional generation"
---

## Goal

Integrate prospective lifecycle and recovery snapshots

## Acceptance criteria

- [ ] Approval/shelve/resume commit new metadata and its matching index together; post-commit regeneration is byte-identical.
- [ ] Resolved staged merge/rebase/cherry-pick inputs appear in recovery rendering; unmerged plan/config inputs refuse while output-only conflict is allowed.

## Tasks

1. Implement the behavior stated in the goal using the listed contracts.
2. Add focused regression tests for each acceptance criterion, including its refusal and preservation cases.
3. Run the reviewed procedure and record commands, outcomes and limitations through the plan-step workflow.

## Guidance

Complete earlier steps first. Use the managed checkout after CLI start. Before preparation, bind each criterion to concrete suite IDs and a supported reporter (Node TAP v13 or JUnit XML on stdout); missing mappings remain uncertain until resolved. Test files are committed implementation. Manual CLI execution records observed results without claiming core receipts. Preserve body/status independence and unrelated edits.
