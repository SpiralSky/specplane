---
plan: 2026-10-29-cli-plan-flows
step: 5
title: plan finish and local merge
status: done
context:
  - spec: feature/plan-execution#Finish flow
  - spec: feature/plan-execution#Local merge
  - spec: feature/plan-execution#Acceptance scenarios
  - spec: feature/plan-status#The `done` transition and archiving
  - spec: feature/plan-steps
  - spec: architecture/reference-cli#Finish
  - spec: architecture/reference-cli#Restack
  - file: packages/cli/src/plan/flows.ts
  - file: packages/cli/src/commands/plan.ts
---

## Goal

Implement `plan finish <id>` including tests, rebase, the done+archive commit, `pull_request` and `local_merge` paths.

## Acceptance criteria

- [x] Readiness: wrong branch, dirty tree, a step not `done`/`skipped`, or an unfinished stack base fails with the spec messages and no writes.
- [x] `plans.test_command` runs in the checkout; failure aborts; tests re-run after a rebase that applied commits.
- [x] Rebase onto the default branch (or `rebaseOnto` for stacked plans); conflicts abort the rebase and throw `RebaseConflictError`.
- [x] The final commit sets `status: done` and moves the plan to `archive/` when `archive_done`, with the `finish` workflow trailer.
- [x] `local_merge` asks for confirmation (auto-confirmed by `--yes`) and merges `--no-ff` in the main checkout, then runs cleanup; `pull_request` pushes and prints PR instructions when no forge is available.
- [x] Scenarios 4, 4a, 5, 5a pass.

## Tasks

1. Implement `finishPlan`.
2. Add `--yes` and command wiring.
3. Integration tests with a bare origin and without any remote.

## Guidance

- Fetch is skipped when there is no remote.
- Forge PR creation is added by a later plan; leave a single call site that returns `null` now.
