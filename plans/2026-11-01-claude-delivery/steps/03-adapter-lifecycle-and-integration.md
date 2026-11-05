---
plan: 2026-11-01-claude-delivery
step: 3
title: "Adapter lifecycle and integration"
status: pending
context:
  - spec: "claude:architecture/claude-integration"
  - spec: "architecture/reference-cli#Shared conductor and extension boundary"
  - file: "harnesses/claude/plugin/hooks/session-adapter.ts"
---

## Goal

Implement extension-owned session adapter against verified declarations with shared contract fixtures.

## Acceptance criteria

- [ ] Launch/observe/resume/cancel and budget behavior preserve core leases and recording ownership.
- [ ] Live certification requires named-version test evidence; fake-runner success alone enables no native/background capability.

- [ ] Consumer coverage includes offline docs, no-plan edits, completion and target-aware managed flows under named-version capability evidence.

## Tasks

1. Implement extension-owned session adapter against verified declarations with shared contract fixtures.
2. Verify each acceptance criterion with the applicable automated checks or required host evidence.
3. Record results, limitations and any specification gaps through the plan-step workflow.

Additional tasks for the settled contracts:

- Report unavailable host fixtures as blocked, not passing or certified.

## Guidance

Complete step 2 before this step.

Follow the architecture before feature details. Record missing or contradictory requirements in `spec-gaps.md` and resolve them before dependent implementation. Execute only in this plan’s designated checkout; let the workflow record progress.
