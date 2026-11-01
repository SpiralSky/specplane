---
plan: 2026-11-01-extension-packaging
step: 1
title: "Package inventory and contract snapshots"
status: pending
context:
  - spec: "architecture/reference-cli#Compatibility manifest and package delivery"
  - file: "packages/cli/src/harness/pack.test.ts"
  - file: "packages/cli/src/spec/skill-drift.ts"
---

## Goal

Produce reusable package builder and complete asset/procedure inventories against committed targets.

## Acceptance criteria

- [ ] Every runtime/dependency asset and required procedure is covered and resolvable from the built package.
- [ ] Tampered or incompatible bundle refuses before mutation; a pin is not treated as conformance evidence.

## Tasks

1. Produce reusable package builder and complete asset/procedure inventories against committed targets.
2. Verify each acceptance criterion with the applicable automated checks or required host evidence.
3. Record results, limitations and any specification gaps through the plan-step workflow.

## Guidance

Follow the architecture before feature details. Record missing or contradictory requirements in `spec-gaps.md` and resolve them before dependent implementation. Execute only in this plan’s designated checkout; let the workflow record progress.
