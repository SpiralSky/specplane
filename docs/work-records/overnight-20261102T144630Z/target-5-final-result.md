# Target lifecycle step 5 final repair

Checkout `/workspace/overnight/target-5`, branch `overnight/target-5`; base `a74278e8bb0199f96efb41b54a1754dcbc6757c8`, result `3f12e396347e4505d389ad3b84f0180994457538`. Seven changed files: `packages/cli/src/plan/{retarget.ts,retarget.test.ts,prepare-start.ts,prepare-start.test.ts,lifecycle-context.ts,lifecycle.test.ts,finish.test.ts}`. Worktree clean after commit.

- Final forge evidence queries now precede lease, captured-ref, path identity, mutation, checkout and recording-preimage checks on each verification; the final verification immediately precedes rename. A deterministic fake `gh` moves the destination ref during the third (final) query and confirms refusal with unchanged plan and index.
- Retarget, resume preparation, and finish/restack context accept active ready/in_progress/review stored states under Git mode for migration; first-start ready requirement, inactive/terminal guards, finish-specific done behavior, and downstream approval checks remain in place. Validation warnings are unchanged. Tests exercise mixed active snapshots and inactive records, first-start refusals, actual finish approval gate, restack preview and draft refusals. Existing schema rejects a shelved test record without shelved_from; this repair did not change mode-specific shelved_from validation.

Validation from `packages/cli`:
- `timeout 60s npm run build`: passed after final changes.
- Escalated `timeout 90s node --test --test-reporter=spec dist/plan/retarget.test.js dist/plan/prepare-start.test.js dist/validate.test.js`: 60 passed, 0 failed/skipped, including existing validation warning test and fake-forge test.
- Escalated `timeout 90s node --test --test-reporter=spec --test-name-pattern='finish reaches approval gate|finish rejects a draft branch' dist/plan/finish.test.js`: 2 passed, 0 failed/skipped.
- Escalated `timeout 90s node --test --test-reporter=spec --test-name-pattern='restack preview accepts migrated|restack refuses a draft target|restack: unmerged base' dist/plan/lifecycle.test.js`: 3 passed, 0 failed/skipped.
- `git diff --check` passed. Earlier sandbox test run failed with nested node spawn EPERM; escalation was approved and focused suites passed. Earlier new inactive-state assertions expected lifecycle error for malformed shelved records; corrected to assert the actual invalid-record refusal. Two initial append/edit commands used the wrong working directory and made no changes; corrected before final build.

Full finish/lifecycle and complete suite were not rerun; focused subsets listed above were run. Forge is simulated; forge evidence may change after the final query without an external transaction. No live forge/host/model calls, source lifecycle operations, push, publication, plan/spec edits or approval changes were performed. No escalation rejection. No owned process remains running.
