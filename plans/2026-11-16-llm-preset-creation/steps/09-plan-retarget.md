---
plan: 2026-11-16-llm-preset-creation
step: 9
title: Plan retargeting permission and harness action
---
## Goal

Add the permission `plan.retarget` and the harness action `plan.retarget`, and move retarget off `plan.resume`. Spec: `feature/plan-execution` R31.3, `architecture/reference-cli` ("Retarget" paragraph before "Active command"), `architecture/file-formats` (permission table and example preset). Code: `packages/cli/src/perm/catalog.ts`, `llmModes()` in `packages/cli/src/perm/permissions.ts` (request user for the LLM role in all four presets), the `retarget` core function in `packages/cli/src/plan/run.ts` and its CLI in `packages/cli/src/commands/plan-cli.ts`, `packages/cli/src/harness/actions-plan.ts` (`plan.resume` is the model), `packages/cli/src/requests/requirements.ts` (`plan retarget` currently needs `plan.resume`; it must need `plan.retarget`).

## Acceptance criteria

- `permissions plan.retarget` shows its documentation and the mode per default preset (request user for the LLM role).
- A retarget needs `plan.retarget`; a role with only `plan.resume` is refused, and resuming does not retarget.
- The harness `plan.retarget` works for a stopped plan whose target branch is gone, and the request form (`plan retarget`) needs `plan.retarget`.
- Existing presets and tests that gave retarget under `plan.resume` are updated; custom presets that state `plan.resume` keep working (unstated `plan.retarget` takes the preset default).

## Tasks

1. Add the catalog entry and the four preset defaults.
2. Switch the CLI, the core function and the request requirements to `plan.retarget`.
3. Add the harness action and tests for allow, request user, deny and the resume-only refusal.
4. Update `packages/cli/src/requests/requirements.test.ts` (about line 73) and add a test that a role with only `plan.resume` is refused. A custom preset that allowed retarget through `plan.resume` now refuses it until it states `plan.retarget`; say so in the docs.
5. Document it in `docs/user/permissions.md` and `docs/user/plans.md`.

## Worker conventions (every step)

- Work only in this plan's worktree. Run `npx tsc --noEmit -p .` in `packages/cli` before every `npm run build`, then `npm test` (it builds first). Run `sh harnesses/claude/tests/hooks.test.sh` and `sh harnesses/claude/tests/check-sync.sh` whenever hooks, templates or `.claude/` files change; `docs/user` edits must pass `npm run build` (`validate-docs.mjs`, `build-command-docs`).
- Stage specific paths only (never `git add -A`; `demo.cast` is untracked). Commit messages follow `file-formats` §8 and end with the `Co-Authored-By` trailer given in the session context; add the `Specplane-Agent` and `Specplane-Session` trailers when those variables are set.
- Record gaps in the step handoff (`plan step-done`), not in code comments.
