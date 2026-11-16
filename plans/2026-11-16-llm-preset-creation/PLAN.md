---
id: plan/2026-11-16-llm-preset-creation
title: LLM preset creation (R56.2), approval and retarget from the harness (R20.2, R31.3, R70), denied-command short circuit (R71)
authors:
  - llm: unknown
implements:
  - spec: feature/roles-and-permissions
    commit: 8452119c8333abc1b8082ec707f2478cf724ced0
    mode: implements
  - spec: architecture/reference-cli
    commit: 8452119c8333abc1b8082ec707f2478cf724ced0
    mode: implements
  - spec: architecture/file-formats
    commit: 8452119c8333abc1b8082ec707f2478cf724ced0
    mode: implements
  - spec: feature/harness
    commit: 8452119c8333abc1b8082ec707f2478cf724ced0
    mode: implements
  - spec: feature/plan-execution
    commit: 8452119c8333abc1b8082ec707f2478cf724ced0
    mode: implements
  - spec: architecture/agent-skills
    commit: 7eed2d9dbd80e18cb4a051568b720a9539c8808d
    mode: implements
---
# LLM preset creation (R56.2), approval and retarget from the harness (R20.2, R31.3, R70), denied-command short circuit (R71)

## Goal

Let the LLM role create a permission preset under the new permission `preset.create` (requirement R56.2): deny refuses, allow creates directly within the level rule, and request user sends the full preset with a preview that the user accepts or declines. Presets also become readable and creatable through the harness, which R25 already asks for.

## Scope

- In: the `preset.create` permission and its defaults in all four default presets; `presetCreate` for an LLM actor; harness actions `preset.list`, `preset.show`, `preset.create`; a requestable `preset create` with a preview; display of the preview in `requests show`, the Claude `/requests` pane and the arrival dialogue; steering text; tests and user docs.
- In (R70, R71): the typed approve command lists matching IDs for an inexact name and approves nothing; commands that start a model turn read a `Requires:` line from their contract and refuse at once when the LLM role has a required permission as deny.
- In (R20.2, R31.3): approving plans and decision records from the harness (typed and plain language); the permission and harness action `plan.retarget`, moved off `plan.resume`.
- Out: LLM editing or deleting presets, activating a preset (stays a `config set` request), custom roles, Codex-side dialogue (Codex has no popup).

## Specifications

Implements `feature/roles-and-permissions` (R56.2 and the R56 and R57 edits) and the matching sections of `architecture/reference-cli` (§7.5, §8, the harness action list) and `architecture/file-formats` (permission table). Requirement text: `docs/requirements/product-requirements.md` R56.2.

## Acceptance criteria

- `specplane permissions preset.create` documents the permission, and every default preset states request user for the LLM role.
- Deny refuses and stores no request; allow writes an uncommitted preset that states modes only for the LLM role and none above the LLM role's own; request user stores a request holding the full preset and its preview, writes nothing until accepted, and an accept by a role without `role.manage` is refused.
- A preset created this way is never active.
- Typed approve with `requirements` approves nothing, starts no model turn and lists the matching ID; with an exact ID it approves under the user's permissions. A command whose required permission is deny for the LLM role is refused before any model turn; allow and request user start it.
- `/approve <plan-id>` and the harness `spec.approve` approve a plan and a decision record; `plan.retarget` guards retarget, and a role with only `plan.resume` cannot retarget.
- `npx tsc --noEmit -p .` and `npm test` in `packages/cli` pass, `sh harnesses/claude/tests/hooks.test.sh` and `sh harnesses/claude/tests/check-sync.sh` pass, and `validate` reports no errors.

## Risks

- A preset the LLM creates could widen its own permissions; the level rule, the escalation check and the never-active rule are the guard, and each has a test.
- The preview layout must be one function used by every front end, or the three displays drift.

## Steps

01 Permission and defaults: add `preset.create` to the catalog and the default presets
02 Core: presetCreate for the LLM actor and the preview
03 Harness actions and the requestable preset create
04 Show the preview in the request displays and update the docs
05 R70: typed approve lists matches for an inexact name
06 R71: Requires lines in the contracts
07 R71: refuse denied commands before the model turn
08 Approve plans and decision records from the harness
09 Plan retargeting permission and harness action
10 Verify the whole change
