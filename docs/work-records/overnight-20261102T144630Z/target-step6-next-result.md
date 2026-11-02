# Target lifecycle step 6: next and execution guard repair

Base `febcb7d160b9617b69750ca4221b8ad225a55c8d`; branch `overnight/target-6-next`; result `e8c8163` (resolve full SHA with git). Changes are a review checkpoint, not managed lifecycle acceptance. No plan/spec/handoff edits, live host sessions, model calls, or publication.

Changed: `packages/cli/src/plan/next.ts`, `next.test.ts`, `step-done.ts`, `commands/plan.ts`.

- Selected snapshot: `planNext` selects validated local/remote branch commit, or selected target commit for unstarted plans; no unrelated invoking-file fallback. Without a selected branch checkout it reads step, gap and spec/file/decision context directly from Git trees with snapshot config. Bound local checkout still supplies work-in-progress files. `next.test.ts` remote-only test asserts differing step/context/gaps, no checkout, no ref mutation; unstarted test removes invoking copy. Both pass.
- Authority and guards: target lifecycle `shelved`, `abandoned`, `done` override branch; unavailable target fails closed. Dependencies are looked up on target and status uses target forge/config and recorded PR base. Target shelf forced `step-done` test confirms refusal without checkout mutation; branchless recording now also refuses unavailable authoritative target. Existing gate forced shelf test exists in predecessor (`shelve.test.ts`); current focused gate tests pass. The core conductor/recordWorkflow are stubs at this base, not evidence of live execution.
- Attention: live list now calls repaired resolver for selected remote/no-checkout branches; returns unavailable on errors. Remote-only fixture checks no fallback unavailable message. PR test uses a scripted local `gh`, verifies target dependency blocking before review, then review and `--base main`; this is simulated forge evidence, not a live service.
- Read operations never fetch or write. Target record/ref freshness and branch selection are the existing `activity.ts` validated snapshot machinery; diverged/unavailable refs fail closed. This work does not modify those shared files.

Evidence:
- `npm ci --offline --cache /workspace/.npm-cache` (packages/cli): passed, 23 packages.
- `npm run build` (packages/cli): passed after final changes. One intermediate build failed for the new test ENV typing, fixed and rebuilt.
- `timeout 100s node --test --test-concurrency=1 dist/plan/next.test.js dist/plan/gate.test.js dist/plan/step-done.test.js` with supported escalation: 25/25 passed after final production changes; two subsequent additive tests ran separately.
- `timeout 30s node --test --test-name-pattern='target shelving refuses' dist/plan/next.test.js` escalated: 1/1 passed.
- `timeout 35s node --test --test-name-pattern='target dependencies block' dist/plan/next.test.js` escalated: 1/1 passed.
- `git diff --check`: passed before commit.
- Initial sandbox subprocess run stalled, was stopped with SIGTERM on its owned timeout/node process tree; escalated retry passed. No approval rejection. All owned test commands exited.

Limitations / outstanding review: no dedicated non-default-target fixture in this change (scripted PR base fixture uses main); no new ref-freshness divergence or frontmatter-mode status matrix here; predecessor's shared lifecycle tests cover some cases but full step 6 requires independent integrated review and coverage. Snapshot gap parsing is local to `next.ts` because `gaps.ts` was outside ownership and should be reviewed for parser parity. Full suite, live host/model certification, formal lifecycle approvals, and publication were not run. Other step 6 ownership (transition recovery, cleanup/abandon, schemas/core) belongs to concurrent isolated workers; no claim their criteria are complete. Timing/token usage not captured.
