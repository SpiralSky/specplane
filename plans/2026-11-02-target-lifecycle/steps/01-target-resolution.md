---
plan: 2026-11-02-target-lifecycle
step: 1
title: "Resolve targets and validate immutable execution bindings"
status: done
context:
  - spec: "architecture/reference-cli#Integration target resolution and execution binding"
  - spec: "architecture/file-formats"
---

## Goal

Resolve targets and validate immutable execution bindings

## Acceptance criteria

- [ ] Explicit, declared, team and repository-default precedence is deterministic; ambiguous or unavailable legacy targets refuse.
- [ ] Target and comparison inputs resolve valid commits/branches; malformed bindings fail before mutation.

## Tasks

1. Implement the behavior stated in the goal using the listed contracts.
2. Add focused regression tests for each acceptance criterion, including its refusal and preservation cases.
3. Run the reviewed procedure and record commands, outcomes and limitations through the plan-step workflow.

## Guidance

Use the managed checkout after CLI start. Before preparation, bind each criterion to concrete suite IDs and a supported reporter (Node TAP v13 or JUnit XML on stdout); missing mappings remain uncertain until resolved. Test files are committed implementation. Manual CLI execution records observed results without claiming core receipts. Preserve body/status independence and unrelated edits.
