# Session handoff
Updated 2026-11-05T04:45Z. Branch `overnight/specplane-20261102T144630Z`; HEAD is the last commit on this branch (`git log -1`). Read `AGENTS.md` and `.specplane/config.yaml` first.

## Current state
- Only local `problems.md` is untracked; never stage it. Managed recording is deferred, so "complete" means implementation-complete on this branch.
- D14 built and committed: the installer stages `.claude/specplane/core` (package), `.claude-plugin/plugin.json`, `hooks/` and `types/` through the install transaction (`9553c2d`, `6782cd7`). The installed root now passes `claude plugin validate`.
- Live check run once (claude-delivery 03 run 3), recorded in `harnesses/claude/host-evidence/2.1.317/live-prepare-check.txt` (`f128b35`). The host loaded the plugin and started its server from `.claude/specplane/core`, so D14 and `${CLAUDE_PLUGIN_ROOT}` expansion are confirmed. The reasoning command was refused at the mod's origin gate (origin `sdk` under `claude -p`) before connect, bind or prepare. No lease was taken. Live check not passed; no retry (D18).
- Origin gate built and live-checked (evidence `harnesses/claude/host-evidence/2.1.317/origin-gate-check.txt`): `tool.check` answers `allow` for the mod's own server call and `deny` for any other, so `bind`, `prepare` and `detail` ran in auto and default mode with no classifier refusal and no prompt. The procedure now starts from the command alone (D21); completion, recording and lease release are live-checked for a blocked result (D22).
- `reasoning` stays `false` in `startNative`; reasoning commands and the completion tool are not registered. The flip was tested in fixtures only. D22 no longer blocks it; D19 still does, and D24 has no live check yet.
- The six legacy reasoning skills stay (D10). Installed with them, they own the names `/spec-assist`, `/plan-create`, `/plan-step`, `/plan-finish`, `/decision-new`, `/spec-draft-architecture`, so the mod would not register those commands (D19).
- D16 option C built in `f5bc57c`: the MCP server cancels a prepared `plan-step` whose criteria carry `testRequirements` and returns an error (test: `claude-mcp.test` D16 C case). D15 is enforced by the core refusal (`plan-finish` has no initiation).
- D20 items 3, 4, 5 fixed offline: `44072f9` (compact MCP replies, `detail` pages, validate by requestId, close by binding, oversize guard), `ea58453` (`.gitignore` entry for the host-written tsconfig). Max MCP reply measured in the realistic fixture test: under 16 KB (asserted per reply).
- Offline checks after these commits: focused suites 84 pass, 0 fail, 7 files (`claude-mcp` 11, `claude-handlers` 24, `harness` 12, `claude-package`, `conformance`, `containment.transaction`, `coexistence`). `claude plugin validate` passed with warnings; `claude plugin test` 27 pass. `hooks.test.sh` 94 pass. `check-sync` OK. `specplane validate` 0 errors, 98 warnings, 80 files. Full suite (`timeout 240 sh scripts/test.sh`): stalled, killed by the timeout with no summary; not rerun.
- D23 built in `ce5ecbd`, D24 in `af695ee` and `f45c739`. Full suite on `f45c739`: Bun 1032 pass, 0 fail, 102 files; no fallback. Focused 56 pass, 0 fail (5 files). `hooks.test.sh` 94 pass. `check-sync` OK. `specplane validate` 0 errors, 98 warnings, 80 files.
- Known test issues: Bun 1.3.14 intermittently stalls at the end of a full parallel run (about half of runs on 2026-11-05). Diagnosis (2026-11-05): a worker's main thread spins inside the Bun binary (`pthread_rwlock` hot, unreaped `git` zombie child); no Specplane busy-wait found; root cause not named (needs a symbolized Bun). Mitigation: `scripts/test.sh` runs Bun under a 180 s watchdog and, on a stall, reruns the whole suite under `node --test` (`SPECPLANE_TEST_RUNNER=auto|bun|node`). Verified: 3 auto runs = 2 Bun passes (1023/0) + 1 stall that fell back to Node (999 pass, 0 fail, 24 skipped); a forced fallback also passed. Bun 1.4.4 did not stall in 4 runs but fails 3 tests in `non-plan-workflow.test` because the child `bun --test-reporter=tap` command fails there; upgrading needs that fixed first.
- Second Bun 1.3.14 failure seen once (2026-11-05, on `418fd16`): `EEXIST: file already exists, epoll_ctl` while Bun loads `node:assert`, then `Cannot call test() after the test run has completed`; the run reports 48 fail, 96 errors, only 510 of 1025 tests. It is not a stall, so `scripts/test.sh` does not fall back. No test assertion failed: the rerun and a forced Node run on the same commit passed. Rerun once when that signature appears.
- The Node fallback skips 26 tests that load TypeScript source, including every `claude-handlers` test of the mod. After a fallback, also run `sh scripts/test.sh ./dist/harness/claude-handlers.test.js`, and rerun if it falls back too.
- Not run: native macOS and Windows.
- `/tmp` is a RAM-backed tmpfs here. Test leftovers reached 4.4 GB before `ba7087e`; they were removed on 2026-11-05. Keep `specplane-private-rewrite-20261103` there.

