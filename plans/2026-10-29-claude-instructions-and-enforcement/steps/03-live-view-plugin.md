---
plan: 2026-10-29-claude-instructions-and-enforcement
step: 3
title: Optional plugin — plans pane and Specplane mode
status: pending
context:
  - spec: claude:architecture/claude-integration#Live view and Specplane mode (optional plugin)
  - spec: claude:architecture/claude-integration#Worktree and cloud sessions
  - spec: architecture/reference-cli#Plan activity (`plan list --json`)
---

## Goal

Build the optional Claude Code plugin in `harnesses/claude/plugin/`: the Specplane plans pane, `/specplane`, `/specplane-mode`, and the `step`/`spec` modes.

## Acceptance criteria

- [ ] `claude plugin validate harnesses/claude/plugin` reports no errors; the module type-checks.
- [ ] The pane renders rows from a fixture `plan list --json --live` output (worktree, remote-only, blocked, ahead-of-remote cases) and, without the CLI, from the current checkout's step files.
- [ ] `step` mode is entered at session start on a `plan/<id>` branch; it denies edits outside the checkout, to other steps' files, and to `PLAN.md`, and shows the criteria band.
- [ ] `spec` mode adds the policy section and status text; `off` changes nothing.
- [ ] `claude plugin test harnesses/claude/plugin` passes, covering the cases above.

## Tasks

1. Load Claude Code's plugin-authoring guidance (the `plugin-authoring` skill) and scaffold the plugin.
2. Implement the data source (CLI with polling and fetch cadence; fallback reader).
3. Implement the pane, commands, modes, band, and status.
4. Write tests with fixtures; validate and test.

## Guidance

- Run this step attended (not as a subagent): it needs the user to enable the plugin and look at the pane.
- Keep the plugin read-only toward plan state: it never runs `plan start`, `finish`, or edits plan files.
