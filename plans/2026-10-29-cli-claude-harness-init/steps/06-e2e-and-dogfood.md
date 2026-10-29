---
plan: 2026-10-29-cli-claude-harness-init
step: 6
title: End-to-end init and dogfood check
status: pending
context:
  - spec: claude:feature/claude-integration#Acceptance scenarios
  - spec: claude:architecture/claude-integration#Testing
  - spec: feature/tooling#Acceptance scenarios
  - file: packages/cli/test/
  - file: harnesses/claude/tests/
---

## Goal

Verify `init --harness claude` from the packed package and on this repository.

## Acceptance criteria

- [ ] An integration test installs the packed tarball into a temp prefix, runs `init --harness claude` in a fresh git repo, and asserts the file list, modes, merged settings, and the AGENTS.md block.
- [ ] A second run reports no `Updated` lines.
- [ ] Running `specplane init --harness claude` in this repository leaves `git status` clean, and `check-sync.sh`, `hooks.test.sh`, `specplane validate`, and `specplane spec pin --check` all pass.
- [ ] Any template difference found is fixed in the templates and the dogfood copies together.

## Tasks

1. Write the tarball-based test.
2. Run the dogfood checks and fix drift.

## Guidance

- If `init` would modify this repository's `.claude/` files, the templates are the source of truth; fix the dogfood copy.
