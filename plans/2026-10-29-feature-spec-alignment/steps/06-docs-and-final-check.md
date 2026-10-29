---
plan: 2026-10-29-feature-spec-alignment
step: 6
title: Docs and final check
status: pending
context:
  - spec: feature/tooling
  - file: packages/cli/README.md
  - file: packages/cli/src/cli.ts
---

## Goal

Update the user docs and help text, and confirm the whole repository is green.

## Acceptance criteria

- [ ] README and `--help` text mention `--no-fetch`, `--kind`, `restack --dry-run`, and `spec-gaps.md`.
- [ ] `npm test`, `check-sync.sh`, `hooks.test.sh`, `specplane validate` (0 errors), and `specplane spec pin --check` pass.
- [ ] Every open entry in this plan's `spec-gaps.md` is listed in HANDOFF for human review.

## Tasks

1. Update docs and help text.
2. Run every check; fix what fails.
