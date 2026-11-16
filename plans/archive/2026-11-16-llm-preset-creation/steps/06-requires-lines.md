---
plan: 2026-11-16-llm-preset-creation
step: 6
title: R71 Requires lines in the contracts
---
## Goal

Give the contracts that cannot do anything without a fixed permission a `Requires:` line and a matching "must not be deny" sentence, and a test that keeps them equal. Spec: `architecture/agent-skills` "Required permissions". Contracts: `harnesses/claude/templates/skills/specplane-*/SKILL.md` and `harnesses/codex/templates/contracts/*.md`. Lines: plan-create `plan.create`, plan-abandon `plan.abandon`, plan-finish `plan.complete`, validate, verify and spec-review `info.retrieve`. No line for spec-assist, spec-draft-architecture, decision-new, plan-step, migrate, plan-start, plan-status, approve and spec-view.

## Acceptance criteria

- Each listed contract has the `Requires:` line and the sentence in both harness template folders; the others have none.
- A test compares only contracts that have a `Requires:` line: the permission names in the line must equal those in the contract's "`X` must not be deny" sentence. The existing sentences in plan-status, plan-start, spec-assist, spec-draft-architecture and decision-new stay as they are and carry no `Requires:` line.
- `harnesses/claude/tests/check-sync.sh` passes: it byte-compares the templates with the dogfood copies, so copy each edited `harnesses/claude/templates/skills/specplane-*/SKILL.md` to `.claude/skills/specplane-*/SKILL.md` (check first that no guard hook blocks that write; if one does, stop and report).

## Tasks

1. Add the lines and any missing sentences (spec-review, plan-finish and verify currently lack the sentence).
2. Add the consistency test in `packages/cli/src/harness`.
3. Copy the edited Claude templates to `.claude/skills` and run `check-sync.sh`.

## Worker conventions (every step)

- Work only in this plan's worktree. Run `npx tsc --noEmit -p .` in `packages/cli` before every `npm run build`, then `npm test` (it builds first). Run `sh harnesses/claude/tests/hooks.test.sh` and `sh harnesses/claude/tests/check-sync.sh` whenever hooks, templates or `.claude/` files change; `docs/user` edits must pass `npm run build` (`validate-docs.mjs`, `build-command-docs`).
- Stage specific paths only (never `git add -A`; `demo.cast` is untracked). Commit messages follow `file-formats` §8 and end with the `Co-Authored-By` trailer given in the session context; add the `Specplane-Agent` and `Specplane-Session` trailers when those variables are set.
- Record gaps in the step handoff (`plan step-done`), not in code comments.
