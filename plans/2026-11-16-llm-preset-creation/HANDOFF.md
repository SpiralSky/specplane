## Step 01: Permission and defaults

**Date**: 2026-11-16
**Outcome**: done

### What changed
- `packages/cli/src/perm/catalog.ts`: catalog entry `preset.create` with description, not-allowed text and the command `preset create`.
- `packages/cli/src/perm/permissions.ts`: `preset.create` added to `CATALOG` and to `llmModes()` as `request-user`, so all four default presets state it; steering is generated from the catalog.
- `packages/cli/src/perm/permissions.test.ts`: `preset.create` added to the every-preset-states-a-mode list and the request-user common rules; a catalog permission missing from a default preset's LLM modes fails this test.
- `docs/user/permissions.md`: `### preset.create` entry and the per-preset sentence.

### Deviations from the step
None.

### Gaps found
- G1 (config): the active custom preset `.specplane/roles/presets/self-dev.yaml` has no `preset.create` line, so the LLM mode resolves to deny in this repo; left unchanged because custom presets are outside the step.

### Open issues
- `packages/cli/node_modules` in this worktree is an untracked symlink to the main checkout's copy, added so the build runs; do not commit it.

### What the next step must know
`preset.create` exists in the catalog and is request-user for the LLM role in every default preset (Standard User allow by default). `node packages/cli/dist/cli.js permissions preset.create` shows it. `architecture/file-formats` already listed the permission. Tests: tsc clean, `npm test` 701 pass, 0 fail at commit 87c1e9e. The declared spec tests for `feature/roles-and-permissions` have no runnable definitions, so `test.run` records nothing. To exercise the LLM path in this repo, the self-dev preset denies `preset.create` (G1).
