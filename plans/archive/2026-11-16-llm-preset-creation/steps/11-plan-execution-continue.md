---
plan: 2026-11-16-llm-preset-creation
step: 11
title: Plan execution continues between steps and reports an idle plan correctly
---
## Goal

Fix two gaps found when this plan ran. (1) A started session runs one step (`/specplane-plan-step <id>`) and exits cleanly, after which `plan/status.ts` (about line 95) reports `stopped [session ended unexpectedly]` because the run marker was cleared and steps remain; a clean end with steps left should read as idle between steps. (2) Nothing starts the next session, although requirement R27 says the user can execute all steps at once: after a session ends cleanly with steps left and no stop, the adapter should start the next one, sequentially, until the plan has no unfinished step, a stop is recorded or an optional step range is exhausted. The specs for this are written by the main session after steps 1 to 10 are done and approved before this step starts: read `feature/plan-execution` (R27 and the new text on continuing between steps) and `architecture/reference-cli` section 11 first; if they are not there yet, stop and report.

## Acceptance criteria

- After a clean session with steps left, status reads idle between steps and the next session starts without user input; a soft or hard stop, a failed session or a budget stop ends the chain.
- A step range or a single step can be requested and a selection that skips an unfinished step is refused (R27).
- Tests cover the chain, each stop kind, the range and the refusal; docs in `docs/user/plans.md` match.

## Tasks

1. Change the status computation so a clean end with steps left is not a failure stop.
2. Add the continuation loop in `packages/cli/src/harness/adapter-claude.ts` (the code after `child.exited`, about lines 215-225) and the launcher path in `packages/cli/src/harness/manual-session.ts` and `run.ts` as the specs say.
3. Write the tests and update `docs/user/plans.md` and `docs/user/harnesses.md`.

## Worker conventions

- Work only in this plan's worktree. Run `npx tsc --noEmit -p .` in `packages/cli` before every `npm run build`, then `npm test`. Run `sh harnesses/claude/tests/hooks.test.sh` and `sh harnesses/claude/tests/check-sync.sh` whenever hooks, templates or `.claude/` files change; docs edits must pass `npm run build`.
- Stage specific paths only (never `git add -A`). Commit messages follow `file-formats` section 8 and end with the `Co-Authored-By` trailer given in the session context.
- Record gaps in the step handoff (`plan step-done`).