- Spec-edit proposal written (docs only, no spec body edited): `docs/work-records/2026-11-05-claude-spec-edit-proposal.md`. It has edits A1 to A12 for the architecture spec and suggestions F1 to F4 for the feature spec (`llm_role: assist`, so they need the user's approved wording). It carries TEMPORARY choices for the D17 A field, the D16 A command source and the D20 item 6 CLI shape.

## Open decisions
- D11: plugin ships an MCP server (option E). Open for the user: under `allowManagedHooksOnly` a user-tier plugin loads no hooks. Options: ship as managed, or accept the risk. Blocks nothing offline.
  TEMPORARY (coordinator, 2026-11-05, user offline; awaiting user review): accept the risk for now (user-tier plugin, no managed shipping). Alternative: ship as managed.
- D13: partly settled. Confirmed: server path under `.claude/specplane/core`; `${CLAUDE_PLUGIN_ROOT}` expands; host lists `plugin:specplane:specplane` connected. Confirmed 2026-11-05: `tool.check` fires for the mod's own `$.mcp.call`, with `next.origin` `specplane`/`user` (the model's call reads `engine`/`core`). Wire names are `mcp__plugin_specplane_specplane__<tool>`. Still unexplained: a second server entry named `specplane` (source plugin).
- D18: resolved by an agent-driven interactive check (user-approved; evidence `harnesses/claude/host-evidence/2.1.317/interactive-check.txt`). Lease held across calls by the server: confirmed. Six blockers found, recorded as D20.
- D20 (new, from the interactive check): before the native reasoning path can work: (1) FIXED and live-checked: under auto mode the host refused the mod's own `$.mcp.call` (classifier gave no verdict), though its declarations say the call needs no permission; the gate now answers `allow` itself. The mismatch is still worth reporting to the host team; (2) FIXED and live-checked: in default mode every mod call showed a permission prompt with all arguments, exposing the nonce; the same `allow` removes the prompt, and the gate now trusts `next.origin`, refusing a model call even with the nonce. The nonce stays as a second check; removing it needs a server protocol change; (3) FIXED offline (`ea58453`): the host-written `.claude/specplane/tsconfig.json` is git-ignored by the installer, not shipped, so the host's rewrite cannot dirty the baseline (test: `harness.test` claude gitignore case); (4) FIXED offline (`44072f9`): `prepare` replies compactly (requestId, workflow, status, detailChars); the full request stays server-side and is read in 2048-character `detail` pages; each reply is asserted under 16 KB (`claude-mcp.test` realistic fixture); (5) FIXED offline (`44072f9`): `close` without requestId closes every open request of the binding; the server cancels a prepare it cannot deliver; the mod closes on lost prepare, unreadable prepare or detail, and unreadable completion result (`claude-handlers.test`, parse failure and prepare-then-failure cases); (6) a session that ends with a request still open leaves the lease with host-worker evidence and needs explicit recovery, which has no CLI command. A closed request now releases before exit (D22 check), so item 6 covers only that case: design it with the spec edit (D17/D16).
- D21: FIXED and live-checked: the reasoning procedure did not start from the command alone, because a hook cannot submit and a command with no model turn raises no `turn.complete`. The command hook now schedules the submit with `$.clock.after` (`turn.complete` stays as a backstop), and the procedure started with no further prompt.
- D22: PASSED for a blocked result on the second approved run (evidence `origin-gate-check.txt`, "Recording check"). `validate`, `record` and `close` ran; a receipt was stored; the lease was gone before `/exit`. The model reported only after one typed instruction (D24). Not shown live: a `done` result, a commit, or a written spec (D17 B). The `acceptResult` "were closed" wording is fixed (`8e109c5`): it now says so only when `close` succeeded (test: `claude-handlers.test`).
- D24: FIXED offline, NOT live-checked (`af695ee`, `f45c739`; user chose all three parts). The recording check showed the procedure did not lead the model to a valid result. Now: the prompt carries a schema-valid `WorkflowResult` built from the request (`resultTemplate`, tested against `workflowResultSchema`) and an always-report rule; `spec-assist`, `spec-draft-architecture`, `plan-create` and `decision-new` prompts say to leave out `creation` and `finalizedEdits` and report `blocked` (D17 B; remove `MANUAL_WRITE_RULE` when D17 A lands); all six procedures read the request from the prompt and warn that the request's own lease refuses write commands; the core's schema refusal names the first failing field, never its value. A live run would show whether the model now reports unprompted; it needs fresh approval.
  TEMPORARY (coordinator, 2026-11-05, user offline; awaiting user review): live run skipped (no approval available); not a blocker for the spec draft.
