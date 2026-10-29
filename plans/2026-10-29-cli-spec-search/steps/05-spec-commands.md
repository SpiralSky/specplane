---
plan: 2026-10-29-cli-spec-search
step: 5
title: spec new, list, show, validate
status: pending
context:
  - spec: feature/tooling#`specplane spec`
  - spec: feature/tooling#`specplane spec new <type> <slug>`
  - spec: feature/tooling#`specplane spec list`
  - spec: feature/tooling#`specplane spec show <id>`
  - spec: feature/tooling#`specplane spec validate [<id>...]`
  - spec: feature/spec-system
  - spec: feature/spec-overlays
  - spec: architecture/reference-cli#Spec resolution (`spec/resolve.ts`)
  - spec: architecture/file-formats#1.3 Feature spec template
  - spec: architecture/file-formats#1.4 Architecture spec template
  - file: packages/cli/src/commands/
  - file: packages/cli/src/spec/
---

## Goal

Implement `specplane spec new`, `list`, `show`, and `validate [<id>...]`.

## Acceptance criteria

- [ ] `spec new feature <slug> --title T` writes a draft spec with `author: user` that passes `validate`; `spec new architecture` without `--implements` exits 1 with "Architecture spec needs `--implements`." (non-interactive) .
- [ ] Existing ID, unknown root, and unknown type each exit 1 with the exact texts in `feature/tooling`.
- [ ] `spec list` filters by `--status`, `--type`, `--root` and prints the table or `--json` array with `id,title,status,author,root`.
- [ ] `spec show <id>` prints the file; an ambiguous ID exits 1 with the `<root>:<id>` hint; `--root` qualifies it.
- [ ] `spec validate` with no arguments equals the spec part of `validate`; with IDs it checks only those; `--json` matches the validation output format.
- [ ] Tests cover each command, including an overlay root.

## Tasks

1. Implement `src/commands/spec.ts` subcommands (extend the existing `spec pin`), using the spec templates for body scaffolding.
2. Prompt interactively only when stdin is a TTY; otherwise fail with the documented error.
3. Integration tests in a temp git repository with two roots.
4. Wire into `src/cli.ts`.

## Guidance

- Reuse `resolveSpec`, the parsers, and the validation functions from the core plan; do not duplicate logic.
- The new-spec ID check must include the extends chain.
