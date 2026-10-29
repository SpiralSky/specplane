---
plan: 2026-10-29-claude-instructions-and-enforcement
step: 1
title: Standing instructions, AGENTS.md block, and skill commit format
status: pending
use_subagent: true
context:
  - spec: architecture/agent-skills#Standing instructions
  - spec: architecture/agent-skills#plan-step
  - spec: architecture/file-formats#8. Commit messages
  - spec: claude:architecture/claude-integration#Files produced
  - spec: claude:architecture/claude-integration#Template source
  - spec: claude:architecture/claude-integration#Standing instructions (`.claude/rules/specplane.md`)
  - spec: claude:architecture/claude-integration#Worktree and cloud sessions
  - file: harnesses/claude/templates/
  - file: harnesses/claude/tests/check-sync.sh
---

## Goal

Deliver the standing instructions through `.claude/rules/specplane.md` and the `AGENTS.md` managed block, stop shipping `CLAUDE.md`, and bring the skills in line with the shared commit format and the one-session-per-plan rules.

## Acceptance criteria

- [ ] `templates/rules/specplane.md` is the `v1` standing text with the Claude Workflows line and the § Standing instructions Claude Code section; about 20 lines.
- [ ] `templates/CLAUDE.md` is deleted; this repository's root `CLAUDE.md` is deleted.
- [ ] This repository's `AGENTS.md` is exactly the managed block from `architecture/agent-skills` § Delivery with the harness-neutral Workflows line.
- [ ] The `plan-step` template follows `architecture/agent-skills` § plan-step steps 1 (fetch, fast-forward, stop on divergence), 9 (§8 commit with trailers, using `$SPECPLANE_AGENT`/`$SPECPLANE_SESSION` when set), and 10 (push when external or upstream exists).
- [ ] No template mentions the old `plan/<id> step NN:` subject format.
- [ ] Every skill's precondition checks only `.specplane/config.yaml` (not `AGENTS.md`).
- [ ] `check-sync.sh` maps `templates/rules/` to `.claude/rules/`, no longer checks `CLAUDE.md`, and exits 0 after the dogfood copies are updated.

## Tasks

1. Write `templates/rules/specplane.md`; delete `templates/CLAUDE.md`.
2. Update skill templates (commit format, plan-step steps 1/9/10, preconditions).
3. Replace this repository's `AGENTS.md` with the managed block; delete root `CLAUDE.md`.
4. Update `check-sync.sh`; copy templates to `.claude/`; run it.
5. Compose a sample step commit message by hand from the plan-step instructions and check it with `git interpret-trailers --parse`.

## Guidance

- Do not add `paths:` frontmatter to the rules file: it must load in every session.
- The block's begin marker line is exactly `<!-- specplane:begin v1 — managed by \`specplane init\`; edits inside this block are overwritten -->`.
