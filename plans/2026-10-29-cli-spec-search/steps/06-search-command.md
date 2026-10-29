---
plan: 2026-10-29-cli-spec-search
step: 6
title: search command
status: pending
context:
  - spec: feature/tooling#`specplane search <text>`
  - spec: feature/tooling#Acceptance scenarios
  - spec: architecture/reference-cli#Module structure
  - spec: architecture/reference-cli#Spec resolution (`spec/resolve.ts`)
  - file: packages/cli/src/commands/
  - file: packages/cli/src/output/
---

## Goal

Implement full-text search over spec and plan files with frontmatter filters.

## Acceptance criteria

- [ ] `specplane search "architecture-leak"` lists matching spec files with the matching line as a snippet (Scenario 5 in `feature/tooling`).
- [ ] `--type spec|plan`, `--status`, `--root` filter the results; `--json` emits an array of `{path,id,type,status,line,snippet}`.
- [ ] Matching is case-insensitive literal text; no matches exits 0 with no output.
- [ ] Archived plans are searched; results are sorted by path then line (deterministic).
- [ ] Tests cover each filter and JSON output.

## Tasks

1. Implement `src/commands/search.ts` over spec roots and `plans.dir` (including `archive/`).
2. Read frontmatter for the filters using the existing parsers; skip files that fail to parse and report them to stderr.
3. Wire into `src/cli.ts` and add tests.

## Guidance

- Do not shell out to `grep`; implement in Node for portability.
- Use `plans.dir` and spec roots from config.
