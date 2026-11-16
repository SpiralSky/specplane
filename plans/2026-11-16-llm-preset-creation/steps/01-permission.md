---
plan: 2026-11-16-llm-preset-creation
step: 1
title: Permission and defaults
---
## Goal

Add the permission `preset.create` and give it the mode request user for the LLM role in all four default presets. Code: `packages/cli/src/perm/catalog.ts` (`config.change` entry is the model), the default preset tables in `packages/cli/src/perm/presets.ts`, steering generation, `docs/user/permissions.md`.

## Acceptance criteria

- `permissions preset.create` shows description, steering and the mode per default preset (request user for the LLM role).
- The test that every catalog permission has an entry in each preset passes.

## Tasks

1. Add the catalog entry with its description, not-allowed text and commands (`preset create`).
2. State `preset.create: request-user` for the LLM role in each default preset.
3. Add or extend the preset tests so a missing entry fails the build.
4. Document the permission in `docs/user/permissions.md`.
