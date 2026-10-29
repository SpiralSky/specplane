---
plan: 2026-10-29-cli-forge-ci-publish
step: 1
title: Architecture edits for ci
status: pending
context:
  - spec: architecture/ci#Job 1: Validate (`specplane-validate.yml`)
  - spec: architecture/ci#Job 2: Regenerate PLANS.md (`specplane-generate.yml`)
  - spec: architecture/ci#Path filter
  - spec: architecture/ci#Protected branch considerations
  - spec: feature/plan-index#Keeping `PLANS.md` fresh
  - spec: feature/configuration
  - file: docs/specifications/architecture/ci.md
---

## Goal

Fix the ci review findings in the spec before writing workflows.

## Acceptance criteria

- [ ] The prose triggers (which events and branches each job runs on) match the YAML in the spec.
- [ ] No workflow text hardcodes `plans/**` or `plans/PLANS.md`: the spec states a config-independent approach (for example run on any markdown or `.specplane/config.yaml` change and let `specplane generate` no-op) or a documented snippet the user adjusts to `plans.dir`.
- [ ] Pins refreshed; validation passes.

## Tasks

1. Edit the three sections.
2. Re-pin and validate.

## Guidance

- Spec edits on a plan branch keep their `approved` status (`feature/plan-status`); do not change `status:`. Do not edit feature specs: they have `llm_role: assist`.
- After editing an approved base spec, run `specplane spec pin` for dependent overlay specs and skill contract comments that pin it (see `feature/spec-overlays` § Base pins), then `specplane spec pin --check`.
