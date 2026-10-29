---
plan: 2026-10-29-cli-spec-search
step: 3
title: Error classes, stderr convention, DEFAULT_CONFIG, ID pattern
status: pending
context:
  - spec: architecture/reference-cli#Error classes (`errors.ts`)
  - spec: architecture/reference-cli#Config loading (`config.ts`)
  - spec: architecture/reference-cli#Validation output format
  - spec: architecture/file-formats#1.1 Frontmatter JSON Schema
  - spec: feature/configuration
  - spec: feature/tooling#General conventions
  - file: packages/cli/src/errors.ts
  - file: packages/cli/src/config.ts
  - file: packages/cli/src/output/
  - file: packages/cli/src/cli.ts
---

## Goal

Implement the conventions fixed in step 01 so the new commands, and later plans, share them.

## Acceptance criteria

- [ ] `AlreadyExistsError` exists with exit code 1 and the message pattern from `architecture/reference-cli`.
- [ ] The top-level error handler writes errors and human reports to stderr and data to stdout; `validate --json` still writes only JSON to stdout.
- [ ] `DEFAULT_CONFIG` equals the `feature/configuration` defaults table; a test parses the table from the spec and compares.
- [ ] The ID regex rejects `feature//x`, `feature/x` where the slug has one character, and accepts valid IDs including `claude:feature/x`; schema and code share one constant.
- [ ] `npm test` passes and `specplane validate` still exits 0 on this repository.

## Tasks

1. Add `AlreadyExistsError` and make the CLI entry point route errors/reports to stderr.
2. Change `DEFAULT_CONFIG` to match the table and add the spec-table comparison test.
3. Extract the ID pattern to one constant, update the JSON Schema and parsers, add tests for edge IDs.
4. Re-run validate on the repository to confirm no existing ID is rejected.

## Guidance

- Keep exit codes per the error table; only the stream changes.
- If the defaults table cannot be parsed reliably, compare a hand-maintained fixture and note the gap in HANDOFF.
