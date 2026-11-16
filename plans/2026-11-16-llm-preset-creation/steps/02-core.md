---
plan: 2026-11-16-llm-preset-creation
step: 2
title: Core presetCreate for the LLM actor
---
## Goal

Make `presetCreate` (`packages/cli/src/perm/preset-ops.ts`) work for an LLM actor under `preset.create`, and add a preview function. Spec: `feature/roles-and-permissions` R56.2 and `architecture/reference-cli` §7.5 (LLM creation bullet).

## Acceptance criteria

- For the LLM actor: deny refuses; allow writes the preset but refuses a stated Standard User mode and any mode above the LLM role's own in the active preset; the permission audited is `preset.create`.
- `presetPreview(draft, activePreset)` returns the per-role modes, the default mode and the modes more permissive than the active preset; person actors are unchanged.
- Tests cover deny, allow, refused Standard User mode, refused escalation and unchanged person behaviour.

## Tasks

1. Let `mayManage` take the permission from the actor: `preset.create` for the LLM role on create, `config.change` plus `role.manage` for people; edit and delete stay refused for the LLM.
2. Apply the level and escalation checks to LLM-created presets on effective modes, defaults included (a default mode above the LLM role's own, or any Standard User default, is refused).
3. Add `presetPreview` with one text layout shared with `preset show`.
4. Write the tests.
