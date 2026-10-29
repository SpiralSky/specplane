---
id: 2026-10-29-claude-instructions-and-enforcement
title: Claude harness — standing instructions, enforcement hooks, live view
status: ready
specs:
  - claude:feature/claude-integration
  - claude:architecture/claude-integration
  - feature/agent-integration
  - architecture/agent-skills
  - architecture/file-formats
depends_on:
  - 2026-10-29-claude-harness-files
---

# Claude harness — standing instructions, enforcement hooks, live view

## Goal

Rework the Claude Code harness files so Specplane never edits user-owned instruction files, enforces authorship policy with hooks instead of standing text, scopes each session to one plan step (local worktree, subagent, or cloud), uses the shared commit format, and offers an optional live view of all plans.

## Scope

- `templates/rules/specplane.md` (standing instructions); remove `templates/CLAUDE.md`.
- Skill updates: `plan-step` (fetch/diverge check, `architecture/file-formats` §8 commit, push), other skills' commit wording.
- Hooks: policy guard, session context, status line; handoff check reads trailers; new `settings.json` fragment; hook tests.
- This repository's dogfood copies: `.claude/rules/specplane.md`, `.claude/hooks/`, `.claude/settings.json`; `AGENTS.md` reduced to the managed block; root `CLAUDE.md` removed.
- Optional plugin under `harnesses/claude/plugin/`: plans pane, Specplane mode, tests.

## Non-goals

- CLI parts: `src/agents/standing.ts`, `init` block writing, freshness warning (reference CLI core plan, steps 03–04); `git/commit.ts`, `plan list --live` activity fields, and settings merge in `src/harness/claude.ts` (later CLI plans).
- Publishing the plugin to a marketplace.

## Specs implemented

| Spec | Coverage |
|------|----------|
| `claude:architecture/claude-integration` | § Files produced, § Standing instructions, § Hooks, § Worktree and cloud sessions, § Live view and Specplane mode, § Testing (hook and plugin parts) |
| `claude:feature/claude-integration` | Standing instructions, hooks, sessions in worktrees and the cloud, live view (once the proposed feature changes are applied) |
| `architecture/agent-skills` | § Standing instructions (text), § `plan-step` steps 1, 9, 10 |
| `architecture/file-formats` | §8 commit messages, as used by skills and hooks |
| `feature/agent-integration` | § Agent instructions (once the proposed feature changes are applied) |

## Acceptance criteria

- [ ] No template or dogfood file writes to or depends on `CLAUDE.md`; `AGENTS.md` in this repository is exactly the `v1` managed block.
- [ ] `sh harnesses/claude/tests/hooks.test.sh` exits 0 and covers every hook case in `claude:architecture/claude-integration` § Testing.
- [ ] `sh harnesses/claude/tests/check-sync.sh` exits 0 (templates ↔ `.claude/`, including `rules/`).
- [ ] The `plan-step` skill's commit instructions produce a message that `git interpret-trailers --parse` reads as the §8.2 trailers.
- [ ] `claude plugin validate harnesses/claude/plugin` and `claude plugin test harnesses/claude/plugin` pass.

## Risks

1. The plugin hook API is new and versioned with Claude Code; keep the plugin optional and isolated so a breaking change affects only it.
2. The policy guard's `ask` in non-interactive sessions behaves as a block; confirm with a headless test and record the behaviour.
3. YAML read with `awk` in hooks is limited to the simple layout `init` writes; unusual config layouts fall back to defaults (documented in the script header).

## Steps

1. `01-standing-instructions`: Rules file, AGENTS.md block, skill commit/sync changes, sync check.
2. `02-enforcement-hooks`: Policy guard, session context, status line, trailer-based handoff check, settings fragment, tests.
3. `03-live-view-plugin`: Optional plugin with plans pane and Specplane mode.
