---
plan: 2026-10-29-cli-plan-flows
step: 4
title: plan start
status: done
context:
  - spec: feature/plan-execution#Start flow
  - spec: feature/plan-execution#Execution backends
  - spec: "feature/plan-execution#Stacked plans (`dependency_mode: stack`)"
  - spec: feature/plan-execution#Start with stacking
  - spec: feature/plan-status#Status source setting
  - spec: architecture/reference-cli#Plan flows (`plan/flows.ts`)
  - spec: architecture/reference-cli#Start
  - spec: architecture/reference-cli#Claim commits (frontmatter mode)
  - spec: architecture/file-formats#8. Commit messages
  - file: packages/cli/src/plan/flows.ts
  - file: packages/cli/src/commands/plan.ts
---

## Goal

Implement `plan start <id>` for first start and resume, for all backends, with stacking and frontmatter claim commits.

## Acceptance criteria

- [x] First start creates `plan/<id>` from the default branch tip without moving any checkout, creates the worktree, runs the setup hook, and announces path and next step.
- [x] Dependency, approval, and plan-status checks fail before any write with the spec messages; a setup-hook failure removes the new worktree.
- [x] Stacking: one unmerged dependency is allowed; two or more fail with "Cannot stack on more than one unmerged dependency: <a>, <b>."; the marker commit has the specified trailers.
- [x] Resume re-uses the branch and worktree, skips dependency and approval checks, and tracks a remote-only branch.
- [x] Branch backend requires a clean tree; external backend only announces.
- [x] Frontmatter mode writes a claim commit on the default branch with `Specplane-Workflow: claim`.

## Tasks

1. Implement `startPlan` in `plan/flows.ts`: validate-then-write ordering.
2. Marker commit via `git commit-tree`.
3. Command wiring and flags.
4. Integration tests for scenarios 1, 2, 3, 6, 7, 8 with a bare origin.

## Guidance

- Load the plan from the default branch tip with `git show`, not the working tree.
- Trailers via `cliTrailers`.
