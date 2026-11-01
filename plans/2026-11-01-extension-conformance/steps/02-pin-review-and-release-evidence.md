---
plan: 2026-11-01-extension-conformance
step: 2
title: "Pin review and release evidence"
status: pending
context:
  - spec: "architecture/reference-cli#Compatibility manifest and package delivery"
  - file: "packages/cli/src/spec/skill-drift.ts"
  - file: "packages/cli/src/spec/pins.ts"
---

## Goal

After implementation conformance review, refresh CLI-managed pins and write exact tested-version/surface evidence plus migration docs.

## Acceptance criteria

- [ ] All pins refer to committed reviewed targets; no hash-only claim of conformance.
- [ ] Warnings receive revision-bound review; no requirement to make unrelated heuristic warnings disappear.
- [ ] Human finish/merge/publication remains separate; blocked Claude delivery cannot be hidden by a generic unavailable flag.

## Tasks

1. After implementation conformance review, refresh CLI-managed pins and write exact tested-version/surface evidence plus migration docs.
2. Verify each acceptance criterion with the applicable automated checks or required host evidence.
3. Record results, limitations and any specification gaps through the plan-step workflow.

## Guidance

Complete step 1 before this step.

Follow the architecture before feature details. Record missing or contradictory requirements in `spec-gaps.md` and resolve them before dependent implementation. Execute only in this plan’s designated checkout; let the workflow record progress.
