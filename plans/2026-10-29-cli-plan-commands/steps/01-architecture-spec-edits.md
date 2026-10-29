---
plan: 2026-10-29-cli-plan-commands
step: 1
title: Architecture spec edits for plan commands and activity
status: pending
context:
  - spec: architecture/reference-cli#Plan status (`plan/status.ts`)
  - spec: architecture/reference-cli#Plan activity (`plan list --json`)
  - spec: architecture/reference-cli#Module structure
  - spec: feature/tooling#`specplane plan`
  - spec: feature/tooling#`specplane plan list [--status <status>]`
  - spec: feature/plan-execution#Execution backends
  - file: docs/specifications/architecture/reference-cli.md
---

## Goal

Specify the `plan new/list/show/graph` command sections and add a backend/`where` field to the plan activity.

## Acceptance criteria

- [ ] `architecture/reference-cli` has sections for `plan new`, `plan list`, `plan show`, `plan graph` (module, inputs, outputs, exit codes).
- [ ] The plan-activity table adds `backend` (`worktree|branch|external`, from config) and `where` (`local|remote|none`) fields, with how each is derived; `checkout` semantics are clarified for the branch backend.
- [ ] Pins are refreshed; `specplane validate` and `spec pin --check` pass.

## Tasks

1. Add the command sections.
2. Extend the activity table and the `plan list --json` example.
3. Re-pin and validate.

## Guidance

- Spec edits on a plan branch keep their `approved` status (`feature/plan-status`); do not change `status:`. Do not edit feature specs: they have `llm_role: assist`.
- After editing an approved base spec, run `specplane spec pin` for dependent overlay specs and skill contract comments that pin it (see `feature/spec-overlays` § Base pins), then `specplane spec pin --check`.
- `feature/tooling` fixes the JSON fields of `plan list`; activity fields are additive.
