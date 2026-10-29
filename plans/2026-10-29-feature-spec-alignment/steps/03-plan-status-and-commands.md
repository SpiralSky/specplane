---
plan: 2026-10-29-feature-spec-alignment
step: 3
title: Stack-mode blocked, abandon, --no-fetch, --kind, restack dry run
status: pending
context:
  - spec: feature/plan-status
  - spec: feature/tooling
  - spec: architecture/reference-cli#Plan status (`plan/status.ts`)
  - spec: architecture/reference-cli#Plan flows (`plan/flows.ts`)
  - spec: architecture/reference-cli#Restack
  - file: packages/cli/src/plan/status.ts
  - file: packages/cli/src/plan/flows.ts
  - file: packages/cli/src/cli.ts
  - file: packages/cli/src/commands/search.ts
---

## Goal

Bring plan status and the plan and search commands in line with `feature/plan-status` and `feature/tooling`.

## Acceptance criteria

- [ ] With `dependency_mode: stack`, a `ready` plan with two or more unmerged dependencies shows as `blocked` in `PLANS.md` and `plan list`, with the feature message; one unmerged dependency is not `blocked`.
- [ ] Abandoning a `done` or `abandoned` plan fails with "Cannot abandon plan: `<id>` is `<status>`."
- [ ] `plan start --no-fetch` and `plan finish --no-fetch` skip every fetch; pushes and PRs are unaffected.
- [ ] `search --kind spec|plan` replaces `search --type`.
- [ ] `plan restack --dry-run` prints the new base and the commits it would replay.
- [ ] `npm test` passes.

## Tasks

1. Update `plan/status.ts` and its callers for stack mode.
2. Change the abandon check; thread a `fetch` option through start and finish.
3. Rename the search option; extend the restack dry-run result.
4. Tests for each.

## Guidance

- Check whether abandon of an `abandoned` plan is currently idempotent on purpose (`flows.ts` `already`); the feature spec now says it fails. If cleanup relies on the idempotent path, record a `gap` entry and keep cleanup working.
