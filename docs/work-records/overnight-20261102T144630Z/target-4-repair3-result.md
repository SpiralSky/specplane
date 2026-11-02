# Target lifecycle step 4 ignored-file repair

Checkout `/workspace/overnight/target-4`, branch `overnight/target-4`; base `cd8ee26d758899d8162615fc7a8964ab29943b8d`, result `050e5a6` (full identity available from Git). Changed `packages/cli/src/plan/flows.ts`, `finish.test.ts`, and `lifecycle.test.ts`.

- Finish and restack compare ignored checkout paths against both target checkout changes and every commit in the replay range, including deleted paths and both sides of renames via `--no-renames`; ancestor/descendant comparisons catch file/directory conflicts. Refusal occurs before rebase. Disposable-repository tests preserve exact path and binary bytes for intermediate add/delete in finish and restack, a directory collision, and a rename destination; original heads remain intact.
- Stored stack-base trailers are resolved as canonical existing commit IDs before use in replay ranges and rebase. Both finish and restack reject a noncanonical marker without rewriting; tests cover both.
- Finalization refuses before modifying the plan if ignored files inside its directory would move or the archive destination already exists; it rechecks immediately before the move. Tests preserve exact binary bytes and source path for preexisting and confirmation-callback-created ignored files, and preserve an ignored-only existing destination without nesting the plan. The error identifies the path and directs preservation or movement before retry. Existing rollback and phase reporting remain in place for later failures.
- Existing identity, confirmation, ref binding and recovery behavior is exercised by the affected regression suite. No source lifecycle commands, external forge/model/host calls, publication or pushes were performed.

Verification on final source (disposable local repositories; scripted confirmations, no live certification):
- `npm run build` in `packages/cli`: passed.
- `timeout 180s node --test dist/plan/finish.test.js dist/plan/lifecycle.test.js dist/plan/first-start.test.js dist/plan/prepare-start.test.js`: **99 passed, 0 failed, 0 skipped**, log `/workspace/overnight/state/target-4-repair3-settlement.log`.
- Focused final `timeout 90s node --test --test-name-pattern 'intermediate replay commits|ignored rename destination|ignored files, including|ignored-only archive destination|intermediate commits|noncanonical stored' dist/plan/finish.test.js dist/plan/lifecycle.test.js`: **7 passed, 0 failed, 0 skipped**, log `/workspace/overnight/state/target-4-repair3-settlement-focused.log`.
- `git diff --check`: passed. Tests and commit used supported escalation; no approval rejections. Initial malformed-marker fixture had two iterative failures (3/4 pass each); the fixture was corrected, and all final runs passed. Earlier 95-test and 97-test suites predate final edits and are not final coverage.

Limits: tests demonstrate cooperative-writer behavior and callbacks, not immunity to an unrelated process racing between a filesystem preflight and Git mutation. Full repository suite and live human/forge/host certification were not run; live certification remains deferred by policy. No owned test processes remain. Timing and token usage not captured.
