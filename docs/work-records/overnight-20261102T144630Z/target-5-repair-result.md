# Target lifecycle step 05 repair result

Checkout `/workspace/overnight/target-5`, branch `overnight/target-5`; base `49b8f2acfd605b32a214dd48287620b69404b41a`, result `a74278e8bb0199f96efb41b54a1754dcbc6757c8`. Owned files: `packages/cli/src/cli.ts`, `packages/cli/src/plan/context.ts`, `packages/cli/src/plan/retarget.ts`, `packages/cli/src/plan/retarget.test.ts`. Worktree clean after commit.

## Findings and evidence

- Destination and old target tips are selected exclusively from captured refs, with duplicate target captures removed; actual writes recheck those refs. Deterministic after-capture ref mutation refuses and preserves plan and index.
- Explicit `forge: github` without origin refuses preview and write, preserving plan and checkout. Local bare origins work under `forge: none`; no remote/auto also remains supported. A GitHub query specifies the origin repository with `--repo`, defeating GH_REPO/upstream selection, and is repeated during each pre-rename verification; a scripted base mutation refuses without writing. Origin URL is rechecked too.
- Human preview includes original start branch and commit, comparison baseline, changed paths and ref-change advisory, including no-op previews; CLI tests assert both forms.
- Git status-source mode refuses persisted active statuses other than ready on the plan, remote plan and target records; frontmatter mode permits ready/in_progress/review and differing active statuses. Historical evidence is checked using its own source mode. A focused test covers Git-mode rejection and frontmatter acceptance.
- Tests check pending-retarget refusal at actual `plan next` and `step-done` entry points; staged administrative refusal; preservation of staged/dirty unrelated implementation, plan bytes, index bytes, private runtime marker and recovery marker; preimage, lease and ref races; provenance, comments and body preservation. Existing wider target-5 result describes remaining criteria and prior verification.

## Validation

- `timeout 60s npm run build` (packages/cli): passed final build.
- Escalated `timeout 90s node --test --test-reporter=tap dist/plan/retarget.test.js`: final 19/19 passed, 0 failed/skipped, 9.45s. An earlier version ran 15/16 with one test invocation failure (missing required `step-done` CLI options); fixed invocation, then 17/17 passed before adding final tests. No implementation assertion was weakened.
- Escalated `timeout 90s node --test --test-reporter=tap dist/plan/context.test.js dist/core/index.test.js dist/core/writer-leases.test.js`: 23/23 passed, 0 failed/skipped, 1.11s. This preceded only additional local-origin handling and tests, which do not alter those modules.
- `git diff --check`: passed before commit. Git status after commit clean. No escalation rejection.

## Limitations

Forge queries are simulated, not live. Non-GitHub external origins and GitHub origins configured `forge: none` conservatively refuse because PR absence cannot be established; supported GitHub URL forms are HTTPS/HTTP, ssh URL using git user, and SCP-style git user. PR listing remains conservatively limited to fewer than 1000 results. Revalidation narrows but cannot eliminate a remote forge change after the final query and before rename without a forge-side transaction. No live host/model/forge calls, push, publication, lifecycle approval or full suite were run. The predecessor finish suite was not repeated because these edits do not affect it; original result records its 52/52 pass. No plan/spec/HANDOFF files changed. No additional contract gaps identified.
