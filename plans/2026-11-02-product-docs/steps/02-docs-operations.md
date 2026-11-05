---
plan: 2026-11-02-product-docs
step: 2
title: "Expose shared offline docs index, topic and search"
status: done
context:
  - spec: "architecture/reference-cli#Shared product documentation operations"
---

## Goal

Expose shared offline docs index, topic and search

## Acceptance criteria

- [ ] Operations work outside Git without config or network; CLI/core content, order and version fields agree.
- [ ] Unknown/traversal IDs, empty queries and corrupt bundles follow specified errors; literal search has deterministic excerpts and empty success results.

## Tasks

1. Implement the behavior stated in the goal using the listed contracts.
2. Add focused regression tests for each acceptance criterion, including its refusal and preservation cases.
3. Run the reviewed procedure and record commands, outcomes and limitations through the plan-step workflow.

## Guidance

Complete earlier steps first. Use the managed checkout after CLI start. Before preparation, bind each criterion to concrete suite IDs and a supported reporter (Node TAP v13 or JUnit XML on stdout); missing mappings remain uncertain until resolved. Test files are committed implementation. Manual CLI execution records observed results without claiming core receipts. Preserve body/status independence and unrelated edits.
