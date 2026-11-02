# Plan index step 1 final ignore-discovery repair

Checkout `/workspace/overnight/index-1-final`, branch `overnight/index-1-final`; base `54c7c2bc769df83d57b2b1294b932e6945dab790`, result `135161c7bb05d4a5d9c987c0f4e3907d0573615b`. Clean checkout; owned writers stopped. Changed only `packages/cli/src/generate/snapshot.ts` and `snapshot.test.ts`.

- Git ignore discovery now queries Git for each potentially relevant directory, skipping ignored trees unless they contain tracked plan paths, and only traversing plan and archive depths. Ancestor rules for tracked ignored plans remain captured. Symlink directories are not traversed; symlink rule files are not followed, matching Git; existing input containment remains intact.
- The real Git regression `working discovery skips excluded trees but retains rules for tracked and visible plans` reproduces the ignored tree with a dangling `.gitignore` symlink, verifies irrelevant rule replacement does not invalidate the snapshot, verifies ignored effective rule byte edits under tracked and visible directories invalidate rechecks, and verifies changed plan membership. Existing `ignored rule files are rechecked even when inventory is unchanged` tests root plan rule content and membership, and `external exclude and ancestor rules...` tests symlink containment. Existing working inventory test covers tracked ignored and nonignored new plans.
- Git's `check-ignore` exits 1 with no stderr for a nonmatch; the shared runner discards status, so the code recognizes its exact no-stderr wrapped error and propagates other failures. This depends on the shared runner's current error text; a future typed exit-status API could remove that coupling.

Validation (in `packages/cli`):
- `npm ci --offline --cache /workspace/.npm-cache --ignore-scripts`: passed, 23 packages.
- `npm run build`: passed after final edits.
- `timeout 90s node --test-reporter=tap dist/generate/snapshot.test.js`: final escalated run 13 passed, 0 failed, 0 skipped. An earlier escalated run had 6 passed, 7 failed due to mishandled `check-ignore` nonmatch exit; repaired and rerun. Initial sandboxed run stalled in a Git subprocess, was stopped by terminating only its owned process tree, exited 130 with no test output; escalation was approved, no rejection.
- `timeout 90s node --test-reporter=tap dist/config.test.js`: escalated, 22 passed, 0 failed, 0 skipped.
- `git diff --check`: passed before commit.

No full integrated suite, live host/model tests, managed lifecycle transitions, hosted operations or publication were run. Integrated regression and later step obligations remain with the coordinator. Timing not independently measured.
