---
id: 2026-10-29-claude-harness-files
title: Claude Code harness files — skills, hooks, CLAUDE.md
status: done
specs:
  - claude:feature/claude-integration
  - claude:architecture/claude-integration
  - feature/agent-integration
  - architecture/agent-skills
depends_on: []
---

# Claude Code harness files — skills, hooks, CLAUDE.md

## Goal

Produce every file the Claude Code harness installs — the six skills, the hook scripts and their registration, and `CLAUDE.md` — as templates under `harnesses/claude/templates/`, with tests, and install them in this repository so it dogfoods the harness.

The files are markdown and POSIX shell and do not depend on the CLI: skills and hooks fall back gracefully when `specplane` is not installed. This plan therefore has no dependency on `2026-10-28-reference-cli-core`.

## Scope

- Six skill templates (`spec-assist`, `spec-draft-architecture`, `plan-create`, `plan-step`, `plan-finish`, `validate`).
- Hook scripts (`specplane-pre-commit.sh`, `specplane-handoff-check.sh`, `specplane-generate.sh`) and the `settings.json` registration fragment.
- `CLAUDE.md` template.
- `harnesses/claude/tests/hooks.test.sh` and `harnesses/claude/tests/check-sync.sh`.
- Dogfood install in this repository: `.claude/skills/`, `.claude/hooks/`, `.claude/settings.json`, `CLAUDE.md`, and the repository's `AGENTS.md`.

## Non-goals

- `specplane init --harness claude` and the `src/harness/` modules (a later plan that depends on the reference CLI core plan).
- The base `AGENTS.md` template used by `specplane init` (reference CLI core plan, step 04); this plan writes only this repository's own `AGENTS.md`.
- Resolving OQ-5; memory guidance follows its proposed default.

## Specs implemented

| Spec | Coverage |
|------|----------|
| `claude:feature/claude-integration` | Slash commands, subagents per step, hooks, CLAUDE.md, context loading |
| `claude:architecture/claude-integration` | All sections except § `specplane init` output → CLI implementation |
| `architecture/agent-skills` | Contract content of all six skills |
| `feature/agent-integration` | Workflow integrations; this repository's AGENTS.md |

## Acceptance criteria

- [ ] Each of the six `harnesses/claude/templates/skills/<name>/SKILL.md` files follows `claude:architecture/claude-integration` § Skill file format and restates its `architecture/agent-skills` contract without changing policy.
- [ ] `sh harnesses/claude/tests/hooks.test.sh` exits 0 and covers every case listed in `claude:architecture/claude-integration` § Testing.
- [ ] `sh harnesses/claude/tests/check-sync.sh` exits 0.
- [ ] This repository's `CLAUDE.md` points to `AGENTS.md` and lists the six slash commands; `AGENTS.md` covers the topics in `feature/agent-integration` § Contents of AGENTS.md and mentions every top-level config section.
- [ ] `.claude/settings.json` registers the pre-commit hook and leaves `.claude/settings.local.json` untouched.

## Risks

1. Claude Code skill frontmatter fields change — keep to `name`, `description`, `argument-hint`, `disable-model-invocation`.
2. `grep -E` portability of the commit pattern (GNU vs. BSD) — the tests run the exact regex; use only POSIX ERE.
3. The pre-commit hook is live in this repository once installed; it is a no-op until `specplane` is on `PATH`.

## Steps

1. `01-skill-templates`: The six SKILL.md templates.
2. `02-hooks-and-tests`: Hook scripts, settings fragment, hook tests.
3. `03-claude-md-and-dogfood`: CLAUDE.md template, sync check, AGENTS.md, dogfood install.
