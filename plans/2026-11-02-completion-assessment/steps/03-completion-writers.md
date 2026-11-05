---
plan: 2026-11-02-completion-assessment
step: 3
title: "Deliver spec complete and implementation status operations"
status: done
context:
  - spec: "architecture/reference-cli#Implementation completion operations"
---

## Goal

Deliver spec complete and implementation status operations

## Acceptance criteria

- [ ] CLI/core parity covers dry-run, no-op repetition, all statuses and preserving prior evidence; complete resolves the entire dependency closure.
- [ ] Lease and preimage checks preserve body, lifecycle, unrelated edits/index on failure; no plan, commit, test execution or fabricated evidence is required.

## Tasks

1. Implement the behavior stated in the goal using the listed contracts.
2. Add focused regression tests for each acceptance criterion, including its refusal and preservation cases.
3. Run the reviewed procedure and record commands, outcomes and limitations through the plan-step workflow.

## Guidance

Complete earlier steps first. Use the managed checkout after CLI start. Before preparation, bind each criterion to concrete suite IDs and a supported reporter (Node TAP v13 or JUnit XML on stdout); missing mappings remain uncertain until resolved. Test files are committed implementation. Manual CLI execution records observed results without claiming core receipts. Preserve body/status independence and unrelated edits.
