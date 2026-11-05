# Session handoff
Updated 2026-11-05T04:05Z. Branch `overnight/specplane-20261102T144630Z`; HEAD is the last commit on this branch (`git log -1`). Read `AGENTS.md` and `.specplane/config.yaml` first.

## Current state
- Only local `problems.md` is untracked; never stage it. Managed recording is deferred, so "complete" means implementation-complete on this branch.
- D14 built and committed: the installer stages `.claude/specplane/core` (package), `.claude-plugin/plugin.json`, `hooks/` and `types/` through the install transaction (`9553c2d`, `6782cd7`). The installed root now passes `claude plugin validate`.
- Live check run once (claude-delivery 03 run 3), recorded in `harnesses/claude/host-evidence/2.1.317/live-prepare-check.txt` (`f128b35`). The host loaded the plugin and started its server from `.claude/specplane/core`, so D14 and `${CLAUDE_PLUGIN_ROOT}` expansion are confirmed. The reasoning command was refused at the mod's origin gate (origin `sdk` under `claude -p`) before connect, bind or prepare. No lease was taken. Live check not passed; no retry (D18).
- Origin gate built and live-checked (evidence `harnesses/claude/host-evidence/2.1.317/origin-gate-check.txt`): `tool.check` answers `allow` for the mod's own server call and `deny` for any other, so `bind`, `prepare` and `detail` ran in auto and default mode with no classifier refusal and no prompt. The procedure now starts from the command alone (D21); completion is fixed offline only (D22).
- `reasoning` stays `false` in `startNative`; reasoning commands and the completion tool are not registered. The flip was tested in the fixture only and reverted.
- The six legacy reasoning skills stay (D10). Installed with them, they own the names `/spec-assist`, `/plan-create`, `/plan-step`, `/plan-finish`, `/decision-new`, `/spec-draft-architecture`, so the mod would not register those commands (D19).
- D16 option C (refuse `testRequirements` in native `plan-step`) is not implemented. D15 is enforced by the core refusal.
- D20 items 3, 4, 5 fixed offline: `44072f9` (compact MCP replies, `detail` pages, validate by requestId, close by binding, oversize guard), `ea58453` (`.gitignore` entry for the host-written tsconfig). Max MCP reply measured in the realistic fixture test: under 16 KB (asserted per reply).
- Offline checks after these commits: focused suites 84 pass, 0 fail, 7 files (`claude-mcp` 11, `claude-handlers` 24, `harness` 12, `claude-package`, `conformance`, `containment.transaction`, `coexistence`). `claude plugin validate` passed with warnings; `claude plugin test` 27 pass. `hooks.test.sh` 94 pass. `check-sync` OK. `specplane validate` 0 errors, 98 warnings, 80 files. Full suite (`timeout 240 sh scripts/test.sh`): stalled, killed by the timeout with no summary; not rerun.
- Known test issues: Bun 1.3.14 intermittently stalls at the end of a full parallel run (about half of runs on 2026-11-05). Diagnosis (2026-11-05): a worker's main thread spins inside the Bun binary (`pthread_rwlock` hot, unreaped `git` zombie child); no Specplane busy-wait found; root cause not named (needs a symbolized Bun). Mitigation: `scripts/test.sh` runs Bun under a 180 s watchdog and, on a stall, reruns the whole suite under `node --test` (`SPECPLANE_TEST_RUNNER=auto|bun|node`). Verified: 3 auto runs = 2 Bun passes (1023/0) + 1 stall that fell back to Node (999 pass, 0 fail, 24 skipped); a forced fallback also passed. Bun 1.4.4 did not stall in 4 runs but fails 3 tests in `non-plan-workflow.test` because the child `bun --test-reporter=tap` command fails there; upgrading needs that fixed first.
- Second Bun 1.3.14 failure seen once (2026-11-05, on `418fd16`): `EEXIST: file already exists, epoll_ctl` while Bun loads `node:assert`, then `Cannot call test() after the test run has completed`; the run reports 48 fail, 96 errors, only 510 of 1025 tests. It is not a stall, so `scripts/test.sh` does not fall back. No test assertion failed: the rerun and a forced Node run on the same commit passed. Rerun once when that signature appears.
- The Node fallback skips 26 tests that load TypeScript source, including every `claude-handlers` test of the mod. After a fallback, also run `sh scripts/test.sh ./dist/harness/claude-handlers.test.js`, and rerun if it falls back too.
- Not run: native macOS and Windows.
- `/tmp` is a RAM-backed tmpfs here. Test leftovers reached 4.4 GB before `ba7087e`; they were removed on 2026-11-05. Keep `specplane-private-rewrite-20261103` there.

