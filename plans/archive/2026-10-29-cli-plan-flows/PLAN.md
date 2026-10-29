---
id: 2026-10-29-cli-plan-flows
title: CLI plan flows — start, finish, abandon, cleanup, archive, restack
status: done
specs:
  - feature/plan-execution
  - feature/plan-status
  - feature/plan-steps
  - feature/tooling
  - feature/configuration
  - architecture/reference-cli
  - architecture/file-formats
depends_on:
  - 2026-10-28-reference-cli-core
  - 2026-10-29-cli-plan-commands
---

# CLI plan flows — start, finish, abandon, cleanup, archive, restack

## Goal

Implement the plan lifecycle flows in the CLI: `plan start`, `plan finish`, `plan abandon`, `plan cleanup`, `plan archive`, and `plan restack`, with the worktree, branch, and external backends, the setup hook, stacking, claim commits, and `local_merge`.

## Scope

- Architecture edit specifying what triggers restack and the `plan restack` command.
- Proposal file for the plan-steps findings and for adding `plan restack` to `feature/tooling`.
- Branch and worktree write operations, setup hook, new error classes.
- The flows in `plan/flows.ts` and their commands.

## Non-goals

- Forge calls: the `pull_request` finish path prints instructions when no forge is available; creating PRs is in `2026-10-29-cli-forge-ci-publish`.
- Harness files and `init --harness`.

## Specs implemented

| Spec | Coverage |
|------|----------|
| `feature/plan-execution` | All flows, backends, stacking, local merge |
| `feature/plan-status` | Transitions, done on the plan branch |
| `feature/plan-steps` | Readiness for finish; blocked steps |
| `feature/tooling` | Plan subcommands |
| `feature/configuration` | `execution`, `plans` keys |
| `architecture/reference-cli` | Plan flows, git helpers, errors |
| `architecture/file-formats` | Commit trailers |

## Acceptance criteria

- [ ] `plan start` implements Scenarios 1, 2, 3, 6, 7, and 8 of `feature/plan-execution` in a temp repository, for all three backends.
- [ ] `plan finish` implements Scenarios 4, 4a, 5, 5a; with `local_merge` it merges `--no-ff` into the default branch and cleans up.
- [ ] `plan restack` implements Scenario 6a using `rebase --onto` and the stack marker.
- [ ] `plan abandon`, `plan cleanup`, `plan archive` behave as in `feature/tooling` and are idempotent where specified.
- [ ] Every flow validates before its first write; a failed check leaves no partial state.
- [ ] `plans/2026-10-29-cli-plan-flows/feature-spec-proposals.md` exists.
- [ ] `npm test` passes.

## Risks

1. Rebase and worktree behaviour varies by git version: pin a minimum version in the README and tests.
2. Claim commits touch the main checkout: guard against a dirty or non-default checkout exactly as specified.
3. Flows are hard to test end to end: use temporary repositories with a bare `origin`.

## Steps

1. `architecture-spec-edits`: Edit `architecture/reference-cli`.
2. `feature-spec-proposals`: Write the proposal file; no feature-spec edits.
3. `git-write-ops-and-hooks`: Implement the write-side git helpers.
4. `start-flow`: Implement the start flow and command.
5. `finish-flow`: Implement the finish flow and command.
6. `abandon-cleanup-archive-restack`: Implement the remaining flows and commands.
