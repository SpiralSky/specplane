---
plan: 2026-10-29-cli-plan-commands
step: 4
title: Effective status and plan list
status: done
context:
  - spec: architecture/reference-cli#Plan status (`plan/status.ts`)
  - spec: feature/plan-status#Effective status
  - spec: feature/plan-status#Status source setting
  - spec: feature/tooling#`specplane plan list [--status <status>]`
  - spec: feature/plan-execution#Branch model
  - file: packages/cli/src/plan/status.ts
  - file: packages/cli/src/commands/
---

## Goal

Implement effective plan status derivation and the `plan list` command (without `--live`).

## Acceptance criteria

- [x] With `status_source: git`, a `ready` plan with branch `plan/<id>` is effectively `in_progress`; an abandoned or unmerged dependency yields `blocked` as specified; `done` and `abandoned` are unchanged.
- [x] With `status_source: frontmatter`, the stored status is used.
- [x] `plan list` prints the human table and the `--json` array with `id,title,stored_status,effective_status,depends_on,specs,archived`; `--status` filters on the effective status.
- [x] `review` is derived only from the stored status in this plan (forge comes later); the code path for a forge is a documented extension point.
- [x] Tests cover Scenarios 1, 2, 4, and 6 of `feature/plan-status`.

## Tasks

1. Extend `plan/status.ts` to compute effective status with the branch queries from step 03.
2. Implement `commands/plan.ts` `list` and wire it into `cli.ts`.
3. Integration tests in temp repositories with and without a branch.

## Guidance

- Effective status is never written to files; PLANS.md keeps stored status plus `blocked` only.
