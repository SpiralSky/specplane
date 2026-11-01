---
plan: 2026-11-01-claude-delivery
step: 1
title: "Host surface evidence"
status: pending
context:
  - spec: "claude:architecture/claude-integration"
---

## Goal

Inspect installed declarations and build a named-version API/collision/interaction compatibility fixture.

## Acceptance criteria

- [ ] Native APIs and direct-human port signatures have evidence before native handler implementation.
- [ ] If unavailable, report the native work blocked and retain labeled fallback; do not count unavailable capability as successful delivery.

## Tasks

1. Inspect installed declarations and build a named-version API/collision/interaction compatibility fixture.
2. Verify each acceptance criterion with the applicable automated checks or required host evidence.
3. Record results, limitations and any specification gaps through the plan-step workflow.

## Guidance

Follow the architecture before feature details. Record missing or contradictory requirements in `spec-gaps.md` and resolve them before dependent implementation. Execute only in this plan’s designated checkout; let the workflow record progress.
