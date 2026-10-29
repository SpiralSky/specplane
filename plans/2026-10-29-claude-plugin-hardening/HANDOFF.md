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
