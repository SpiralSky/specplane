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

## Step 02: Core boundary and compatibility

**Date**: 2026-11-02
**Outcome**: done

### What changed

- `packages/cli/package.json`: expose and build the core entry
- `packages/cli/tsconfig.json`: emit public declarations
- `packages/cli/core-release.json`: define released core metadata
- `packages/cli/scripts/build-core-info.mjs`: generate immutable build metadata
- `packages/cli/src/core/build-info.d.ts`: type generated metadata
- `packages/cli/src/core/compatibility.ts`: validate package and host compatibility
- `packages/cli/src/core/compatibility.test.ts`: cover compatibility refusals and capability gating
- `packages/cli/src/core/contracts.ts`: define public contracts and ports
- `packages/cli/src/core/schemas.ts`: define closed shared schemas
- `packages/cli/src/core/index.ts`: expose import-safe boundary and explicit refusals
- `packages/cli/src/core/index.test.ts`: cover import and boundary validation

### Deviations from the plan

User-authorized bootstrap uses the installed legacy recorder, which lacks recording-set manifests and core execution receipts; the exact implementation files were reviewed and staged before recording.

### Gaps found in specs

None.

### Open issues

None.

### What the next step must know

Observed manual checks, not core-issued receipts: npm run build passed; direct core compatibility tests 5/5 and boundary tests 4/4 passed; packed external TypeScript consumer compiled and ESM import passed using existing Ajv dependencies; coordinator independently compiled without skipLibCheck. Targeted Codex regression passed 8/8 outside the sandbox after sandbox spawnSync git EPERM. Full npm test was interrupted after output stalled at its first file and is unverified. Fresh dependency installation was not tested. Package compatibility uses a complete package inventory excluding the self-referential extension manifest and inventory itself; the on-disk extension manifest is compared separately. Instruction assets bind orientation through specplane-orientation metadata. Mechanical/workflow operations explicitly refuse until implemented; leases, evidence semantics and live host certification remain future work. Context expanded to file formats, tooling and packaging/test code. No spec gaps were identified. Preserve bootstrap origin/HEAD and old conductor; stop after this step.