## Open decisions
- D11: plugin ships an MCP server (option E). Open for the user: under `allowManagedHooksOnly` a user-tier plugin loads no hooks. Options: ship as managed, or accept the risk. Blocks nothing offline.
- D13: partly settled. Confirmed: server path under `.claude/specplane/core`; `${CLAUDE_PLUGIN_ROOT}` expands; host lists `plugin:specplane:specplane` connected. Confirmed 2026-11-05: `tool.check` fires for the mod's own `$.mcp.call`, with `next.origin` `specplane`/`user` (the model's call reads `engine`/`core`). Wire names are `mcp__plugin_specplane_specplane__<tool>`. Still unexplained: a second server entry named `specplane` (source plugin).
- D18: resolved by an agent-driven interactive check (user-approved; evidence `harnesses/claude/host-evidence/2.1.317/interactive-check.txt`). Lease held across calls by the server: confirmed. Six blockers found, recorded as D20.
- D20 (new, from the interactive check): before the native reasoning path can work: (1) FIXED and live-checked: under auto mode the host refused the mod's own `$.mcp.call` (classifier gave no verdict), though its declarations say the call needs no permission; the gate now answers `allow` itself. The mismatch is still worth reporting to the host team; (2) FIXED and live-checked: in default mode every mod call showed a permission prompt with all arguments, exposing the nonce; the same `allow` removes the prompt, and the gate now trusts `next.origin`, refusing a model call even with the nonce. The nonce stays as a second check; removing it needs a server protocol change; (3) FIXED offline (`ea58453`): the host-written `.claude/specplane/tsconfig.json` is git-ignored by the installer, not shipped, so the host's rewrite cannot dirty the baseline (test: `harness.test` claude gitignore case); (4) FIXED offline (`44072f9`): `prepare` replies compactly (requestId, workflow, status, detailChars); the full request stays server-side and is read in 2048-character `detail` pages; each reply is asserted under 16 KB (`claude-mcp.test` realistic fixture); (5) FIXED offline (`44072f9`): `close` without requestId closes every open request of the binding; the server cancels a prepare it cannot deliver; the mod closes on lost prepare, unreadable prepare or detail, and unreadable completion result (`claude-handlers.test`, parse failure and prepare-then-failure cases); (6) after the session ends the lease stays with host-worker evidence and needs explicit recovery, which has no CLI command. Item 6 remains: design it with the spec edit (D17/D16).
- D21: FIXED and live-checked: the reasoning procedure did not start from the command alone, because a hook cannot submit and a command with no model turn raises no `turn.complete`. The command hook now schedules the submit with `$.clock.after` (`turn.complete` stays as a backstop), and the procedure started with no further prompt.
- D22 (new, from the D21 check): completion recorded nothing live. Causes: the hook read `e.input` although `tool.call` carries arguments beside `tool`; and only the command path connected, so `validate`, `record` and `close` stopped at "not connected". Both FIXED offline, NOT live-checked. Blocks the flip of `reasoning` until a live check, which needs the user's approval, shows a result recorded and `close` releasing the lease. Minor, not fixed: `acceptResult` says "were closed" without checking that `close` succeeded.
- D19 (new, consequence of D10): in an install that keeps the six public skills, the reasoning commands are unregistered by collision even with the flip. Options: (A) remove the six skills now (conflicts with the D10 sequence); (B) keep them until the live path passes, then remove. Recommendation: B, matching the D10 sequence. Blocks normal-install use of the reasoning commands.
- D17, D16, D15: decided (below). Architecture-spec edits for D17 A and D16 A need the user's approval.

## Decided
- D14 (coordinator, 2026-11-04): keep `.claude/specplane/core`; the installer also stages the plugin root's `.claude-plugin/plugin.json`, `hooks/` and `types/`. Built and confirmed by the live run.
- D15: option B. `plan-finish` stays manual through the CLI; its native command refuses with the core message.
- D16: option C now (not yet in code); later option A (the mod runs the reviewed suite with a host-fixed command; never model-supplied executables).
- D17: target option A (confirmation through the mod's dialog plus a protocol field). Needs an architecture-spec edit the user approves. Until then B: finalized edits and creation stay manual.
- D10 adjustment: the six legacy reasoning skills stay until D16 A and D17 A are in place; removal waits for the live path (D18).
- D12, D1, D2, D3, D4, D5, D7, D8, D9 (superseded by D11), D6 (superseded): unchanged from earlier sessions.

## Steps
| Plan | Step | State | Note |
| --- | --- | --- | --- |
| workflow-recording | 04 | impl-complete; managed recording pending | Criteria 1-4 met; D1/D2 open |
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
| claude-delivery | 03 | partial; blocked (D20, D19) | D14 confirmed; interactive check: lease held across calls, not released (D20); reasoning off; six reasoning skills kept |
| codex-delivery | 01 | impl-complete; managed recording pending | all 3 criteria met by `core/workflow-runner.test`; no live Codex claim |
| codex-delivery | 02 | impl-complete; managed recording pending | all 4 criteria met; `harness/codex-package.test` (6) |
| codex-delivery | 03 | impl-complete; managed recording pending | all 3 criteria met; `harness/codex-consumer.test` (7) |
| extension-conformance | 01 | partial; managed recording pending | 3 of 4 criteria met; Claude rows pending and not-delivered (`harness/conformance.test` (8); matrix reason updated, D18) |
| extension-conformance | 02 | partial; managed recording pending | guards built (`harness/release-evidence.test` (4)); pin refresh awaits user implementation review |

## Next session
Spec-draft edit must also list the new surface: the `detail` tool, `validate` by requestId, `close` without requestId, the installer's `.gitignore` entry, and the origin gate (`allow` for the mod's own call). Run the D22 live check first (rebuild a fixture as described in `origin-gate-check.txt`); its result decides how the draft describes completion and lease release.
Draft the combined Claude architecture-spec edit for the user's approval. It covers D17 option A (confirmation dialog plus protocol field), D16 option A (host-fixed test command), and the stale text listed below. Do not edit the spec body without that approval. Then continue `extension-conformance` 01 Claude rows.
Stale spec text to list (not verified line by line): `harnesses/claude/specifications/architecture/claude-integration.md` describes the reasoning and lease path as in-process; it is now the plugin MCP server (D11). Its plugin layout (about line 68) and hooks section (about line 445) may be stale, and it does not mention the `.claude/specplane` root, `types/` or D18. `harnesses/claude/specifications/features/claude-integration.md` lines 54-58 are the reasoning rows.

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
