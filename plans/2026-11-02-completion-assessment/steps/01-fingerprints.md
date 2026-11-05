---
plan: 2026-11-02-completion-assessment
step: 1
title: "Implement completion schema and versioned fingerprints"
status: done
context:
  - spec: "architecture/file-formats#10. Implementation assessment format and canonical content"
  - spec: "architecture/reference-cli#Implementation completion operations"
---

## Goal

Implement completion schema and versioned fingerprints

## Acceptance criteria

- [ ] Manual declarations without fingerprints are valid; malformed metadata, duplicate keys and unsupported values follow the specified errors.
- [ ] Canonicalization excludes only specified bookkeeping; recursive root-qualified dependencies handle cycles, anchored references and changed membership.

## Tasks

1. Implement the behavior stated in the goal using the listed contracts.
2. Add focused regression tests for each acceptance criterion, including its refusal and preservation cases.
3. Run the reviewed procedure and record commands, outcomes and limitations through the plan-step workflow.

## Guidance

Use the managed checkout after CLI start. Before preparation, bind each criterion to concrete suite IDs and a supported reporter (Node TAP v13 or JUnit XML on stdout); missing mappings remain uncertain until resolved. Test files are committed implementation. Manual CLI execution records observed results without claiming core receipts. Preserve body/status independence and unrelated edits.
