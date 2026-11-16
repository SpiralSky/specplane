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

## Step 03: Harness actions and the requestable preset create

**Date**: 2026-11-16
**Outcome**: done

### What changed
- `packages/cli/src/harness/actions-ops.ts`: harness actions `preset.list` and `preset.show` (`info.retrieve`) and `preset.create` (`preset.create`), the last through `presetParamsEdits` and `presetCreate`.
- `packages/cli/src/perm/preset-ops.ts`: `presetParamsEdits` (parameters to edits with problems) and `presetDraft` (refuses malformed parameters, an existing or default preset ID, unknown permissions or modes).
- `packages/cli/src/requests/requirements.ts`: `preset create` in `actionNeeds` (`preset.create`), `requestPrecondition` uses `presetDraft`, new `acceptNeeds` (`config.change` plus `role.manage` for accepting).
- `packages/cli/src/requests/ops.ts`: `sendRequest` stores the preview in `diff`; accept uses `acceptNeeds`; `show` already returns stored `diff` for non-spec requests.
- `packages/cli/src/requests/actions.ts`: `preset create` accept action runs `presetCreate` as the accepter and returns the uncommitted file for `--commit`.
- `packages/cli/src/requests/preset-requests.test.ts`: tests for send, malformed, existing ID, deny, accept, `--commit`, accept refusals, harness actions under each mode.
- `packages/cli/src/harness/actions.test.ts`, `actions-more.test.ts`, `mcp.test.ts`: action counts (46) and coverage of the new actions.

### Deviations from the step
None.

### Gaps found
None.

### Open issues
- Request `20261116T093954Z-baf1` (plan.resume) was sent by mistake again while the plan was not stopped (also `20261116T074439Z-81fb` in step 2); both can be declined.
- The self-dev preset still has no `preset.create` line (G1), so the LLM is denied in this repo.

### What the next step must know
Commit follows 4a125e0. tsc clean, `npm test` 721 pass, 0 fail. Requests of `preset create` store the full preview in `diff`; step 4 should reuse `storedPreview` in `requests/ops.ts` for the activation request. `step3.out` in the worktree root is an untracked scratch file; do not commit it. Do not call `plan.resume` unless the plan is stopped.

## Step 04: Show the preview and update the docs

**Date**: 2026-11-16
**Outcome**: done

### What changed
- `packages/cli/src/requests/ops.ts`: `storedPreview` also covers `config set permissions.preset <custom id>`, so the activation request stores the same preview in `diff`.
- `packages/cli/src/requests/preset-requests.test.ts`: test for the activation preview (stored, equal under `show`, null for other `config set` keys).
- `docs/user/commands.md`: `preset create` no longer says the LLM role may not; it states the LLM may only create, directly under allow or through a request under request-user.
- `docs/user/permissions.md`: the sentence on managing presets now carves out creation; the `preset.create` entry and the LLM permission list already existed from step 1.

### Deviations from the step
- Tasks 1 and 2 needed no code: `formatRequest` (`requests show`) and `dialogueText` in `harnesses/claude/plugin/hooks/commands.ts` already print `diff` verbatim, and step 3 stores the preview there. I did not add a dedicated test for the pane text.
- Steering text had nothing stale to edit.

### Gaps found
- G4 (spec): `harnesses/claude/specifications/architecture/claude-integration.md` could say that the dialogue shows a stored preset preview in `diff`; not edited, since a spec edit must go through `spec.edit`.

### Open issues
- Request `20261116T094912Z-ef71` (plan.resume) was sent by mistake again while the plan was not stopped; it can be declined, along with `20261116T074439Z-81fb` and `20261116T093954Z-baf1`.

### What the next step must know
tsc clean, `npm test` 722 pass, 0 fail (the build rebuilds the plugin); `harnesses/claude/tests/check-sync.sh` OK and `hooks.test.sh` 209 pass. `step3.out` and `step4.out` in the worktree root are untracked/modified scratch files; do not commit them. Do not call `plan.resume` unless the plan is stopped.

## Step 05: R70 typed approve lists matches for an inexact name

**Date**: 2026-11-16
**Outcome**: done

### What changed
- `packages/cli/src/spec/match.ts`: new mechanical matcher over the specification, plan and decision indexes (`candidates`, `isExactId`, `bestMatches` with at most ten results, `matchListing` grouped by kind).
- `packages/cli/src/commands/spec-human.ts`: `specApproveHuman` (used by CLI `approve`, harness `/approve` and `decision approve`) approves nothing and prints the match listing when any argument is not an exact ID; multiple arguments are joined into one name (`preset creation`).
- `packages/cli/src/spec/match.test.ts`: tests for exact, inexact, no match, multi-word names and the ten-match limit.
- `docs/user/commands.md`: paragraph on typed approve and inexact names.

### Deviations from the step
- The "not found. Known IDs" failure in `spec/human.ts` is unchanged: it stays for the LLM `spec.approve` action and `approveSpecs`, which the typed path now bypasses before reaching it. No edit to `harnesses/claude/plugin/hooks/commands.ts` was needed, since the `approve` entry already runs `specApproveHuman` with no model turn.

### Gaps found
- G5 (code): an exact plan ID counts as exact for the typed command, but `approveSpecs` does not approve plans (they use `plan approve`), so it still reports "not found" for one.

### Open issues
- Request from `plan.resume` called by mistake again this step (see the request ID in `requests`); it can be declined along with the earlier ones.

### What the next step must know
tsc clean, `npm test` 727 pass, 0 fail. Code commit follows f8bda89. `step4.out` and `step5.out` in the worktree root are scratch files; do not commit them. Do not call `plan.resume` unless the plan is stopped.

