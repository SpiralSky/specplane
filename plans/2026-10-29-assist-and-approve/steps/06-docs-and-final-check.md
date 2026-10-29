---
plan: 2026-10-29-assist-and-approve
step: 6
title: Docs, final check, and the approval list
status: pending
context:
  - spec: feature/tooling
  - spec: claude:feature/claude-integration
  - file: README.md
  - file: packages/cli/README.md
  - file: CLAUDE.md
---

## Goal

Document the new roles and commands, run every check, and hand the user the list of specs still waiting for approval.

## Acceptance criteria

- [ ] README, `--help` text, and the maintainers' slash-command table describe `review`/`assist`, `spec approve`/`reopen`, `plan approve`, `decision new`/`accept`, and the five new slash commands.
- [ ] `npm test`, `check-sync.sh`, `hooks.test.sh`, `specplane validate` (0 errors), and `specplane spec pin --check` pass.
- [ ] HANDOFF lists every spec still in `review` (at least `architecture/agent-skills`, `reference-cli`, `repository-layout`, `ci`, and `claude:architecture/claude-integration`) with the single `/approve` command that approves them in order. The agent does not run it.
- [ ] Every open entry in this plan's `spec-gaps.md` is listed in HANDOFF for human review.

## Tasks

1. Update the docs.
2. Run the checks; write the approval list into HANDOFF.
