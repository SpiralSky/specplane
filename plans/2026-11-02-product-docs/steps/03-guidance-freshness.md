---
plan: 2026-11-02-product-docs
step: 3
title: "Detect managed guidance drift without implicit upgrades"
status: pending
context:
  - spec: "architecture/reference-cli#Shared product documentation operations"
  - spec: "architecture/agent-skills#Shared documentation and completion guidance"
---

## Goal

Detect managed guidance drift without implicit upgrades

## Acceptance criteria

- [ ] Version/hash checks report stale or missing owned guidance without writing files or fetching.
- [ ] Explicit refresh consumes reviewed release assets and preserves user/custom content; integration into both installers is owned by extension-packaging.

## Tasks

1. Implement the behavior stated in the goal using the listed contracts.
2. Add focused regression tests for each acceptance criterion, including its refusal and preservation cases.
3. Run the reviewed procedure and record commands, outcomes and limitations through the plan-step workflow.

## Guidance

Complete earlier steps first. Use the managed checkout after CLI start. Before preparation, bind each criterion to concrete suite IDs and a supported reporter (Node TAP v13 or JUnit XML on stdout); missing mappings remain uncertain until resolved. Test files are committed implementation. Manual CLI execution records observed results without claiming core receipts. Preserve body/status independence and unrelated edits.
