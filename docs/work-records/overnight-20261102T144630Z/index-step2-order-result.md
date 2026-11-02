# Plan index step 2 ordering repair

Checkout `/workspace/overnight/index-2-order`, branch `overnight/index-2-order`; base `d9b1f2e44b51c3a13cc709d381c34048dac7d4f3`, result `843b208c79c9893cdfb9ffcec274b52660acc716`. Writers stopped, checkout clean. Changed `packages/cli/src/generate/plans-md.ts` and `packages/cli/src/generate/index-command.test.ts` only.

The renderer sorts the combined captured and additional records by ID with a locale-independent comparator before splitting active and archived sections. Existing uniqueness checks, live context requirements and status resolution remain intact. The discovery fixture covers IDs before and after the captured ID for both local and fetched remote refs, checks live rows and snapshot-only ordinary print, and compares working status, all `show-ref` values, HEAD commit and symbolic HEAD before and after live print. Refusal cases likewise check ref and HEAD preservation. A renderer test covers unordered archived additions and verifies the supplied records, captured plan bytes and digest remain unchanged. Existing purity and incomplete-live-context tests also passed. These are local simulated repositories; no live forge/host certification is implied.

Validation from `packages/cli`:

- `npm ci --offline --cache /workspace/.npm-cache --ignore-scripts`: passed, 23 packages.
- `npm run build`: passed.
- Approved escalation, `timeout 120s node --test-reporter=tap dist/generate/index-command.test.js`: 15 passed, 0 failed, 0 skipped, approximately 22.8 seconds.
- Approved escalation, `timeout 90s node --test-reporter=tap dist/generate/generate.test.js`: 9 passed, 0 failed, 0 skipped.
- `git diff --check`: passed before commit.

No approvals rejected. No full suite rerun, live host/model tests, remote fetch or publication. Existing step 3 freshness and lifecycle obligations remain as described in `/workspace/overnight/state/index-step2-review.md` and `/workspace/overnight/state/index-step2-repair-result.md`; no additional issue identified in this limited repair.
