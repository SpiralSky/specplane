# Session handoff
Updated 2026-11-04T15:50Z. Branch `overnight/specplane-20261102T144630Z`; HEAD is the last commit on this branch (`git log -1`). Read `AGENTS.md` and `.specplane/config.yaml` first.

## Current state
- Only local `problems.md` is untracked; never stage it. Managed recording is deferred, so "complete" means implementation-complete on this branch.
- D14 built and committed: the installer stages `.claude/specplane/core` (package), `.claude-plugin/plugin.json`, `hooks/` and `types/` through the install transaction (`9553c2d`, `6782cd7`). The installed root now passes `claude plugin validate`.
- Live check run once (claude-delivery 03 run 3), recorded in `harnesses/claude/host-evidence/2.1.317/live-prepare-check.txt` (`f128b35`). The host loaded the plugin and started its server from `.claude/specplane/core`, so D14 and `${CLAUDE_PLUGIN_ROOT}` expansion are confirmed. The reasoning command was refused at the mod's origin gate (origin `sdk` under `claude -p`) before connect, bind or prepare. No lease was taken. Live check not passed; no retry (D18).
- `reasoning` stays `false` in `startNative`; reasoning commands and the completion tool are not registered. The flip was tested in the fixture only and reverted.
- The six legacy reasoning skills stay (D10). Installed with them, they own the names `/spec-assist`, `/plan-create`, `/plan-step`, `/plan-finish`, `/decision-new`, `/spec-draft-architecture`, so the mod would not register those commands (D19).
- D16 option C (refuse `testRequirements` in native `plan-step`) is not implemented. D15 is enforced by the core refusal.
- D20 items 3, 4, 5 fixed offline: `44072f9` (compact MCP replies, `detail` pages, validate by requestId, close by binding, oversize guard), `ea58453` (`.gitignore` entry for the host-written tsconfig). Max MCP reply measured in the realistic fixture test: under 16 KB (asserted per reply).
- Offline checks after these commits: focused suites 84 pass, 0 fail, 7 files (`claude-mcp` 11, `claude-handlers` 24, `harness` 12, `claude-package`, `conformance`, `containment.transaction`, `coexistence`). `claude plugin validate` passed with warnings; `claude plugin test` 27 pass. `hooks.test.sh` 94 pass. `check-sync` OK. `specplane validate` 0 errors, 98 warnings, 80 files. Full suite (`timeout 240 sh scripts/test.sh`): stalled, killed by the timeout with no summary; not rerun.
- Known test issues: a full Bun run stalled again on 2026-11-04 (killed at 240 s, no summary). A full Bun run stalled for about 11 minutes with workers at 100% CPU and no output. A per-file run had one failure in `generate/index-command.test.js` (18 pass, 1 fail, then an 852 s hang); the file passed 19/19 standalone. Not investigated further.
- Not run: native macOS and Windows; Node tests (policy: Bun only).

## Open decisions
- D11: plugin ships an MCP server (option E). Open for the user: under `allowManagedHooksOnly` a user-tier plugin loads no hooks. Options: ship as managed, or accept the risk. Blocks nothing offline.
- D13: partly settled. Confirmed: server path under `.claude/specplane/core`; `${CLAUDE_PLUGIN_ROOT}` expands; host lists `plugin:specplane:specplane` connected. Not observed: whether `tool.check` fires for the mod's own `$.mcp.call`; the wire tool name; a second server entry named `specplane` (source plugin) is unexplained. Blocks the flip of `reasoning`, pending D18.
- D18: resolved by an agent-driven interactive check (user-approved; evidence `harnesses/claude/host-evidence/2.1.317/interactive-check.txt`). Lease held across calls by the server: confirmed. Six blockers found, recorded as D20.
- D20 (new, from the interactive check): before the native reasoning path can work: (1) under auto mode the host refuses the mod's own `$.mcp.call` (classifier gives no verdict; host issue candidate); (2) in default mode every mod call shows a permission prompt with all arguments, so the nonce is not secret (screen, tool-results files), and the gate must not rely on it; (3) FIXED offline (`ea58453`): the host-written `.claude/specplane/tsconfig.json` is git-ignored by the installer, not shipped, so the host's rewrite cannot dirty the baseline (test: `harness.test` claude gitignore case); (4) FIXED offline (`44072f9`): `prepare` replies compactly (requestId, workflow, status, detailChars); the full request stays server-side and is read in 2048-character `detail` pages; each reply is asserted under 16 KB (`claude-mcp.test` realistic fixture); (5) FIXED offline (`44072f9`): `close` without requestId closes every open request of the binding; the server cancels a prepare it cannot deliver; the mod closes on lost prepare, unreadable prepare or detail, and unreadable completion result (`claude-handlers.test`, parse failure and prepare-then-failure cases); (6) after the session ends the lease stays with host-worker evidence and needs explicit recovery, which has no CLI command. Coordinator recommendation: fix 3-5 offline; design 1, 2 and 6 with the spec edit (D17/D16).
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
Spec-draft edit must also list the new surface: the `detail` tool, `validate` by requestId, `close` without requestId, and the installer's `.gitignore` entry.
Draft the combined Claude architecture-spec edit for the user's approval. It covers D17 option A (confirmation dialog plus protocol field), D16 option A (host-fixed test command), and the stale text listed below. Do not edit the spec body without that approval. Then continue `extension-conformance` 01 Claude rows.
Stale spec text to list (not verified line by line): `harnesses/claude/specifications/architecture/claude-integration.md` describes the reasoning and lease path as in-process; it is now the plugin MCP server (D11). Its plugin layout (about line 68) and hooks section (about line 445) may be stale, and it does not mention the `.claude/specplane` root, `types/` or D18. `harnesses/claude/specifications/features/claude-integration.md` lines 54-58 are the reasoning rows.
Before any further live invocation, get the user's decision on D18 (option A is recommended). Do not spend another live invocation without it.

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
- Bun only: `npm run build` in `packages/cli`, then `bun test --parallel=20 --timeout=30000 ./dist/<files>`. Full suite `sh scripts/test.sh` from `packages/cli` after `npm run build`: it runs Bun with the `env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT` prefix and a per-run `TMPDIR` removed on exit. Never `--concurrent`; no Node runs.
- Full suite stall: the coordinator decided on 2026-11-04 not to rerun the full suite until the stall is understood. Run focused suites only, and say "full suite: not rerun, stalled" in reports.
- Never approve, push, rewrite history, or edit plan `status:`, step checkboxes or managed progress. Do not invent ADR kinds or contract text.
- Stage specific paths only; never `problems.md` or `AGENTS.override.md`. Preserve private backups and receipts.
- Cooperative lease-coordinated writers only; native and live-host evidence stays unrun until produced.
- Live invocations: one per decision, never retried. Each needs the user's approval now (D18).
