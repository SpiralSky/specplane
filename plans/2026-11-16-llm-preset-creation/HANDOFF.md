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

## Step 02: Core presetCreate for the LLM actor

**Date**: 2026-11-16
**Outcome**: done

### What changed
- `packages/cli/src/perm/preset-ops.ts`: `mayManage` takes an action; the LLM role is guarded on `preset.create` for create only (edit and delete always refused), people still need `config.change` plus `role.manage`. New `llmCreateProblems` refuses a stated Standard User mode, a default above the active LLM default and any effective LLM mode above the active LLM mode. The audit records `preset.create`. New exported `presetPreview(draft, active)`; show and preview share one `layout()` formatter.
- `packages/cli/src/commands/preset.ts`: the command result uses `r.permission ?? "config.change"`.
- `packages/cli/src/perm/presets.test.ts`: tests for deny, allow with audit, refused Standard User mode, refused escalation (stated, default, `llm:*`), preview, unchanged person behaviour.

### Deviations from the step
None.

### Gaps found
- G2 (spec): with `--from`, the base's Standard User body is copied unchanged and only Standard User modes the LLM states are refused; otherwise copying a default preset would always fail on the Standard User default of allow.
- G3 (spec): Standard User effective modes from the preset default are bounded only through the draft-default check, not per permission.

### Open issues
- An LLM whose `preset.create` is request-user is refused in the CLI with a message that request creation is not available; sending the request is not implemented yet (harness step).
- `presetPreview` is exported but not wired to any CLI command or create output yet.
- Request `20261116T074439Z-81fb` (plan.resume) was sent by mistake while the plan was not stopped; it can be declined.

### What the next step must know
Commit f6054f9. tsc clean, `npm test` 706 pass, 0 fail. `presetCreate` accepts an LLM actor and returns `permission: "preset.create"` in `PresetResult`. `presetPreview(draft, activePreset)` returns per-role modes, default, roles and a more_permissive list, in the same text layout as `preset show`. The harness step must call it and send the request for the request-user case.
