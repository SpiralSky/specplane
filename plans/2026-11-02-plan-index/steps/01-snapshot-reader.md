---
plan: 2026-11-02-plan-index
step: 1
title: "Capture head, staged and working plan snapshots"
status: done
context:
  - spec: "architecture/reference-cli#Snapshot selection and transactional generation"
---

## Goal

Capture head, staged and working plan snapshots

## Acceptance criteria

- [ ] Each snapshot resolves its own config and plan inventory; detached/unborn HEAD and staged additions/deletions behave as specified.
- [ ] Working includes tracked ignored files and non-ignored new plans; unresolved inputs and changed discovery/index bytes refuse safely.

## Tasks

1. Implement the behavior stated in the goal using the listed contracts.
2. Add focused regression tests for each acceptance criterion, including its refusal and preservation cases.
3. Run the reviewed procedure and record commands, outcomes and limitations through the plan-step workflow.

## Guidance

Use the managed checkout after CLI start. Before preparation, bind each criterion to concrete suite IDs and a supported reporter (Node TAP v13 or JUnit XML on stdout); missing mappings remain uncertain until resolved. Test files are committed implementation. Manual CLI execution records observed results without claiming core receipts. Preserve body/status independence and unrelated edits.
