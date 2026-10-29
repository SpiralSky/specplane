# HANDOFF — 2026-10-29-claude-plugin-hardening

## Step 01: Rejection guards for gating hooks

**Date**: 2026-10-29
**Outcome**: done

### What was done
- `register.tsx`: added `gateDenial` (shared Edit/Write/MultiEdit step-mode gate; catches any failure, logs via `failureLog`, returns no denial = allow). The three handlers now call it.
- Bash refresh, the 60 s poll callback and `prompt.compose` mode read got inline try/catch with the same log sink; denial rules unchanged.
- `plugin.test.tsx`: tests inject a rejecting mode reader for each of the three tools and assert allow plus log; one test asserts denial still works.

### Deviations from the plan
- CHOICE: the plugin runtime rejects hooks that are not function literals ("hooks module did not load"), so a wrapper helper (`failOpen(...)`) is not possible; guards are inline try/catch plus the shared `gateDenial` helper.
- CHOICE: no logging API is documented for plugins, so failures go to `console.error` through an exported `failureLog.write` sink (replaceable in tests).
- CHOICE: rejection tests call `gateDenial` directly with an injected reader, because the test engine skips (not rejects) a throwing `on('state.get')` hook.

### Gaps found in specs
- CHOICE: the architecture spec does not say how plugin hooks log; left unspecified.

### Open issues
- `specplane` CLI is not installed here, so `specplane validate` (criterion 4) could not be run; there is no check for missing `.catch` guards that I could find.

### Context expansion
- Read `harnesses/claude/plugin/types/index.d.ts` and the spec's Specplane mode/Testing sections; plugin is not part of `templates/`, so no check-sync copy was needed.

Verification: `claude plugin test` 13 pass; `check-sync.sh` exit 0; `hooks.test.sh` 62 pass.

## Step 02: Read HANDOFF in claude -p

**Date**: 2026-10-29
**Outcome**: done

### What was done
- `register.tsx`: new exported `handoffAction`; interactive sessions fill the prompt with `Read <path>`, non-interactive ones (or a throwing fill) copy the path via `$.ui.copy`. The button label is "Copy HANDOFF path" when non-interactive. Interactivity is taken from `session.start`'s `isInteractive`.
- `claude-integration.md` (Plans pane): one sentence describing the non-interactive behaviour; status stays approved.
- `plugin.test.tsx`: tests for fill, copy, fill-throws fallback, and pane label in a non-interactive session (17 pass).

### Deviations from the plan
- CHOICE: detection uses `isInteractive` from `session.start` plus a try/catch around `$.prompt.fill`, since a no-op fill cannot be observed directly.
- CHOICE: non-interactive sessions copy the path (not plain text), reusing the `$.ui.copy` pattern of the other button.

### Gaps found in specs
- The Plans pane text did not cover non-interactive sessions; fixed by the spec edit above.

### Open issues
- Pins referencing `claude:architecture/claude-integration` need `specplane spec pin` (CLI not installed here); refresh at finish. Pin refresh criterion is therefore partly unverified.

### Context expansion
- Read `types/index.d.ts` and the architecture spec's Plans pane section.

Verification: `claude plugin test` (run from `harnesses/claude/plugin`) 17 pass; `check-sync.sh` exit 0.
