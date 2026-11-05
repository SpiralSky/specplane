---
plan: 2026-11-02-target-lifecycle
step: 6
title: "Reconcile shelving, resume and integration-checked cleanup"
status: done
context:
  - spec: "architecture/reference-cli#Shelve and resume"
  - spec: "architecture/reference-cli#Cleanup, abandon, archive"
---

## Goal

Reconcile shelving, resume and integration-checked cleanup

## Acceptance criteria

- [ ] Shelving preserves checkout/branch/history and blocks execution until explicit resume.
- [ ] Automated worktree/branch removal requires independent integration evidence; a manual done edit alone never permits cleanup.

## Tasks

1. Implement the behavior stated in the goal using the listed contracts.
2. Add focused regression tests for each acceptance criterion, including its refusal and preservation cases.
3. Run the reviewed procedure and record commands, outcomes and limitations through the plan-step workflow.

## Guidance

Complete earlier steps first. Use the managed checkout after CLI start. Before preparation, bind each criterion to concrete suite IDs and a supported reporter (Node TAP v13 or JUnit XML on stdout); missing mappings remain uncertain until resolved. Test files are committed implementation. Manual CLI execution records observed results without claiming core receipts. Preserve body/status independence and unrelated edits.