## Step 06: R71 Requires lines in the contracts

**Date**: 2026-11-16
**Outcome**: done

### What changed
- `harnesses/claude/templates/skills/specplane-{plan-create,plan-abandon,plan-finish,validate,verify,spec-review}/SKILL.md`, `harnesses/codex/templates/contracts/*.md`, `packages/cli/assets/commands/*.md`: added `Requires:` lines in Preconditions (`plan.create`, `plan.abandon`, `plan.complete`, `info.retrieve` ×3) and the missing "must not be deny" sentences for plan-finish, verify and spec-review.
- `.claude/skills/specplane-*/SKILL.md`: dogfood copies synced; `check-sync.sh` passes.
- `packages/cli/src/harness/requires-lines.test.ts`: checks that a contract's `Requires:` line equals its "`X` must not be deny" sentences, and that exactly the six listed contracts have a line.

### Deviations from the step
None.

### Gaps found
None.

### Open issues
- `config.test.ts` "this repository's own configuration is valid" fails (1 of 747) because commit `d2071ae` set `bypass_guards.headless_block: off`; the test only tolerates the `hook_protect` warning. Not caused by this step; the test's allowance needs widening to `headless_block` too.

### What the next step must know
The line format is exactly `Requires: \`perm\`.` on its own line in Preconditions, one or more backticked permissions; the regex used by the test is `/^Requires: (.+)\.$/m` with backticked names extracted. `readContract(command)` and `COMMANDS` in `packages/cli/src/harness/instructions.ts` read the embedded contracts from `packages/cli/assets/commands/`. Step 07 should parse the same line from the built templates.

## Step 07: R71 refuse denied commands before the model turn

**Date**: 2026-11-16
**Outcome**: done

### What changed
- `packages/cli/src/harness/requires.ts`: `requiresOf` parses a contract's `Requires:` line; `checkRequires` returns each required permission with the LLM role's mode and, for the first deny, the standard `guard` refusal text plus "No model turn started."
- `packages/cli/src/commands/harness.ts`: hidden read-only subcommand `specplane harness requires <command>` printing that check as JSON.
- `harnesses/claude/plugin/hooks/commands.ts`: `dispatch` calls the check before the `modelWithArgs` branch and returns the refusal as the command output (exit code 1, no prompt). A core that errors or returns non-JSON does not block the turn.
- `packages/cli/src/harness/requires.test.ts`, `packages/cli/src/harness/claude-plugin-commands.test.ts`: core tests and plugin-path tests for `plan-abandon` and `validate` (deny refuses, allow and request user start, a deny on a non-required permission and a command without a line start, a failing core starts); the old "no core call" test now expects only the requires call.
- `docs/user/harnesses.md`: paragraph on the check.

### Deviations from the step
- The check reads the embedded contracts in `packages/cli/assets/commands/` through `readContract` instead of `dist/templates`; step 06's test keeps those equal to the templates. It is a separate hidden subcommand `harness requires`, not `harness run requires`, because `harness run` refuses anything outside the command list.

### Gaps found
- G6 (spec): `feature/harness` R71 T1 has no deterministic test declaration, so `test.record` refuses it ("no matching deterministic test or verdict declared"); the result is not recorded.

### Open issues
- `config.test.ts` "this repository's own configuration is valid" still fails (1 of 754, `headless_block` off), unrelated to this step.

### What the next step must know
tsc clean; `npm test` 753 pass, 1 fail (the config test above); `hooks.test.sh` 209 pass; `check-sync.sh` OK. Code commit 33adea5. Scratch files `step*.out` and `driver.log` in the worktree root are not to be committed.

## Step 08: Approve plans and decision records from the harness

**Date**: 2026-11-16
**Outcome**: done

### What changed
- `packages/cli/src/spec/human.ts`: `approveSpecs` resolves IDs that are not a specification at the ref but are in the plans index as plans and calls `approvePlan`, so the guard and request name are `plan approve` (`spec.approve.feature`); a sent request comes back as a Result with its ID. Mixing a plan with specifications or decision records is refused; the decision path is unchanged. This covers CLI `spec approve`, the harness `spec.approve` action and the typed `/approve` (`specApproveHuman`).
- `packages/cli/src/plan/create.ts`: `approveInner` no longer refuses non-human actors; an LLM approval records `by: {llm, delegated-by}` as for specifications (needed for the allow case, `R52.3`/requirements line on plans and decision records).
- `packages/cli/src/harness/approve-plans.test.ts`: harness action in allow, request-user (and accepting the request) and deny; decision approval; the three mixed-kind refusals; typed command with an exact plan and decision ID and the inexact-name listing including plans.
- `docs/user/commands.md`, `packages/cli/src/commands/plan-cli.ts`: paragraph on plans and decision records (resolution order, mixing rule); dropped "a person only" from the `plan approve` help.

### Deviations from the step
- `approveInner` had to change to let an LLM with allow approve a plan; the step did not name it. The requirements page asks for exactly this behaviour.

### Gaps found
None. G5 from step 05 is fixed; `spec/match.ts` already listed plans and decision records.

### Open issues
- `config.test.ts` "this repository's own configuration is valid" still fails (1 of 757, `headless_block` off), unrelated to this step.

### What the next step must know
tsc clean; `npm test` 756 pass, 1 fail (the config test above); `npm run build` passes. Code commits f28595d and 3567112. The test shell sets `SPECPLANE_ACTOR=llm`, so tests that call `context()` for typed commands must clear and restore `SPECPLANE_*` variables (as `approve-plans.test.ts` does). Scratch files `step*.out` and `driver.log` in the worktree root are not to be committed.
