# Session handoff
Updated 2026-11-05 (S2). Branch `overnight/specplane-20261102T144630Z`; HEAD is the last commit on this branch (`git log -1`). Read `AGENTS.md` and `.specplane/config.yaml` first.

## Current state
- Only local `problems.md` is untracked; never stage it. Managed recording is deferred, so "complete" means implementation-complete on this branch.
- Last full verification (S2, after `c2ca9e7`): `cd packages/cli && npm test` ran on Bun with no Node fallback: 1077 pass, 0 fail, 106 files. `hooks.test.sh` 94 pass. `check-sync` OK. `specplane validate` 0 errors, 100 warnings, 80 files. `claude plugin validate` and `claude plugin test` were not rerun (nothing here records them as free of model calls; last result: validate passed with warnings, test 27 pass).
- Live host evidence (Claude 2.1.317, `harnesses/claude/host-evidence/2.1.317/`): the plugin loads and starts its server from `.claude/specplane/core` (D14, `${CLAUDE_PLUGIN_ROOT}`); the origin gate works (`origin-gate-check.txt`); a blocked result was recorded and the lease released (D22). Never shown live: a `done` result, a commit, a written spec, and the D24 prompt changes.
- `reasoning` stays `false` in `startNative`; reasoning commands and the completion tool are not registered. The six legacy reasoning skills stay (D10), so they own the names `/spec-assist`, `/plan-create`, `/plan-step`, `/plan-finish`, `/decision-new`, `/spec-draft-architecture` (D19).
- Built and committed offline: D14 installer staging; origin gate (D20 1 and 2, D21); compact MCP replies and close by binding (D20 3 to 5); D23 retry rule; D24 prompt/schema changes; D16 C (a plan-step with `testRequirements` is cancelled); D15 (`plan-finish` stays manual).
- Built against the applied spec, gated on a live check (S4): D17 A confirmation bridge (`MANUAL_WRITE_RULE` and D17 B stay active), D16 A reviewed suites (server not given the table, so D16 C stays active). D20 item 6 `specplane workflow list|recover` is PROVISIONAL on one point only (A3 vs R1, item 5).
- Spec edits A1 to A13 (architecture), R1 (reference-cli) and F1 to F4 (feature) are APPLIED by S1 under G1 as separate docs commits; all three specs are still `status: approved` (unchanged, not re-approved). Proposal: `docs/work-records/2026-11-05-claude-spec-edit-proposal.md`. `specplane validate` after: 0 errors, 100 warnings (+2 "may contradict" on feature line 48, from F3).
- Consumer suites: `harness/claude-consumer.test` (7) and `harness/codex-consumer.test` (7). A `done` plan-step is unreachable natively on Claude (unmapped criterion is `INVALID_EVIDENCE`, a mapped one is cancelled by D16 C). A consumer install shows `skill-drift` warnings because the skills cite `architecture/agent-skills`.
- The `problems.md` findings were rechecked in session 8 and are all fixed in source.
- Test runner notes: Bun 1.3.14 intermittently stalls at the end of a full parallel run (about half of runs on 2026-11-05; a worker spins inside Bun, root cause not named). `scripts/test.sh` runs Bun under a 180 s watchdog and on a stall reruns under `node --test` (`SPECPLANE_TEST_RUNNER=auto|bun|node`); the Node fallback skips 26 tests that load TypeScript source, including every `claude-handlers` test, so after a fallback also run `sh scripts/test.sh ./dist/harness/claude-handlers.test.js`. A second Bun failure was seen once: `EEXIST: file already exists, epoll_ctl` while loading `node:assert`, then `Cannot call test() after the test run has completed`, with 48 fail and only 510 of 1025 tests; it is not a stall and no fallback happens. Rerun once when that signature appears.
- Bun 1.4.4 (`/usr/bin/bun`; the installed one in `~/.bun/bin` is 1.3.14 and was not changed): the 3 `non-plan-workflow.test` failures are fixed. Cause: the test child ran `node -e "require('node:test').test(...)"`, `node` resolves to Bun under `bun test`, and Bun 1.4 refuses `test()` outside `bun test`. The child now prints the TAP itself (`5533c78`); the file passes 15/15 on both 1.3.14 and 1.4.4. The full suite has not been run on 1.4.4 since the fix, so upgrading is still unverified. 1.4.4 did not stall in 4 earlier runs.
- Not run: native macOS and Windows. `/tmp` is a RAM-backed tmpfs; keep `specplane-private-rewrite-20261103` there and remove other test leftovers.

