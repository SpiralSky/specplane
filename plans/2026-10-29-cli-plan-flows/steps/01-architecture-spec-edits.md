---
plan: 2026-10-29-cli-plan-flows
step: 1
title: Architecture spec edits for restack and flows
status: pending
context:
  - spec: architecture/reference-cli#Plan flows (`plan/flows.ts`)
  - spec: architecture/reference-cli#Restack
  - spec: architecture/reference-cli#Error classes (`errors.ts`)
  - spec: feature/plan-execution#Restacking
  - spec: feature/plan-execution#Finish flow
  - file: docs/specifications/architecture/reference-cli.md
---

## Goal

Specify what triggers a restack and fix the flow description gaps before implementing.

## Acceptance criteria

- [ ] `architecture/reference-cli` states restack triggers: explicit `plan restack <id>`; automatically in finish step 4; and, on resume of a stacked plan whose base has merged, a message telling the user to run `plan restack` (resume never rewrites history).
- [ ] The module structure lists `restack` among the plan commands and `harness/` is left to the harness plan.
- [ ] Error-class usage of `PlanStateError` matches the feature texts per the earlier convention.
- [ ] Pins are refreshed and validation passes.

## Tasks

1. Edit the Restack and Module structure sections.
2. Re-pin and validate.

## Guidance

- Spec edits on a plan branch keep their `approved` status (`feature/plan-status`); do not change `status:`. Do not edit feature specs: they have `llm_role: assist`.
- After editing an approved base spec, run `specplane spec pin` for dependent overlay specs and skill contract comments that pin it (see `feature/spec-overlays` § Base pins), then `specplane spec pin --check`.
- `feature/tooling` has no `plan restack` command; step 02 proposes it. The architecture documents it as an extension and notes the dependency on that proposal.
