# Plan index step 1 worker result

Checkout /workspace/overnight/index-1, branch overnight/index-1. Base 9f405f1c789bd2d95287456abd5c557824f66ffe; result 6f46fa4b50f2ad65d5caea7e45d915248ecaa350. No writers remain. Changed `packages/cli/src/generate/snapshot.ts`, `snapshot.test.ts`, and `packages/cli/src/config.ts`.

## Original criteria and evidence

1. Each snapshot resolves its own config and plan inventory; detached/unborn HEAD and staged additions/deletions: `capturePlanSnapshot` captures HEAD commit tree, complete stage-0 entries, or current tracked/nonignored inventory and parses the selected config. Tests `three explicit sources...`, `config and inventory...`, `unborn and detached...` cover source-distinct bytes/config, unchanged stage-0, additions/deletions, detached and explicit unborn refusal/guidance.
2. Working includes tracked ignored and nonignored new plans; unresolved inputs and changed discovery/index bytes refuse safely: tests `working includes...`, `unmerged inputs...`, `unmerged config...`, `recheck detects...` exercise ignored tracked/untracked, deletions/new files, unresolved config/plan versus output-only conflicts, recheck after inventory/index/output/operation changes, and ignore changes. Containment and symlink refusal covered in the last two test cases. `preimage` captures index entries, operation metadata, output bytes, config and inventory/bytes and working discovery and ignore inputs; `recheckPlanSnapshot` repeats capture for use under the caller's writer lease. `excluded` supplies pending input paths for stderr, including PLAN.md paths under other configured directories.

`prospectivePlanSnapshot` supplies an explicit overlay on captured authoritative HEAD and rejects unrelated edits; it intentionally refuses a plans.dir change because a full tree is required to discover the new directory. The step-3 integration must replace shelve's temporary `prospectiveIndex` seam, recheck the captured base under its transaction lease, and verify committed HEAD output byte equality. Step 2 must consume the snapshot without re-reading current config/plan records, report source/exclusions on stderr, enforce `outputUnmerged` refusal for head writes and use staged recovery. Those command/transaction behaviors are outside this step and not claimed as tested. The snapshot captures operation identity and exposes conflict state but does not acquire a lease or write itself.

## Commands and outcomes

- `npm ci --offline --cache /workspace/.npm-cache --ignore-scripts`: passed, 23 packages installed locally.
- `npm run build`: passed after final changes.
- `timeout 60s node --test-reporter=tap dist/generate/snapshot.test.js`: 8 passed, 0 failed, 0 skipped.
- `timeout 60s node --test-reporter=tap dist/config.test.js`: 22 passed, 0 failed, 0 skipped.
- `git diff --check`: passed.
- Full suite not rerun by this focused worker; integration owns regression. Real Git repositories were disposable local fixtures; no model or live host calls made. No approvals failed or escalation requested. Managed plan records and statuses were not modified. Timing not independently measured.
