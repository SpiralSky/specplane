---
plan: 2026-10-29-cli-plan-commands
step: 5
title: Plan activity, plan list --live, generate --print --live
status: pending
context:
  - spec: architecture/reference-cli#Plan activity (`plan list --json`)
  - spec: feature/tooling#`specplane plan list [--status <status>]`
  - spec: feature/tooling#`specplane generate`
  - spec: feature/plan-index#Keeping `PLANS.md` fresh
  - spec: feature/plan-status#Effective status
  - file: packages/cli/src/plan/
  - file: packages/cli/src/commands/
---

## Goal

Implement the plan activity fields and `--live`/`--no-fetch` for `plan list`, plus `generate --print [--live]`.

## Acceptance criteria

- [ ] `plan list --json --live` includes `branch, checkout, backend, where, steps, blocked_issues, last_step_commit, ahead_of_remote` per the amended spec, including plans whose branch exists only on `origin`.
- [ ] Fetch happens at most once and is skipped with `--no-fetch` or without a remote.
- [ ] `generate --print` writes to stdout and not the file; `--live` marks live statuses in the printed output; plain `generate` output is byte-identical to before.
- [ ] No field throws in a repository without a remote or with a shallow history.
- [ ] Tests with a bare remote created in a temp directory.

## Tasks

1. Implement `plan/activity.ts` reading step files with `git show <branch>:<path>`.
2. Add `--live`, `--no-fetch` to `plan list` and `--print`, `--live` to `generate`.
3. Tests for local-only, remote-only, and no-remote cases.

## Guidance

- Pane/harness consumers read this JSON; keep key names exactly as specified.
