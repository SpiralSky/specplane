---
plan: 2026-10-29-cli-plan-flows
step: 3
title: Branch and worktree writes, setup hook, error classes
status: pending
context:
  - spec: architecture/reference-cli#`branch.ts`
  - spec: architecture/reference-cli#`worktree.ts`
  - spec: architecture/reference-cli#Error classes (`errors.ts`)
  - spec: feature/plan-execution#Worktree concerns
  - spec: feature/plan-execution#Setup hook
  - spec: feature/plan-execution#Cleanup
  - spec: feature/configuration
  - file: packages/cli/src/git/
  - file: packages/cli/src/errors.ts
---

## Goal

Implement branch creation/deletion/rebase, worktree add/remove, the setup-hook runner, and the flow error classes.

## Acceptance criteria

- [ ] `createBranch`, `deleteBranch`, `rebaseOnto` (aborts and throws `RebaseConflictError` on conflict, leaving the branch unchanged) are implemented and tested.
- [ ] `createWorktree` reuses an existing worktree for the branch; `removeWorktree` without `force` fails on a dirty worktree and reports it.
- [ ] `runSetupHook(cmd, cwd)` runs through the user's shell; non-zero exit throws `SetupHookError` with the spec message.
- [ ] `PlanStateError`, `PlanNotFoundError`, `RebaseConflictError`, `SetupHookError` exist with spec messages and exit codes.
- [ ] Tests use temp repositories.

## Tasks

1. Extend `git/branch.ts` and `git/worktree.ts`.
2. Implement the hook runner in `plan/hooks.ts`.
3. Add tests including a real conflicting rebase.

## Guidance

- `worktreePath` resolves `execution.worktree_dir` relative to the main checkout root.
