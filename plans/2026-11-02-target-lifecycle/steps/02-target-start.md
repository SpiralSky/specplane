---
plan: 2026-11-02-target-lifecycle
step: 2
title: "Create and resume plans against their recorded target"
status: pending
context:
  - spec: "architecture/reference-cli#Start"
  - spec: "architecture/reference-cli#plan new"
---

## Goal

Create and resume plans against their recorded target

## Acceptance criteria

- [ ] First start validates target-local plans/specs/dependencies and records immutable provenance before execution.
- [ ] Dirty reused worktrees skip setup and survive failure; missing checkout recreation preserves branch and step commits.

## Tasks

1. Implement the behavior stated in the goal using the listed contracts.
2. Add focused regression tests for each acceptance criterion, including its refusal and preservation cases.
3. Run the reviewed procedure and record commands, outcomes and limitations through the plan-step workflow.

## Guidance

Complete earlier steps first. Use the managed checkout after CLI start. Before preparation, bind each criterion to concrete suite IDs and a supported reporter (Node TAP v13 or JUnit XML on stdout); missing mappings remain uncertain until resolved. Test files are committed implementation. Manual CLI execution records observed results without claiming core receipts. Preserve body/status independence and unrelated edits.
