---
plan: 2026-11-16-llm-preset-creation
step: 3
title: Harness actions and the requestable preset create
---
## Goal

Add the harness actions `preset.list`, `preset.show` and `preset.create`, and make `preset create` a requestable action. Code: `packages/cli/src/harness/actions-ops.ts` (`config.set` is the model), `packages/cli/src/requests/requirements.ts` (`actionNeeds` and `requestPrecondition`), `packages/cli/src/requests/actions.ts` (the `ACTIONS` table), `packages/cli/src/requests/ops.ts` (lines about 106-117 recompute `diff` at show time for spec patches only; lines about 176-187 derive the accepter's needs). Spec: `architecture/reference-cli` §8 'Preset create requests'.

## Acceptance criteria

- The harness lists and shows presets and creates one under `preset.create`.
- `request_send` with `preset create` stores a request holding the full preset and the preview in `diff`; a malformed preset is refused when sent and stores nothing; deny stores nothing.
- Accepting runs `presetCreate` as the accepting person, so a role without `role.manage` is refused; `accept --commit` commits the preset file; the preset is not active afterwards.

## Tasks

1. Register the three harness actions with the permissions from the catalog.
2. Add `preset create` to `actionNeeds` (`preset.create`) with parameter validation in `requestPrecondition`.
3. Store the preview with the request and make the show path return a stored preview for a `preset create` request instead of recomputing (only spec requests are recomputed); do the same for the activation request in step 4.
4. Make the accept check use `config.change` and `role.manage` for a `preset create` request (a separate accept-time needs function or a command case at `ops.ts` about line 187), while the sender is checked on `preset.create`; test with a Standard User whose `role.manage` is not allow.
5. `requestPrecondition` also refuses a preset ID that exists or belongs to a default preset, and an unknown permission or mode; update any test that enumerates harness actions or the requestable commands.
6. Add the accept action that runs the core function for the accepter and returns the uncommitted file for `--commit`.
7. Write the tests for every mode and for the accept refusals.

## Worker conventions (every step)

- Work only in this plan's worktree. Run `npx tsc --noEmit -p .` in `packages/cli` before every `npm run build`, then `npm test` (it builds first). Run `sh harnesses/claude/tests/hooks.test.sh` and `sh harnesses/claude/tests/check-sync.sh` whenever hooks, templates or `.claude/` files change; `docs/user` edits must pass `npm run build` (`validate-docs.mjs`, `build-command-docs`).
- Stage specific paths only (never `git add -A`; `demo.cast` is untracked). Commit messages follow `file-formats` §8 and end with the `Co-Authored-By` trailer given in the session context; add the `Specplane-Agent` and `Specplane-Session` trailers when those variables are set.
- Record gaps in the step handoff (`plan step-done`), not in code comments.
