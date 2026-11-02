# Target step 6 next context parity repair

Base: `3f3a515b789e9a542abaa89c41f8c4f1b3c0d177`. Branch: `overnight/target-6-next-context`. Result: `23a1508c031630c9e865808f66a9e0b7538467fe`. Checkout clean after commit; all owned test processes exited. Coordinator integrates.

Changed `packages/cli/src/plan/next.ts` and `packages/cli/src/plan/next.test.ts` only. Commit has the required Specplane trailers.

## Assigned criteria and evidence

- Resolve requested checkout decision independently: select the first sorted matching direct child `NNNN-*.md` under the configured decisions directory and validate only that file with the same ADR schema as selected-tree resolution. An unrelated malformed ADR no longer masks the requested valid ADR. The new CLI fixture compares retained checkout and remote-only selected tree with valid `0001` and malformed `0002` and verifies the valid path.
- Malformed requested ADR: the same fixture requests `0002`, verifies null path and its exact warning, and compares context and warnings between checkout and tree.
- Preserve context, gaps and human gates: targeted existing next, gaps, gate and step-done suite passed, including open gap and blocked/dirty human gate fixtures. No gap, lifecycle or step parsing behavior was changed. The review's pre-existing malformed-step ambiguity remains outside this assignment and unresolved.

## Commands and results

- `npm run build` initially failed (`tsc: not found`), before dependencies were installed. `npm ci --offline --cache /workspace/.npm-cache` passed (23 packages); subsequent `npm run build` passed.
- `timeout 100s node --test --test-concurrency=1 dist/plan/gaps.test.js dist/plan/next.test.js dist/plan/gate.test.js dist/plan/step-done.test.js` in `packages/cli`: sandboxed run started, printed two file-level successes and stalled in Git subprocess tests; interrupted with exit 130, no full result. Disposable test repositories were created under `/tmp`; no production files or refs were changed by tests. Same command with supported escalation passed 32/32, zero failed, skipped or cancelled, 41.4 seconds. No escalation rejection.
- `git diff --check` passed; checkout clean after commit.

Limitations: focused non-live tests only; no full suite, live host/model, or publication. This is a narrowly assigned parity repair, not full step 6 acceptance or formal lifecycle approval. Timing beyond test reporter not captured.
