# Target step 6 integrated fixture repair

- Checkout/branch: `/workspace/overnight/target-6-fixture`, `overnight/target-6-fixture`.
- Base: `3168c8c39eb2e9b6945bf587d6a21d36d38acd81`; result: `54b7966efe93463ece270187e1f1d8061126ffb9`.
- Changed: `packages/cli/src/harness/codex.test.ts` only. Clean tracked worktree after commit.
- Cause and repair: the disposable repository initializes `fixture-base`, with no default target. `plan new` now supplies `--target fixture-base`; its subsequent fixture commit contains the draft plan and spec on that branch before the experimental worktree calls `plan next`. The target snapshot is therefore present. No resolver, gate, plan, spec, or formal approval behavior changed.
- Criteria: manual experimental workflow and `action === none` remain intact; draft plan/spec equality, base HEAD and root isolation, clean worktree, actual positive child execution and the broken child failure assertions are retained. Both workflow tests passed in the focused suite.
- `timeout 120s npm ci --offline --cache /workspace/.npm-cache --no-audit --no-fund`: passed, 23 packages installed from frozen lockfile.
- `timeout 120s npm run build`: passed.
- `timeout 120s node --test dist/harness/codex.test.js`: sandboxed invocation failed at test-file level (1 failed, no individual test output); subsequently permitted escalated invocation passed 8/8, 0 failed, 0 skipped, duration 4.711 s. Both invocations completed; no remaining owned process.
- `git diff --check`: passed before commit. Full integrated regression remains coordinator-owned and was not duplicated. Live host certification and formal lifecycle approval deliberately deferred under overnight policy; no live model/host calls performed. No unresolved fixture blocker or spec gap identified.
