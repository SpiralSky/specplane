---
plan: 2026-11-01-codex-delivery
step: 1
title: "Persistent runner"
status: pending
context:
  - spec: "codex:architecture/codex-integration"
  - spec: "architecture/reference-cli#Structured reasoning boundary"
---

## Goal

Implement packaged NDJSON runner and core lifecycle channel.

## Acceptance criteria

- [ ] Protocol framing, request matching, stale state, disconnect and worker-stop recovery are covered.
- [ ] No persistent channel yields the labeled manual fallback; no other host is substituted.

## Tasks

1. Implement packaged NDJSON runner and core lifecycle channel.
2. Verify each acceptance criterion with the applicable automated checks or required host evidence.
3. Record results, limitations and any specification gaps through the plan-step workflow.

## Guidance

Follow the architecture before feature details. Record missing or contradictory requirements in `spec-gaps.md` and resolve them before dependent implementation. Execute only in this plan’s designated checkout; let the workflow record progress.
