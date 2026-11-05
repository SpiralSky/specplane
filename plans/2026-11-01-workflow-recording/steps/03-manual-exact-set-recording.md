---
plan: 2026-11-01-workflow-recording
step: 3
title: "Manual exact-set recording"
status: done
context:
  - spec: "architecture/reference-cli"
  - file: "packages/cli/src/plan/step-done.ts"
  - file: "packages/cli/src/plan/step-done.test.ts"
---

## Goal

Add recording-set input and shared atomic recording primitive; update the manual procedure and affected callers in this same change.

## Acceptance criteria

- [ ] Unrelated staged/unstaged/plan-folder edits and partial staging refuse before mutation.
- [ ] Empty status-only result, additions/deletions, forced rerecord and commit-failure index restoration are covered.
- [ ] Existing callers are migrated or receive actionable refusal; no silent blanket-staging fallback.

## Tasks

1. Add recording-set input and shared atomic recording primitive; update the manual procedure and affected callers in this same change.
2. Verify each acceptance criterion with the applicable automated checks or required host evidence.
3. Record results, limitations and any specification gaps through the plan-step workflow.

## Guidance

Complete step 2 before this step.

Follow the architecture before feature details. Record missing or contradictory requirements in `spec-gaps.md` and resolve them before dependent implementation. Execute only in this plan’s designated checkout; let the workflow record progress.
