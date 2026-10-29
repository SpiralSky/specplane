---
plan: 2026-10-29-feature-spec-alignment
step: 2
title: Config path errors and ADR validation
status: done
context:
  - spec: feature/configuration
  - spec: feature/decisions
  - spec: architecture/reference-cli#Config loading (`config.ts`)
  - spec: architecture/reference-cli#ADR validation (`decisions/`)
  - spec: architecture/file-formats#6.2 ADR validation rules
  - file: packages/cli/src/config.ts
  - file: packages/cli/src/decisions/validate.ts
---

## Goal

Implement the new config and ADR validation rules with the feature-spec message texts.

## Acceptance criteria

- [x] `feature/configuration` Scenarios 6, 7, 8 pass: `worktree_dir` inside the repository is an error only with the worktree backend; spec root paths that are missing, not a directory, or outside the repository are errors.
- [x] `feature/decisions` Scenarios 6 and 7 pass; `superseded_by` on a non-superseded ADR is a warning; a missing or unknown target uses the feature texts.
- [ ] `npm test` passes.

## Tasks

1. Extend `config.ts` checks; update the existing `worktree_dir` message.
2. Rework `decisions/validate.ts`; add cycle detection over `superseded_by`.
3. Add tests for each scenario.

## Guidance

- Spec root existence checks need the repository root; keep `loadConfig` callers that run outside a repository working.
