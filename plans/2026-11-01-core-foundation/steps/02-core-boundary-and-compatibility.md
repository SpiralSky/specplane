---
plan: 2026-11-01-core-foundation
step: 2
title: "Core boundary and compatibility"
status: pending
context:
  - spec: "architecture/reference-cli#Public core exports"
  - spec: "architecture/reference-cli#Compatibility manifest and package delivery"
  - file: "packages/cli/package.json"
---

## Goal

Create import-safe core entry, typed ports, compatibility validator and closed shared schemas. Unimplemented mutating operations explicitly refuse.

## Acceptance criteria

- [ ] Importing the core does not parse CLI arguments or mutate a checkout.
- [ ] Unknown fields, wrong versions and invalid asset digests refuse; unknown host version disables native/background capability.

- [ ] Public contracts include completion/docs/target operations and executeWorkflowTest; unavailable implementations explicitly refuse.

## Tasks

1. Create import-safe core entry, typed ports, compatibility validator and closed shared schemas. Unimplemented mutating operations explicitly refuse.
2. Verify each acceptance criterion with the applicable automated checks or required host evidence.
3. Record results, limitations and any specification gaps through the plan-step workflow.

Additional tasks for the settled contracts:

- Add closed request/result schemas and import-safety tests without advertising unfinished commands.

## Guidance

Complete step 1 before this step.

Follow the architecture before feature details. Record missing or contradictory requirements in `spec-gaps.md` and resolve them before dependent implementation. Execute only in this plan’s designated checkout; let the workflow record progress.
