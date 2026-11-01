---
plan: 2026-11-01-extension-packaging
step: 3
title: "Coexistence and legacy rollout"
status: pending
context:
  - spec: "architecture/reference-cli#Explicit upgrade transaction"
  - spec: "architecture/agent-skills#Standing instructions"
  - file: "packages/cli/src/harness/index.ts"
---

## Goal

Connect explicit installation selection and neutral guidance; gate legacy retirement on replacement readiness.

## Acceptance criteria

- [ ] Both install orders and repeated init preserve the other extension and user settings.
- [ ] Old public skills remain available until replacements are usable; collisions keep affected commands unavailable with an exact action.
- [ ] Prepared/installed/enabled states reflect observed evidence only.

## Tasks

1. Connect explicit installation selection and neutral guidance; gate legacy retirement on replacement readiness.
2. Verify each acceptance criterion with the applicable automated checks or required host evidence.
3. Record results, limitations and any specification gaps through the plan-step workflow.

## Guidance

Complete step 2 before this step.

Follow the architecture before feature details. Record missing or contradictory requirements in `spec-gaps.md` and resolve them before dependent implementation. Execute only in this plan’s designated checkout; let the workflow record progress.