- D19 (new, consequence of D10): in an install that keeps the six public skills, the reasoning commands are unregistered by collision even with the flip. Options: (A) remove the six skills now (conflicts with the D10 sequence); (B) keep them until the live path passes, then remove. Recommendation: B, matching the D10 sequence. Blocks normal-install use of the reasoning commands.
  TEMPORARY (coordinator, 2026-11-05, user offline; awaiting user review): option B (keep the six skills until the live path passes, then remove). Alternative: A.
- D17, D16, D15: decided (below). Architecture-spec edits for D17 A and D16 A are drafted in the proposal file and need the user's approval.
- D20 item 6 (design drafted): `specplane workflow list` and `specplane workflow recover <request-id>` with a typed-id terminal confirmation, in the proposal's A3. TEMPORARY (coordinator, 2026-11-05, user offline; awaiting user review). Alternatives: automatic reclaim at the next `prepare` (no stop proof), manual lease-file deletion. Needs a matching reference-cli spec edit; not built.
- Proposal finding: the architecture spec never says "in-process"; it is silent on the runner and lease location. The stale-text list in the proposal replaces the unverified one.

## Decided
- D14 (coordinator, 2026-11-04): keep `.claude/specplane/core`; the installer also stages the plugin root's `.claude-plugin/plugin.json`, `hooks/` and `types/`. Built and confirmed by the live run.
- D23 (user, 2026-11-05): option A. An `INVALID_EVIDENCE` refusal keeps the request open, up to 3 attempts; any other refusal, a lost call or a `record` refusal ends it. Built in `ce5ecbd`, confirmed live.
- D15: option B. `plan-finish` stays manual through the CLI; its native command refuses with the core message.
- D16: option C now (built, `f5bc57c`); later option A (the mod runs the reviewed suite with a host-fixed command; never model-supplied executables).
- D17: target option A (confirmation through the mod's dialog plus a protocol field). Needs an architecture-spec edit the user approves. Until then B: finalized edits and creation stay manual.
- D10 adjustment: the six legacy reasoning skills stay until D16 A and D17 A are in place; removal waits for the live path (D18).
- D12, D1, D2, D3, D4, D5, D7, D8, D9 (superseded by D11), D6 (superseded): unchanged from earlier sessions.

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
| claude-delivery | 02 | partial; managed recording pending | criteria 1, 3, 4 met offline; criterion 2 met for gates and coverage; D10 mechanical skills removed |
| claude-delivery | 03 | partial; blocked (D19) | D14 confirmed; lease held across calls and released by `close`; blocked result recorded live; reasoning off; six reasoning skills kept |
| codex-delivery | 01 | impl-complete; managed recording pending | all 3 criteria met by `core/workflow-runner.test`; no live Codex claim |
| codex-delivery | 02 | impl-complete; managed recording pending | all 4 criteria met; `harness/codex-package.test` (6) |
| codex-delivery | 03 | impl-complete; managed recording pending | all 3 criteria met; `harness/codex-consumer.test` (7) |
| extension-conformance | 01 | partial; managed recording pending | 3 of 4 criteria met; Claude rows pending and not-delivered (`harness/conformance.test` (8); matrix reason updated, D18) |
| extension-conformance | 02 | partial; managed recording pending | guards built (`harness/release-evidence.test` (4)); pin refresh awaits user implementation review |

## Next session
Any live run needs fresh approval; the D24 live run stays skipped (TEMPORARY, user offline). To log gate calls, do not use `require` in the hook; it wrote nothing.
The user reviews `docs/work-records/2026-11-05-claude-spec-edit-proposal.md` (decisions list at its top). After approval a session applies A1 to A12 (and F1 to F4 as approved) in one docs commit, then builds D17 A, D16 A and the recovery command offline as listed at the end of the proposal. Do not edit either approved `claude-integration.md` before then. Until then continue `extension-conformance` 01 Claude rows.

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
- Live invocations: one per decision, never retried. Each needs the user's approval now (D18).
