---
plan: 2026-10-29-claude-harness-files
step: 3
title: CLAUDE.md template, sync check, AGENTS.md, and dogfood install
status: done
use_subagent: true
context:
  - spec: claude:architecture/claude-integration#Files produced
  - spec: claude:architecture/claude-integration#Template source
  - spec: claude:architecture/claude-integration#Settings merge
  - spec: claude:architecture/claude-integration#Testing
  - spec: feature/agent-integration#Agent instructions
  - spec: feature/configuration
  - spec: architecture/file-formats#HANDOFF.md
  - file: .specplane/config.yaml
  - file: .claude/settings.local.json
---

## Goal

Write `templates/CLAUDE.md` and `tests/check-sync.sh`, write this repository's `AGENTS.md`, and install the templates into this repository.

## Acceptance criteria

- [x] `harnesses/claude/templates/CLAUDE.md` matches § CLAUDE.md structure.
- [x] `harnesses/claude/tests/check-sync.sh` (POSIX `sh`) maps each `templates/` file to its install path per § Template source, diffs it, and exits 1 listing differences or missing files; it skips `templates/settings.json` (merged, not copied) but checks that `.claude/settings.json` contains `specplane-pre-commit.sh`.
- [x] `.claude/skills/`, `.claude/hooks/` (mode 0755), and `CLAUDE.md` at the repo root are byte-identical copies of the templates; `sh harnesses/claude/tests/check-sync.sh` exits 0.
- [x] `.claude/settings.json` is created per § Settings merge (it is absent today); `.claude/settings.local.json` is unchanged.
- [x] `AGENTS.md` at the repo root covers all seven topics in `feature/agent-integration` § Contents of AGENTS.md, mentions `spec_roots`, `specs`, `plans`, `execution`, and `decisions`, references `feature/spec-policies` and `feature/spec-precedence` instead of restating them, and hardcodes no paths (it says paths come from config, giving defaults only as examples).
- [x] `sh harnesses/claude/tests/hooks.test.sh` still exits 0.

## Tasks

1. Write `templates/CLAUDE.md`.
2. Write `check-sync.sh`.
3. Write `AGENTS.md` (aim for 100–150 lines; a workflow guide, not a spec). The reference CLI core plan's `init` will reuse it as its template; write it repository-neutrally.
4. Copy the templates into place, create `.claude/settings.json`, set modes.
5. Run both test scripts.

## Guidance

- `check-sync.sh` should locate the repo root with `git rev-parse --show-toplevel` so it runs from any directory.
- Do not modify anything under `harnesses/claude/templates/skills/` or `templates/hooks/` in this step; if a template needs a fix, record it in HANDOFF.md as an open issue.
