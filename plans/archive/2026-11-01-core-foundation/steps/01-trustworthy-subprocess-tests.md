---
plan: 2026-11-01-core-foundation
step: 1
title: "Trustworthy subprocess tests"
status: done
context:
  - file: "packages/cli/src/harness/codex.test.ts"
---

## Goal

Remove inherited nested-runner context and add execution-count plus deliberately failing child coverage.

## Acceptance criteria

- [ ] A correct child executes its expected test; a broken implementation fails the outer fixture.
- [ ] Existing historical results are not relabeled as verified.

## Tasks

1. Remove inherited nested-runner context and add execution-count plus deliberately failing child coverage.
2. Verify each acceptance criterion with the applicable automated checks or required host evidence.
3. Record results, limitations and any specification gaps through the plan-step workflow.

## Guidance

Follow the architecture before feature details. Record missing or contradictory requirements in `spec-gaps.md` and resolve them before dependent implementation. Execute only in this plan’s designated checkout; let the workflow record progress.
