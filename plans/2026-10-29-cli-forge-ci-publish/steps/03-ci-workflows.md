---
plan: 2026-10-29-cli-forge-ci-publish
step: 3
title: CI workflows in this repository
status: pending
context:
  - spec: architecture/ci#Job 1: Validate (`specplane-validate.yml`)
  - spec: architecture/ci#Job 2: Regenerate PLANS.md (`specplane-generate.yml`)
  - spec: architecture/ci#Protected branch considerations
  - spec: architecture/ci#`.gitattributes` recommendation
  - spec: feature/plan-index#Keeping `PLANS.md` fresh
  - file: .github/workflows/
  - file: .gitattributes
---

## Goal

Create the validate and generate workflows and `.gitattributes` as specified.

## Acceptance criteria

- [ ] `.github/workflows/specplane-validate.yml` and `specplane-generate.yml` exist and match the corrected spec.
- [ ] The generate job commits only when `PLANS.md` changed, and its commit message follows `file-formats` §8 housekeeping rules.
- [ ] `.gitattributes` has the recommended `PLANS.md` merge setting.
- [ ] Workflows parse as valid YAML (check with a YAML parser or `actionlint` if available).

## Tasks

1. Write the workflows from the spec.
2. Validate the YAML in a unit test or script.

## Guidance

- Do not push or trigger anything; the repository has no remote.
