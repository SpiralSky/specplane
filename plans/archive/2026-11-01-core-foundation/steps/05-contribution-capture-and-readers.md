---
plan: 2026-11-01-core-foundation
step: 5
title: "Contribution capture and readers"
status: done
context:
  - spec: "architecture/file-formats#1.7 Contribution provenance"
  - file: "packages/cli/src/git/commit.ts"
---

## Goal

Implement event validation/deduplication and repeated-trailer read/write support.

## Acceptance criteria

- [ ] Same-session A/B, later C and subagent contributions survive serialization and rewrites.
- [ ] Unknown identities remain unknown; duplicate event IDs cannot duplicate attribution.

## Tasks

1. Implement event validation/deduplication and repeated-trailer read/write support.
2. Verify each acceptance criterion with the applicable automated checks or required host evidence.
3. Record results, limitations and any specification gaps through the plan-step workflow.

## Guidance

Complete step 4 before this step.

Follow the architecture before feature details. Record missing or contradictory requirements in `spec-gaps.md` and resolve them before dependent implementation. Execute only in this plan’s designated checkout; let the workflow record progress.
