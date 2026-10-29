---
plan: 2026-10-29-assist-and-approve
step: 3
title: spec approve and spec reopen
status: pending
context:
  - spec: "feature/tooling#`specplane spec approve <id>...`"
  - spec: "feature/tooling#`specplane spec reopen <id>`"
  - spec: feature/spec-overlays#Base pins
  - spec: architecture/reference-cli
  - spec: architecture/file-formats
  - file: packages/cli/src/commands/spec.ts
  - file: packages/cli/src/commands/spec-pin.ts
  - file: packages/cli/src/commands/spec.test.ts
  - file: packages/cli/src/git/
---

## Goal

Let the user approve specs (re-pinning overlays) and reopen them with one command each, committed with the right trailers.

## Acceptance criteria

- [ ] `spec approve` refuses with the `feature/tooling` messages: unknown id, wrong status, uncommitted changes, unapproved feature specs, unapproved or unrefreshable bases, validation errors.
- [ ] Approving an overlay re-pins its bases in the same commit; several ids give one commit each and stop at the first refusal.
- [ ] Commits use `docs(specs): approve <id>` / `docs(specs): reopen <id>` with `Specplane-Workflow: approve` and the agent/session trailers when set; the user stays the author.
- [ ] `spec reopen` lists the dependants that can no longer stay approved, with their reopen commands, and changes nothing else.
- [ ] `--dry-run` prints the planned changes and commits nothing.
- [ ] `feature/tooling` Scenarios 7–9 have tests; `npm test` passes.

## Tasks

1. Implement both subcommands, reusing the pin and validation code.
2. Add tests from Scenarios 7–9 and the error cases.