## Needs the user
Every TEMPORARY (coordinator choice while you were offline) and PROVISIONAL (built, unapproved) item. Each is its own commit and easy to revert.
1. D11 TEMPORARY: accepted the risk that under `allowManagedHooksOnly` a user-tier plugin loads no hooks. Alternative: ship as managed.
2. D19 TEMPORARY: option B, keep the six legacy skills until the live path passes, then remove. Alternative: A, remove now. Blocks use of the reasoning commands in a normal install.
3. D24 TEMPORARY: the live run to see whether the model now reports unprompted was skipped. It needs your fresh approval.
4. D25 TEMPORARY: option 1, route B (`claude -p` through `$.process.spawn`) drafted as edit A13 in the proposal, nothing built. Alternatives: option 2 (`$.agent.spawn`, budget refused) or 3 (undelivered). Enablement needs your spec wording and a live probe. Revert by deleting A13.
5. D20 item 6 recovery: built and covered by the applied A3 and R1 except ONE contradiction, stopped on per the project rule (no spec edited, behaviour unchanged). A3 says `recover` "restores any recognised core-generated recording files from the durable record if recording had begun" and `list` prints the workflow; R1 and the build refuse a begun recording ("stays with the recording-recovery path") and `list` prints no workflow. Options: (a) change A3 to match R1 and the build (recommended: recovery that restores recording files is a larger, riskier feature, and the lease-only version is what R1's tests cover); (b) change R1 and build to restore files and print the workflow; (c) split: print the workflow now (small), keep begun-recording refused. Code labels stay PROVISIONAL on this point only. Alternatives to the whole design (automatic reclaim at `prepare`, manual lease deletion) were rejected in A3.
6. D17 A: the bridge and the mod's two-call flow match the applied `### Confirming finalised content` (field `confirmation`, `CONFIRMATION_REQUIRED` with `error.details.challenge`, once, until `expiresAt`, ended by decline/cancel/close). Needs only a live check (S4); `MANUAL_WRITE_RULE` and D17 B stay active until it passes. The TEMPORARY note in A6 (field name, alternative `confirm` tool) is still the user's to confirm.
7. D16 A, FOR YOUR REVIEW: `BUNDLED_SUITES` (`packages/cli/src/harness/claude-suites.ts`) now has 3 conservative entries, each `node --test --test-reporter=tap packages/cli/dist/<file>.test.js` run from the checkout (so they apply only to this repository, built): `claude-mcp-suites`, `claude-mcp-confirmation`, `workflow`. The suite id must equal a top-level test name in the report (the core matches ids to report suite names and the repo has no `describe`), so each id is one test's exact name and the whole file runs. A test checks the commands' shape and that each id exists in its file. Fixed a spec mismatch: `executeTest` now accepts optional `criterionIds` (subset, validated). Install entry: the table lives in the core `dist` the installer already stages, so nothing else to stage; the activation is one line in `claude-mcp-main.ts` (`suites: BUNDLED_SUITES`, comment placed there), left off because the applied spec keeps D16 C until the path is live-checked. Say if you want other suites, or the id/test-name coupling replaced.
8. Spec edits are applied (S1, G1); the specs are still `approved` at their pre-edit review: review the diffs `cd7b7f0`, `84f5b61`, `1ef0468` and re-approve with `/approve` if you accept them. S1 also ran `specplane spec pin` (`181574d`, `based_on` only). Wording notes: (a) proposal decision 4 says the reference-CLI edit was not drafted, but R1 is drafted and was applied; (b) R1 and the A3 recovery subsection disagree: A3 says `recover` restores recording files and `list` prints the workflow, R1 and the build do not; (c) A13 text replaced the 'No such adapter is delivered yet' sentence and the second paragraph of the adapter section, my reading of the ambiguous 'current text to replace'; (d) A3 and A6 carry TEMPORARY notes verbatim.
9. extension-conformance 02: review the implementation, then the pin refresh can be done.
10. Live runs for claude-delivery 03 criteria 1 and 3 and conformance row 4: each needs your approval; none retried (D18).
11. Upgrading to Bun 1.4.4: your call; run the full suite on it first.
12. Final reconciliation below, including the push.

## Authorized run (2026-11-05, user away about 1 h)
The user answered these directly on 2026-11-05. They cover this run only. Keep this section verbatim in every HANDOFF rewrite, ticking the session table, until the coordinator removes it.

Granted:
- G1 Spec edits: apply A1 to A13, R1 and F1 to F4 exactly as written in the proposal, as separate revertable docs commits. This is the user's approval of the F1 to F4 wording. It does not approve any spec: never change a `status:` field, and `/approve` stays with the user.
- G2 Live runs: one attempt per decision, never retried, at most 5 invocations in total: D25 probe, D24 unprompted-report check, claude-delivery 03 criteria 1 and 3, conformance row 4. Use the lowest practical budget and a throwaway fixture repo, not this checkout. Record each result, pass or fail, under `harnesses/claude/host-evidence/`.
- G3 Decisions confirmed as chosen: D11, D19 (remove the six skills only if a live `done` result passes), D25 option 1 (build route B), D20 item 6, the D17 A field, the D16 A command source. For the D16 A table use conservative entries from the repo's existing test commands, and flag them for the user's review.

Not granted, so do not do:
- Reconciliation is prepare-only: no managed recording, no `plan abandon`, no target-history repair, no push. Write the exact commands to `docs/work-records/2026-11-05-reconciliation-checklist.md`.
- extension-conformance 02 pin refresh: it still needs the user's implementation review (item 9).
- Bun upgrade: run the full suite on 1.4.4 and report it, but change no installed Bun.
- No approvals, no history rewrites, no `--no-verify`. If a hook or guard refuses an edit to an approved spec, or the edit needs a status change, stop that edit, record it in "Needs the user", and continue with what is not blocked. Never work around a refusal.

| Session | Work | State |
| --- | --- | --- |
| S1 | Apply G1 spec edits; `specplane validate` | done (`cd7b7f0`, `84f5b61`, `1ef0468`, `181574d`) |
| S2 | Review D17 A, D16 A and recovery builds against the applied specs; fill the D16 A table and wire the install entry; drop PROVISIONAL where the spec now covers it, keeping anything that needs a live check gated | done (`c2ca9e7`; recovery A3/R1 contradiction open) |
| S3 | Build the D25 route B session adapter offline (claude-delivery 03 criterion 1) | pending |
| S4 | G2 live runs; D19 removal if and only if `done` passed live | pending |
| S5 | Update conformance 01 and matrix from the evidence; full suite on Bun 1.4.4; write the reconciliation checklist | pending |
| S6 | Bug check: review all commits since `8aa96aa`, fix confirmed bugs with tests | pending |
| S7 | Second bug check on areas S6 did not cover plus S6's fixes; final full verification | pending |

## Open decisions
- D11, D19, D24, D25, D20 item 6, D17, D16: see "Needs the user".
- D13: partly settled. Confirmed: server path `.claude/specplane/core`; `${CLAUDE_PLUGIN_ROOT}` expands; the host lists `plugin:specplane:specplane` connected; `tool.check` fires for the mod's own `$.mcp.call` with `next.origin` `specplane`/`user` (the model's call reads `engine`/`core`). Wire names are `mcp__plugin_specplane_specplane__<tool>`. Unexplained: a second server entry named `specplane` (source plugin).
- D20 items 1 and 2 (host refuses the mod's own call under auto mode, prompts in default mode) are worked around by the gate; the mismatch is worth reporting to the host team. The nonce stays as a second check; removing it needs a server protocol change.

## Decided
- D14: keep `.claude/specplane/core`; the installer also stages `.claude-plugin/plugin.json`, `hooks/`, `types/`. Built and live-confirmed.
- D23 (user): an `INVALID_EVIDENCE` refusal keeps the request open, up to 3 attempts; any other refusal, a lost call or a `record` refusal ends it.
- D15: option B. D16: option C active. D17: target option A, B active. D10: the six skills stay until D16 A and D17 A are in place and the live path passes.
- D18 (resolved), D21, D22: fixed and live-checked as above. D12, D1 to D5, D7, D8, D9 (superseded by D11), D6 (superseded): unchanged.

## Steps
| Plan | Step | State | Note |
| --- | --- | --- | --- |
| workflow-recording | 04 | impl-complete; managed recording pending | Criteria 1-4 met; D1/D2 settled |
| manual-lifecycle | 02 | impl-complete; managed recording pending | trusted finish + checkout leases; forced dirty abandon stays UNSUPPORTED |
| manual-lifecycle | 03 | impl-complete; managed recording pending | criteria 1-3 met; D5/D6 resolved; worker lease delegation not built |
| product-docs | 01 | impl-complete; managed recording pending | both criteria met; `docs/bundle.test` |
| product-docs | 02 | impl-complete; managed recording pending | both criteria met; `docs/operations.test`; D7 |
| product-docs | 03 | impl-complete; managed recording pending | both criteria met; `docs/freshness.test` (7); D8 |
| extension-packaging | 01 | impl-complete; managed recording pending | all 3 criteria met; builder + prep tests |
| extension-packaging | 02 | impl-complete; managed recording pending | both criteria met; `harness/containment.transaction.test` (16) |
| extension-packaging | 03 | impl-complete; managed recording pending | all 4 criteria met; `harness/coexistence.test` (7) |
| claude-delivery | 01 | impl-complete offline; managed recording pending | declaration fixture for 2.1.317; no live evidence |
| claude-delivery | 02 | impl-complete offline; managed recording pending | all 4 criteria met offline (criterion 3 now covered by the completion/validate/plan-status/plan-start handler test); no live-host evidence for the mechanical commands; D10 mechanical skills removed |
| claude-delivery | 03 | partial; blocked (D19) | Criterion 2 met (`claude-package` capability tests: flags false, no capability from fixtures). Criterion 1 not met: lease/cancel/close covered offline and one blocked result live, but no launch/resume/budget adapter exists and a done result was never shown live. Criterion 3 offline part met: `harness/claude-consumer.test` (7); target-aware flow is the plan-step branch sync and diverged-remote cases; live evidence for it is absent. Criterion 1 adapter blocked on D25. Also blocked on D19 and live runs (need approval) |
| codex-delivery | 01 | impl-complete; managed recording pending | all 3 criteria met by `core/workflow-runner.test`; no live Codex claim |
| codex-delivery | 02 | impl-complete; managed recording pending | all 4 criteria met; `harness/codex-package.test` (6) |
| codex-delivery | 03 | impl-complete; managed recording pending | all 3 criteria met; `harness/codex-consumer.test` (7) |
| extension-conformance | 01 | partial; managed recording pending | 3 of 4 criteria met; the 4th (Claude workflows) is blocked on live-host delivery evidence. Rows stay not-delivered/pending; matrix reason names the live evidence that exists and the PROVISIONAL builds (`harness/conformance.test`) |
| extension-conformance | 02 | partial; managed recording pending | guards built (`harness/release-evidence.test` (4)); blocker text refreshed; the pin refresh was not done and awaits the user's implementation review |

## Next session
Follow "Authorized run": take the first pending session in its table (S3).

## How to continue (orchestration)
The user runs steps through a coordinator session that chains **Sonnet 5.5 subagents sequentially, one step per subagent**. Each subagent acts as a complete session.
- Prompt each subagent with: "Read HANDOFF.md and continue. First read `docs/work-records/session-contract.md` and follow it exactly." Add the step file, the HEAD commit, and any known context.
- The subagent commits, rewrites this file in the compact format, and returns a report of 200 words or fewer. The coordinator checks it with `git log` plus a focused test, without reading transcripts, and starts the next step.
- Report new D-entries to the user right away. The user has delegated technical decisions to the coordinator. Approvals, pushes and history rewrites stay with the user.

## Final reconciliation (after target-lifecycle and recovery work)
- Record work through the managed workflow. That includes target-lifecycle 02–06, plan-index 01–03 and completion-assessment 01–03, which were implemented earlier but never recorded, as well as the steps above.
- Run `plan abandon 2026-10-30-plan-conductor` from a checkout of the integration branch.
- Repair the "Legacy target history is ambiguous" state on target-lifecycle and core-foundation, then push once the user confirms.
- Optional: ask GitHub Support to purge unreferenced old commits that contain local paths (for example `3a5b997`). Delete `../specplane-backup-prerewrite-20261104.git` once the user is satisfied.

## Rules that matter
- Focused tests: `npm run build` in `packages/cli`, then `sh scripts/test.sh ./dist/<files>`. Never call `bun test` directly: the script supplies the `env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT` prefix and a per-run `TMPDIR` removed on exit, and direct runs leak fixtures into RAM-backed `/tmp`. Never `--concurrent`.
- Full suite: run `cd packages/cli && npm test` (Bun with automatic Node fallback); report which runner produced the result. A run that fell back to Node is a valid full-suite result for the 999 tests it runs; see the handler tests note under Current state.
- Never approve, push, rewrite history, or edit plan `status:`, step checkboxes or managed progress. Do not invent ADR kinds or contract text.
- Stage specific paths only; never `problems.md` or `AGENTS.override.md`. Preserve private backups and receipts.
- Cooperative lease-coordinated writers only; native and live-host evidence stays unrun until produced.
- Live invocations: one per decision, never retried. Each needs the user's approval (D18); the only current approval is G2 under "Authorized run".
