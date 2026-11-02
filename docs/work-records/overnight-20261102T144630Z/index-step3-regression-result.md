# Plan index step 3 integrated regression fixture repair

Checkout `/workspace/overnight/index-3-regression`, branch `overnight/index-3-regression`, base `e154d972ee7944bd8437bd337e083e1f97ba7969`. Result commits `967c2ac` and `d223a76` (HEAD). Writers stopped; owned changes limited to `packages/cli/src/commands/plan.test.ts`, `packages/cli/src/harness/codex.test.ts`, and `packages/cli/src/validate.test.ts`.

The coordinator's integrated run at base completed 593 tests, 582 passed and 11 failed, none skipped, duration 235623 ms (`/workspace/overnight/state/index-plan-integrated-tests.log`). Failures 49 and 224 used respectively unborn Git and no Git; failures 561, 564, 565, 568, 577–580 and 587 shared the validation helper outside Git. All failed because full validation now reports inability to check selected HEAD freshness as an error. Architecture/reference-cli snapshot selection expressly refuses unborn HEAD with staged/working guidance; plan-index requires no implicit source switch. Recovery reviewer accepted this behavior. This is a fixture repair, no source policy weakened.

- The plan-new fixture commits real configuration and existing input plans before creating the new draft. All original draft, dependency, acceptance criteria, steps, HANDOFF and validation assertions remain. Additional checks prove the new plan remains untracked and absent from HEAD, and the real CLI reports HEAD source and excluded new input. Validation can report a missing index warning; it still must have zero errors and exit 0.
- The Codex init fixture preserves existing idempotence, skill and user-owned configuration/instruction assertions; it commits only generated config to establish HEAD before full validation. No human approval or source plan mutation is asserted or simulated.
- The common validation helper commits the real fixture config to HEAD; test-provided spec/plan/step inputs remain in the working tree for the original domain checks. The selected committed snapshot has no plans and no index, which the freshness contract allows. No finding is filtered or mocked and all existing assertions remain. Specific malformed-config tests intentionally retain their separate fixtures.

Validation (all executed in `packages/cli`):
- `npm ci --offline --cache /workspace/.npm-cache`: passed with frozen lockfile.
- `npm run build`: passed after each change.
- Approved escalation: `timeout 120s node --test --test-concurrency=1 --test-reporter=tap dist/commands/plan.test.js dist/harness/codex.test.js`: 24 passed, 0 failed/skipped, log `/workspace/overnight/state/index-step3-regression-focused.log`.
- Approved escalation: `timeout 120s node --test --test-concurrency=1 --test-reporter=tap dist/validate.test.js`: 30 passed, 0 failed/skipped, log `/workspace/overnight/state/index-step3-regression-validate.log`.
- `git diff --check`: passed. No approval rejection occurred.

The full integrated suite was not rerun in this worker: the coordinator owned the original full run and will perform post-integration validation. These local disposable Git tests are not live host certification or formal lifecycle approval. No production code, spec, plan or handoff was changed.
