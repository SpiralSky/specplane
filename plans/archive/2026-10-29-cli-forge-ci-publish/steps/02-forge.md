---
plan: 2026-10-29-cli-forge-ci-publish
step: 2
title: forge.ts and PR integration
status: done
context:
  - spec: architecture/reference-cli#`forge.ts`
  - spec: architecture/reference-cli#Finish
  - spec: feature/plan-execution#Finish flow
  - spec: feature/plan-status#Effective status
  - spec: feature/plan-status#Acceptance scenarios
  - spec: feature/configuration
  - file: packages/cli/src/git/forge.ts
  - file: packages/cli/src/plan/flows.ts
  - file: packages/cli/src/plan/status.ts
---

## Goal

Implement `git/forge.ts` and use it in the finish flow and in effective status.

## Acceptance criteria

- [x] `createPR` and `getOpenPR` use `gh` with argument arrays and `--json`; `auto` returns `null` when the remote is not GitHub or `gh` is missing, `github` throws `ForgeError`, `none` returns `null`.
- [x] `finishPlan` with `pull_request` pushes, creates a PR with a title and body built from the plan, and prints the URL; with `null` it prints manual instructions.
- [x] Effective status is `review` for a plan with an open PR (Scenario 5 of `feature/plan-status`) and not otherwise (Scenario 6).
- [x] Tests use a stub `gh` executable placed first on `PATH`.

## Tasks

1. Implement forge.ts and the stub-based tests.
2. Wire into finish and status.

## Guidance

- `ForgeError` exits with code 2.
