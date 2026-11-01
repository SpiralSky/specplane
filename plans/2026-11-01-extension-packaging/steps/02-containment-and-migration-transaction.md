---
plan: 2026-11-01-extension-packaging
step: 2
title: "Containment and migration transaction"
status: pending
context:
  - spec: "architecture/reference-cli#Explicit upgrade transaction"
  - file: "packages/cli/src/commands/init.ts"
  - file: "packages/cli/src/harness/codex.ts"
  - file: "packages/cli/src/harness/claude.ts"
---

## Goal

Implement common/host destination validation, ownership digests, journal, backups and recovery.

## Acceptance criteria

- [ ] Dangling links and changed path components never write outside the target.
- [ ] Customized files survive; interruption at each transaction phase recovers without partial activation.

## Tasks

1. Implement common/host destination validation, ownership digests, journal, backups and recovery.
2. Verify each acceptance criterion with the applicable automated checks or required host evidence.
3. Record results, limitations and any specification gaps through the plan-step workflow.

## Guidance

Complete step 1 before this step.

Follow the architecture before feature details. Record missing or contradictory requirements in `spec-gaps.md` and resolve them before dependent implementation. Execute only in this plan’s designated checkout; let the workflow record progress.
