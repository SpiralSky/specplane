---
plan: 2026-10-29-cli-plan-flows
step: 6
title: abandon, cleanup, archive, restack
status: pending
context:
  - spec: feature/plan-execution#Abandoning a plan
  - spec: feature/plan-execution#Cleanup
  - spec: feature/plan-execution#Restacking
  - spec: feature/tooling#`specplane plan abandon <id>`
  - spec: feature/tooling#`specplane plan cleanup <id>`
  - spec: feature/tooling#`specplane plan archive <id>`
  - spec: architecture/reference-cli#Cleanup, abandon, archive
  - spec: architecture/reference-cli#Restack
  - file: packages/cli/src/plan/flows.ts
  - file: packages/cli/src/commands/plan.ts
---

## Goal

Implement `plan abandon`, `cleanup`, `archive`, and `restack` per the spec.

## Acceptance criteria

- [ ] `abandon` writes the `abandoned` status (and archives when configured) in a `chore(specplane): abandon <id>` commit on the default branch, removes the worktree (`--force` for dirty), and deletes the branch only with `--delete-branch`.
- [ ] `cleanup` removes the worktree and deletes `plan/<id>` only if the plan is `done` on the default branch; it is idempotent.
- [ ] `archive` moves a `done` or `abandoned` plan not yet archived; otherwise it errors as specified.
- [ ] `restack` replays only the branch's own commits using the latest marker, appends a new marker when the base is still unmerged, and surfaces conflicts without resolving them. Scenario 6a passes after a squash merge.
- [ ] Tests for each, including idempotence.

## Tasks

1. Implement the four flows and commands.
2. Tests with squash-merged base plan in a temp repository.

## Guidance

- Same preconditions as claim commits for any commit on the default branch.
