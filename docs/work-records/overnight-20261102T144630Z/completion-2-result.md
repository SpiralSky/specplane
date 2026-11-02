# Completion assessment step 2

- Checkout: `/workspace/overnight/completion-2`, branch `overnight/completion-2`; base `4dde314ae9d5ce9f06b43e11f15e014d41367cdd`.
- Commit: `c88c3dd8dc88b3683e492484bbb29520ec4be382` (clean checkout after commit).
- Completed 2026-11-02 14:59 UTC. Offline install `npm ci --offline --cache /workspace/.npm-cache` succeeded; `npm run build` succeeded.
- Focused command: `node --test --test-reporter=tap dist/core/completion.test.js dist/commands/spec.test.js dist/validate.test.js` in `packages/cli`, outside sandbox for temporary Git repositories. TAP v13: 47 passed, 0 failed, 0 skipped, approximately 8.2 seconds. Initial run: 45 passed, 1 failed due to legacy output-shape expectation; corrected and reran.

## Criteria mapping

- Declaration and four assessment states with ordered reasons: `core/completion.test.ts` assessment tests, `commands/spec.test.ts` list/show/validation parity and `validate.test.ts` output formats. Standard root resolver and working-tree snapshots are used; output retains original content and does not write files.
- Unavailable/unsupported dependencies precede mismatches while preserving known changes: `core/completion.test.ts` assessment precedence and membership tests, `commands/spec.test.ts` unavailable versus malformed metadata. Freshness findings are warnings and schema failures remain errors.
- Manual incomplete/partial or missing fingerprints report unrecorded; dependency coverage absent with nonempty closure is unverifiable. Historical fields are retained untouched and never labelled current.

## Limitations

No completion writers, model/host calls, publication, plan/status/handoff edits, or spec-body edits. No full-suite rerun was requested for this bounded step. No approval or integration is claimed. Snapshot evaluation cannot prove code or evidence validity. Dependency removal is not asserted when an unresolved graph leaves membership uncertain.

## Review repairs, 2026-11-02 15:03 UTC

Follow-up commit `2a082b6c6a083dcca6f37aac29851ee31e22c7c1` (clean checkout) separates current graph incompleteness from availability of recorded dependencies. A missing recorded dependency now reports both `dependency_removed` and `dependency_unavailable` when traversal establishes removal. Each list/show/validation assessment uses a captured inventory of spec bytes and path membership, so root content shown/parsed and all dependency resolutions use the same captured inputs. The inventory is assembled by sequential filesystem reads, not an atomic filesystem transaction.

Malformed dependency metadata now surfaces as a schema error, not an unavailable reason. If a valid root cannot be assessed because a dependency is malformed, validation emits a schema error for the affected root and omits that root's assessment rather than inventing a status. Added focused regression cases for the removal/unavailability combination, changes after inventory capture, and malformed dependencies. `npm run build` succeeded; focused TAP v13 command above passed 51/51 (0 failures, 0 skipped; 7.4 seconds). Earlier limitation about suppressing removal when the current graph is unresolved remains applicable, but unavailable recorded dependencies alone no longer suppress known removals.
