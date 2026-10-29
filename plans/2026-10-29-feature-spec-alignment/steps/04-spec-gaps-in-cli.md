---
plan: 2026-10-29-feature-spec-alignment
step: 4
title: spec-gaps.md parsing, validation, and finish-flow listing
status: pending
context:
  - spec: feature/spec-precedence#Spec gaps record
  - spec: feature/plan-system
  - spec: feature/plan-steps
  - spec: architecture/file-formats#4. HANDOFF.md
  - spec: architecture/reference-cli#Plan parsing and validation (`plan/parse.ts`, `plan/validate.ts`)
  - spec: architecture/reference-cli#Finish
  - file: packages/cli/src/plan/parse.ts
  - file: packages/cli/src/plan/validate.ts
  - file: packages/cli/src/plan/flows.ts
---

## Goal

Make the CLI understand `spec-gaps.md` and repeated HANDOFF step sections.

## Acceptance criteria

- [ ] `validate` reports malformed entries in `<plans.dir>/<id>/spec-gaps.md` (heading, required fields, kind, status, duplicate `G<n>`), as specified in `architecture/file-formats`.
- [ ] `validate` accepts several `## Step NN` sections for one step and checks only the last one's `**Outcome**` against the step status.
- [ ] `plan finish` lists open entries (ID, kind, target spec) and does not block on them.
- [ ] Archived plans with `feature-spec-proposals.md` and no `spec-gaps.md` still validate.
- [ ] `npm test` passes.

## Tasks

1. Add a `spec-gaps.md` parser and checks.
2. Update the HANDOFF section check.
3. Add the finish-flow listing; tests.
