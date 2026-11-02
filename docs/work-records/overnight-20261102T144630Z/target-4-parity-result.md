# Target lifecycle step 4: restack preview parity repair

- Base: `050e5a6da520c5aec8fa5b9904f7253f26f21e45`
- Result: `5193b5dc510d3f44e27679f2065c3057f92336bc` on `overnight/target-4`.
- Changed: `packages/cli/src/plan/flows.ts`, `packages/cli/src/plan/lifecycle.test.ts`.
- Criterion: restack dry-run performs the ignored collision preflight before reporting a preview. Real execution retains its lease/ref recheck before the same preflight. Dry-run continues to avoid fetching and acquiring leases. The intermediate add/delete regression checks dry-run and execution both refuse and preserve exact ignored bytes, HEAD and index bytes; the existing squash-merge case checks a successful dry-run and unchanged branch head.
- `timeout 120s npm run build` in `packages/cli`: passed (exit 0).
- `timeout 120s node --test --test-name-pattern='restack' dist/plan/lifecycle.test.js`: sandboxed run started but stalled with no results; its owned process tree was terminated. No test pass/fail counts were emitted for that attempt. Test fixtures were disposable local repositories; partial temporary fixture effects may remain.
- Same focused command with supported `require_escalated`: passed, 8 tests, 0 failed, 0 skipped, 0 cancelled, 0 todo (25.875 seconds). Escalation was approved and execution started. No approval rejection.
- `git diff --check`: passed. Working tree clean after commit.
- No full suite or live forge/host/model tests run in this narrow repair; live certification remains deferred. No spec, plan, shared ledger or external publication changes.
