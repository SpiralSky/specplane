---
plan: 2026-11-01-extension-conformance
step: 1
title: "Cross-package acceptance matrix"
status: pending
context:
  - spec: "architecture/reference-cli"
  - spec: "architecture/agent-skills"
  - spec: "architecture/file-formats"
---

## Goal

Run package installation, shared protocol, manual lifecycle and host workflow regression matrix from release artifacts.

## Acceptance criteria

- [ ] CLI/core paths agree for exact staging, coordination, confirmations, receipts and provenance.
- [ ] Each public export and delivered workflow maps to passing applicable tests; full implementation suite and repository validation are reported separately.

## Tasks

1. Run package installation, shared protocol, manual lifecycle and host workflow regression matrix from release artifacts.
2. Verify each acceptance criterion with the applicable automated checks or required host evidence.
3. Record results, limitations and any specification gaps through the plan-step workflow.

## Guidance

Follow the architecture before feature details. Record missing or contradictory requirements in `spec-gaps.md` and resolve them before dependent implementation. Execute only in this plan’s designated checkout; let the workflow record progress.
