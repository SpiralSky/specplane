---
plan: 2026-11-01-manual-lifecycle
step: 3
title: "Neutral startup and extension conductor"
status: pending
context:
  - spec: "architecture/reference-cli#Shared conductor and extension boundary"
  - file: "packages/cli/src/plan/run.ts"
  - file: "packages/cli/src/harness/session.ts"
  - file: "packages/cli/src/agents/standing.ts"
  - file: "packages/cli/src/cli.ts"
---

## Goal

Extract extension-supplied adapter entry, remove standalone run surfaces, and deliver neutral startup/instruction routing with migration diagnostics.

## Acceptance criteria

- [ ] No installed-file/default/registry-order runtime selection; plain start remains usable without a host.
- [ ] Fake adapter tests cover launch uncertainty, resume, limits, cancellation, finish-ready and identity mapping without approving or merging.
- [ ] CLI help, docs and callers match removed commands; host capabilities remain gated until later verification.

## Tasks

1. Extract extension-supplied adapter entry, remove standalone run surfaces, and deliver neutral startup/instruction routing with migration diagnostics.
2. Verify each acceptance criterion with the applicable automated checks or required host evidence.
3. Record results, limitations and any specification gaps through the plan-step workflow.

## Guidance

Complete step 2 before this step.

Follow the architecture before feature details. Record missing or contradictory requirements in `spec-gaps.md` and resolve them before dependent implementation. Execute only in this plan’s designated checkout; let the workflow record progress.
