---
plan: 2026-11-02-product-docs
step: 1
title: "Build versioned documentation manifest and topic bundle"
status: pending
context:
  - spec: "architecture/reference-cli#Shared product documentation operations"
  - spec: "architecture/file-formats"
---

## Goal

Build versioned documentation manifest and topic bundle

## Acceptance criteria

- [ ] Manifest hashes, source bytes, unique topics and related links validate; minimum topics and release orientation are packaged.
- [ ] Command examples match delivered inventory; future designs are labelled rather than advertised as runtime capability.

## Tasks

1. Implement the behavior stated in the goal using the listed contracts.
2. Add focused regression tests for each acceptance criterion, including its refusal and preservation cases.
3. Run the reviewed procedure and record commands, outcomes and limitations through the plan-step workflow.

## Guidance

Use the managed checkout after CLI start. Before preparation, bind each criterion to concrete suite IDs and a supported reporter (Node TAP v13 or JUnit XML on stdout); missing mappings remain uncertain until resolved. Test files are committed implementation. Manual CLI execution records observed results without claiming core receipts. Preserve body/status independence and unrelated edits.
