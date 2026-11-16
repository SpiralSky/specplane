---
plan: 2026-11-16-llm-preset-creation
step: 3
title: Harness actions and the requestable preset create
---
## Goal

Add the harness actions `preset.list`, `preset.show` and `preset.create`, and make `preset create` a requestable action. Code: `packages/cli/src/harness/actions-ops.ts` (`config.set` is the model), `packages/cli/src/requests/requirements.ts` (`actionNeeds` and `requestPrecondition`), `packages/cli/src/requests/actions.ts` (the `ACTIONS` table). Spec: `architecture/reference-cli` §8 'Preset create requests'.

## Acceptance criteria

- The harness lists and shows presets and creates one under `preset.create`.
- `request_send` with `preset create` stores a request holding the full preset and the preview in `diff`; a malformed preset is refused when sent and stores nothing; deny stores nothing.
- Accepting runs `presetCreate` as the accepting person, so a role without `role.manage` is refused; `accept --commit` commits the preset file; the preset is not active afterwards.

## Tasks

1. Register the three harness actions with the permissions from the catalog.
2. Add `preset create` to `actionNeeds` (`preset.create`) with parameter validation in `requestPrecondition`.
3. Add the accept action that runs the core function for the accepter and returns the uncommitted file for `--commit`.
4. Write the tests for every mode and for the accept refusals.
