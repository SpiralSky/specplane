---
plan: 2026-11-16-llm-preset-creation
step: 10
title: Verify the whole change
---
## Goal

Run every check and fix what fails. Commands: `npx tsc --noEmit -p .` in `packages/cli` before every build, then `npm run build` and `npm test`; `sh harnesses/claude/tests/hooks.test.sh`; `sh harnesses/claude/tests/check-sync.sh`; `validate`.

## Acceptance criteria

- All checks pass; `validate` reports no errors.
- The specs named in the plan still match the code; any difference is fixed in the code or recorded as a gap.

## Tasks

1. Run the commands above and fix failures.
2. Check each acceptance criterion of PLAN.md against the code and tests.
3. Record gaps in the step handoff.

## Worker conventions (every step)

- Work only in this plan's worktree. Run `npx tsc --noEmit -p .` in `packages/cli` before every `npm run build`, then `npm test` (it builds first). Run `sh harnesses/claude/tests/hooks.test.sh` and `sh harnesses/claude/tests/check-sync.sh` whenever hooks, templates or `.claude/` files change; `docs/user` edits must pass `npm run build` (`validate-docs.mjs`, `build-command-docs`).
- Stage specific paths only (never `git add -A`; `demo.cast` is untracked). Commit messages follow `file-formats` §8 and end with the `Co-Authored-By` trailer given in the session context; add the `Specplane-Agent` and `Specplane-Session` trailers when those variables are set.
- Record gaps in the step handoff (`plan step-done`), not in code comments.
