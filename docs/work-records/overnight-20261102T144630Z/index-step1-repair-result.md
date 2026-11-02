# Plan index step 1 repair result

Checkout `/workspace/overnight/index-1-repair`, branch `overnight/index-1-repair`; base `6f46fa4b50f2ad65d5caea7e45d915248ecaa350`; result `54c7c2bc769df83d57b2b1294b932e6945dab790`. Writers stopped. Changed `packages/cli/src/generate/snapshot.ts`, `snapshot.test.ts`, `config.ts`, `git/exec.ts` (shared binary option).

## Criteria and review findings

1. Selected config/inventory, detached/unborn and staged changes: existing `three explicit sources`, `config and inventory`, `unborn and detached` tests; `snapshot branch validation...` covers root config, valid/invalid Git branch names and unsafe paths. Snapshot config branch validation now uses Git check-ref-format via shared runner without resolving revision expressions. Prospective paths reject noncanonical aliases before classification. `prospective canonical paths...` checks active/archive traversal, backslash, absolute and drive aliases, index preservation and valid deletion/addition. One UTF-8 byte comparator is used for captures and overlays; same test compares empty overlays and real committed overlays including mixed case, bytes and digest.
2. Working tracked/ignored/new inputs and refusal/recheck: existing `working includes`, `unmerged inputs`, `unmerged config`, `recheck detects` tests cover membership, conflicts, index, operation and output. Working capture now records all ancestor and descendant `.gitignore` files for the plans tree independently of ignored discovery, `info/exclude`, configured or default global excludes, and discovery. Tests `ignored rule files...` reproduce ignored rule file content edit with no membership change and rule edit changing membership; `external exclude and ancestor rules...` covers configured external excludes, ancestor rules and symlink containment. Directory walk checks symlink ancestors before traversal and does not follow nested symlink directories. Git calls use shared `git/exec.run` with binary output and GitError.

## Validation

- `npm ci --offline --cache /workspace/.npm-cache --ignore-scripts`: passed, 23 packages.
- `npm run build`: passed after final edits.
- `timeout 90s node --test-reporter=tap dist/generate/snapshot.test.js`: 12 passed, 0 failed, 0 skipped.
- `timeout 90s node --test-reporter=tap dist/config.test.js`: 22 passed, 0 failed, 0 skipped.
- `git diff --check`: passed.
- Focused local disposable Git fixtures only; no model, live host, publication or lifecycle operations. No escalation or approval failure. Full integrated regression remains for coordinator. Timing not independently measured.

## Remaining obligations

Step 2 owns command rendering, source/exclusions reporting, writer lease and recheck enforcement, staged recovery, output-unmerged refusal. Step 3 owns transaction integration and post-commit output equality. These are neither implemented nor verified by this step. Formal lifecycle acceptance remains for human review. Files under the plan and specs were not edited.
