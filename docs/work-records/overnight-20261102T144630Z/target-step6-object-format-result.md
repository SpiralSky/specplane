# Target lifecycle step 6: object format repair

Base: 271c90572b78aa8ef763cffb76276880aee7eb44. Branch: overnight/target-6-object-format. Result: c16c0e71c983675a1385b0190d0ca27469050742. Checkout settled, clean, no writers remain.

Changed files: packages/cli/src/plan/shelve.ts and packages/cli/src/plan/shelve.test.ts.

- Full canonical identity: detect repository SHA-1 or SHA-256, request the appropriate full commit output length, require the exact length, and resolve it as the same commit object. Unknown object formats are refused before commit. Existing final verification, lease, preview, ref and publication guards remain intact.
- Hook movement/recovery: use Git's final commit summary instead of current HEAD, so a post-commit branch move reports the retained object. Both disposable formats test a hook that prints a misleading commit-shaped line and moves HEAD; the error names the full created object, whose parent is verified.
- Publication/retry: both formats use a local bare remote and rejected pre-receive hook, assert exact full retained ID in error, move the remote to test reconciliation, preview retry and publish the same ID after removing the rejection. A subsequent resume succeeds. Existing SHA-1 scenarios remain covered.

Validation (packages/cli): `timeout 120s npm ci --offline --cache /workspace/.npm-cache --no-audit --no-fund` passed (23 packages); `timeout 120s npm run build` passed after final change; `timeout 120s node --test --test-concurrency=1 dist/plan/shelve.test.js` passed with supported escalation, 5 passed, 0 failed, 0 skipped (14.49 s). `git diff --check` passed. Earlier sandbox test started and was interrupted at 9.5 s due to a presumed stall, before its normal approximately 14 s completion; it reported an interrupted file-level failure, not a test assertion failure. No approval rejection occurred. First escalated run also passed 5/5 before the final hook-output strengthening. No live hosts or model tests were run or claimed. Full suite and plan-index integration are outside this focused repair; existing prospective index renderer seam remains for integration.
