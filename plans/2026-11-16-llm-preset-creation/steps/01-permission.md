---
plan: 2026-11-16-llm-preset-creation
step: 1
title: Permission and defaults
---
## Goal

Add the permission `preset.create` and give it the mode request user for the LLM role in all four default presets. Code: `packages/cli/src/perm/catalog.ts` (`config.change` entry is the model), the default preset tables `llmModes()` and `PRESETS` in `packages/cli/src/perm/permissions.ts` (about lines 63-81; `perm/presets.ts` only reads custom presets; the Standard User needs no entry because its default is allow), steering generation, `docs/user/permissions.md`.

## Acceptance criteria

- `permissions preset.create` shows description, steering and the mode per default preset (request user for the LLM role).
- The test that every catalog permission has an entry in each preset passes.

## Tasks

1. Add the catalog entry with its description, not-allowed text and commands (`preset create`).
2. State `preset.create: request-user` for the LLM role in `llmModes()` so every default preset has it.
3. Add or extend the preset tests so a missing entry fails the build.
4. Document the permission in `docs/user/permissions.md`.

## Worker conventions (every step)

- Work only in this plan's worktree. Run `npx tsc --noEmit -p .` in `packages/cli` before every `npm run build`, then `npm test` (it builds first). Run `sh harnesses/claude/tests/hooks.test.sh` and `sh harnesses/claude/tests/check-sync.sh` whenever hooks, templates or `.claude/` files change; `docs/user` edits must pass `npm run build` (`validate-docs.mjs`, `build-command-docs`).
- Stage specific paths only (never `git add -A`; `demo.cast` is untracked). Commit messages follow `file-formats` §8 and end with the `Co-Authored-By` trailer given in the session context; add the `Specplane-Agent` and `Specplane-Session` trailers when those variables are set.
- Record gaps in the step handoff (`plan step-done`), not in code comments.
