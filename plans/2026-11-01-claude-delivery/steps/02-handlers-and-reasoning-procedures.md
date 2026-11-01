---
plan: 2026-11-01-claude-delivery
step: 2
title: "Handlers and reasoning procedures"
status: pending
context:
  - spec: "claude:architecture/claude-integration"
  - spec: "architecture/agent-skills"
  - file: "harnesses/claude/templates"
---

## Goal

Implement verified native handlers and policy hooks delegating to core; package internal reasoning procedures and fallback.

## Acceptance criteria

- [ ] Mechanical handler path performs no model call; built-in commands are not shadowed.
- [ ] Human gates cannot be supplied by model output; every replaced legacy workflow has conformance coverage.

## Tasks

1. Implement verified native handlers and policy hooks delegating to core; package internal reasoning procedures and fallback.
2. Verify each acceptance criterion with the applicable automated checks or required host evidence.
3. Record results, limitations and any specification gaps through the plan-step workflow.

## Guidance

Complete step 1 before this step.

Follow the architecture before feature details. Record missing or contradictory requirements in `spec-gaps.md` and resolve them before dependent implementation. Execute only in this plan’s designated checkout; let the workflow record progress.
