# HANDOFF — 2026-11-01-core-foundation

## Step 01: Trustworthy subprocess tests

**Date**: 2026-11-02
**Outcome**: done

### What changed

- `packages/cli/src/harness/codex.test.ts`: Remove inherited NODE_TEST_CONTEXT, require TAP execution counts and add broken-implementation regression through the same workflow fixture.
- `docs/work-records/2026-11-02-core-foundation-bootstrap.json`: Record authorized bootstrap destination, original ref, immutable start provenance, restoration conditions and observed test evidence.

### Deviations from the plan

User-authorized legacy CLI bootstrap; current recorder does not implement recording-set manifests or core execution receipts. Reviewed and explicitly staged the exact implementation/evidence files; CLI records plan progress.

### Gaps found in specs

None.

### Open issues

None.

### What the next step must know

npm run build passed; node --test dist/harness/codex.test.js passed 8/8. Correct child executed 1 passing test; broken child executed 1 failing test and was rejected by the outer fixture. git diff --check passed. These are observed manual CLI results, not core-issued receipts; full CLI suite and live host sessions were not run. Historical reports remain unchanged and are not retroactively verified. Context expanded to package/build configuration, shared workflow/commit contracts and CLI start/record implementation for bootstrap and recording. No new specification gaps. Start/target baseline: d6ec9bb71f242100147248b69c102d9a202f7a63 on dot/codex-integration-20261101. Keep local origin/HEAD on that branch until trustworthy target-binding reconciliation; preserve old conductor checkout and never resume it during bootstrap. Next is step 2, core boundary and compatibility; stop after this step as authorized.
