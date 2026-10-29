---
id: 2026-10-29-cli-plan-commands
title: CLI plan commands, effective status, and live activity
status: done
specs:
  - feature/tooling
  - feature/plan-status
  - feature/plan-index
  - feature/plan-system
  - feature/plan-steps
  - architecture/reference-cli
  - architecture/file-formats
depends_on:
  - 2026-10-28-reference-cli-core
  - 2026-10-29-cli-spec-search
---

# CLI plan commands, effective status, and live activity

## Goal

Add the read-side plan commands: `plan new`, `plan list`, `plan show`, `plan graph`, effective (git-derived) statuses, and live plan activity for `plan list --live` and `generate --print --live`. Also close the plan-status and plan-index review findings.

## Scope

- Architecture-spec edits for the `plan` command surface and a backend/`where` field in plan activity.
- Proposal file for plan-status and plan-index feature-spec findings.
- `git/commit.ts` (message formatting, trailers), branch queries, worktree listing.
- Effective-status computation, `plan list`, `--live` activity, `generate --print --live`.
- `plan new`, `plan show`, `plan graph`.

## Non-goals

- Start/finish/abandon/cleanup/archive/restack and branch/worktree writes (`2026-10-29-cli-plan-flows`).
- Forge-derived `review` status (`2026-10-29-cli-forge-ci-publish`); until then `review` is derived from the stored status only.
- Applying proposals to feature specs.

## Specs implemented

| Spec | Coverage |
|------|----------|
| `feature/tooling` | `plan new/list/show/graph`, `--live` |
| `feature/plan-status` | Effective status and status sources |
| `feature/plan-index` | `generate --print --live` |
| `feature/plan-system` | `plan new` output |
| `feature/plan-steps` | Step progress in activity |
| `architecture/reference-cli` | Plan status, plan activity, commit helpers |
| `architecture/file-formats` | Commit format section 8 |

## Acceptance criteria

- [x] `specplane plan list` shows stored and effective statuses; `--status blocked` filters by effective status (Scenario 4 of `feature/tooling`).
- [x] `plan list --json --live` returns the activity fields of `architecture/reference-cli` § Plan activity, including remote-only plans and the backend field added in step 01.
- [x] `generate --print --live` prints the index with live statuses and never writes the file; plain `generate` stays deterministic.
- [x] `plan new` creates a valid PLAN.md (draft) and `steps/`; an existing ID exits 1 with the exact text.
- [x] `plan show` and `plan graph` print as specified.
- [x] `plans/2026-10-29-cli-plan-commands/feature-spec-proposals.md` covers plan-status and plan-index findings.
- [x] `npm test` passes; `specplane validate` exits 0.

## Risks

1. Git state is unavailable in shallow or remote-less clones: every activity field must degrade to null, never throw.
2. Trailer parsing differs across git versions: use the `interpret-trailers` form from the spec and test against the installed git.

## Steps

1. `architecture-spec-edits`: Edit `architecture/reference-cli`.
2. `feature-spec-proposals`: Write the proposal file; no feature-spec edits.
3. `commit-and-git-queries`: Implement commit helpers and read-only git queries.
4. `effective-status-and-list`: Implement effective status and `plan list`.
5. `live-activity`: Implement live activity.
6. `plan-new-show-graph`: Implement the remaining read-side plan commands.
