---
plan: 2026-10-29-cli-spec-search
step: 1
title: Architecture spec edits for the command surface and conventions
status: done
context:
  - spec: architecture/reference-cli#Module structure
  - spec: architecture/reference-cli#Error classes (`errors.ts`)
  - spec: architecture/reference-cli#Architecture-leak guard (`spec/leak-guard.ts`)
  - spec: architecture/reference-cli#Config loading (`config.ts`)
  - spec: architecture/reference-cli#Spec validation (`spec/validate.ts`)
  - spec: architecture/file-formats#1.1 Frontmatter JSON Schema
  - spec: feature/tooling#`specplane spec`
  - spec: feature/tooling#`specplane init`
  - spec: feature/tooling#`specplane search <text>`
  - spec: feature/configuration
  - file: docs/specifications/architecture/reference-cli.md
  - file: docs/specifications/architecture/file-formats.md
---

## Goal

Resolve the deferred reference-cli and file-formats review findings that this plan implements, as architecture-spec edits, before any code.

## Acceptance criteria

- [x] `architecture/reference-cli` has sections for the `spec new/list/show/validate` and `search` commands (module, inputs, output shape, exit codes), and for `init` details (what is created, reporting lines, idempotence).
- [x] Error messages follow one pattern: the error-classes table uses the exact texts of `feature/tooling` ("Spec `<id>` already exists." and so on), and `PlanStateError` is reconciled with the feature texts for start/finish failures.
- [x] The table lists an `AlreadyExistsError` class; a note states human-readable reports and errors go to stderr, data (`--json`, `spec show`, `plan graph`) to stdout.
- [x] `DEFAULT_CONFIG` is described as a literal copy of the defaults table in `feature/configuration`, with a test requirement.
- [x] The leak guard section adds "JSON Schema" to the technology list and a bare-file-extension rule (names like `foo.ts`, `config.yaml`) with its exclusions; spec validation adds a deprecated-reference warning for `implements` and `extends`.
- [x] The ID pattern in `architecture/file-formats` forbids `//` and requires two or more characters after the type prefix, with examples.
- [x] All pins are refreshed; `specplane validate` and `specplane spec pin --check` pass.

## Tasks

1. Read the deferred findings under "reference-cli" and "file-formats" in the repo-root `HANDOFF.md`.
2. Edit `architecture/reference-cli`: add the command sections, error-class table row and conventions note, `DEFAULT_CONFIG` note, leak-guard and deprecated-reference rules.
3. Edit `architecture/file-formats` §1.1: tighten the ID pattern (both the schema and the prose).
4. Run the pin refresh and validation.

## Guidance

- Spec edits on a plan branch keep their `approved` status (`feature/plan-status`); do not change `status:`. Do not edit feature specs: they have `llm_role: assist`.
- After editing an approved base spec, run `specplane spec pin` for dependent overlay specs and skill contract comments that pin it (see `feature/spec-overlays` § Base pins), then `specplane spec pin --check`.
- Message texts must match `feature/tooling` verbatim; where the architecture disagrees with a feature text, the feature text wins and the architecture is corrected (`feature/spec-precedence`).
- Record any contradiction that cannot be resolved by an architecture edit as a gap in HANDOFF, and put it in step 02's proposal file.
