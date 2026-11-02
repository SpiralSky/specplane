---
plan: 2026-11-02-completion-assessment
step: 2
title: "Evaluate completion independently of lifecycle state"
status: pending
context:
  - spec: "architecture/reference-cli#Implementation completion operations"
---

## Goal

Evaluate completion independently of lifecycle state

## Acceptance criteria

- [ ] List/show/validation report declaration plus current, reassessment_needed, unrecorded or unverifiable with ordered reasons.
- [ ] Unavailable/unsupported dependencies take unverifiable precedence while retaining mismatches; code changes alone never imply verification.

## Tasks

1. Implement the behavior stated in the goal using the listed contracts.
2. Add focused regression tests for each acceptance criterion, including its refusal and preservation cases.
3. Run the reviewed procedure and record commands, outcomes and limitations through the plan-step workflow.

## Guidance

Complete earlier steps first. Use the managed checkout after CLI start. Before preparation, bind each criterion to concrete suite IDs and a supported reporter (Node TAP v13 or JUnit XML on stdout); missing mappings remain uncertain until resolved. Test files are committed implementation. Manual CLI execution records observed results without claiming core receipts. Preserve body/status independence and unrelated edits.
