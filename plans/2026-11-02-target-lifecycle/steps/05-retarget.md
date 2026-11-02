---
plan: 2026-11-02-target-lifecycle
step: 5
title: "Implement explicit retarget previews and atomic metadata updates"
status: pending
context:
  - spec: "architecture/reference-cli#Explicit managed retarget operation"
---

## Goal

Implement explicit retarget previews and atomic metadata updates

## Acceptance criteria

- [ ] Dry-run/JSON inspect identical preconditions without mutation; actual writes recheck refs, leases and plan identity.
- [ ] PR base/lifecycle conflicts and missing required forge evidence refuse; original start/comparison provenance survives; no commit, rebase or PR edit occurs.

## Tasks

1. Implement the behavior stated in the goal using the listed contracts.
2. Add focused regression tests for each acceptance criterion, including its refusal and preservation cases.
3. Run the reviewed procedure and record commands, outcomes and limitations through the plan-step workflow.

## Guidance

Complete earlier steps first. Use the managed checkout after CLI start. Before preparation, bind each criterion to concrete suite IDs and a supported reporter (Node TAP v13 or JUnit XML on stdout); missing mappings remain uncertain until resolved. Test files are committed implementation. Manual CLI execution records observed results without claiming core receipts. Preserve body/status independence and unrelated edits.
