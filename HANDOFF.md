# Session handoff
Updated 2026-11-04T13:55Z. Branch `overnight/specplane-20261102T144630Z`, HEAD is the last commit on this branch (`git log -1`). Read `AGENTS.md` and `.specplane/config.yaml` first.

## Current state
- Only local `problems.md` is untracked; preserve it and never stage it. Managed recording is deferred by the user, so "complete" means implementation-complete on this branch.
- claude-delivery 03 (D11 option E, coordinator decision 2026-11-04): the Claude plugin's workflow MCP server is built and tested offline. `packages/cli/src/harness/claude-mcp.ts` (JSON-RPC subset, one bind per session, forwards each runner operation; `close` cancels one request). Entry `claude-mcp-main.ts`. Commits `28fbec6`, `b553c17`.
- The plugin manifest (`harnesses/claude/plugin/.claude-plugin/plugin.json`) lists `mcpServers.specplane` (`node ${CLAUDE_PLUGIN_ROOT}/core/dist/harness/claude-mcp-main.js`). The `tool.check` gate in `hooks/handlers.ts` denies any `mcp__*` tool naming Specplane, and a throwing check also denies.
- Not built: the mod's reasoning port (`prepare`/`record` over `$.mcp.call`, per-workflow initiation mapping, delegation prompt without `requestPath`). Reasoning commands stay unregistered (`planRegistration(..., false)`).
- Live check NOT spent (D12): `prepare` needs Claude compatibility inputs that do not exist yet. Evidence note: `harnesses/claude/host-evidence/2.1.317/mcp-lease-live-gate.txt`.
- The six reasoning legacy skills stay in `harnesses/claude/templates/skills` and `.claude/skills/`. Step 7 (removal) is not allowed.
- Last full Bun run (2026-11-04, HEAD `b553c17`): 995 pass, 0 fail, 101 files. `claude plugin test harnesses/claude/plugin`: 27 pass. `claude plugin validate harnesses/claude/plugin`: passed with warnings. `specplane validate`: 0 errors, 98 warnings. `check-sync` and `hooks.test.sh` were not rerun (no template changed in this step).
- `tsc --strict` on `hooks/handlers.ts` (against the 2.1.317 declarations): no errors. `hooks/register.tsx` has 15 strict-mode errors that predate this step (not changed here).
- Not run: native macOS/Windows, live Claude/Codex hosts, Node tests (policy: Bun only).

## Open decisions
- D11 (decided by coordinator, delegated by user, 2026-11-04): option E supersedes D9(a). The plugin ships an MCP server that the host runs as a persistent stdio process, and the mod drives it with `$.mcp.call`. The server process owns the writer lease for the session. Fail-closed `tool.check` gate on model calls. Residual risk: under `allowManagedHooksOnly` a user-tier plugin loads no hooks, so the gate is absent while the server still connects (d.ts remark at `$.mcp.connect`). Ship as managed or accept the risk.
- D12: how to get the one live check that shows a held lease. Options: (A) build the Claude package compatibility (`specplane-extension.json`, inventory, host evidence for `claude-code`) first, then spend the single live check on connect, bind, prepare, inspect, close. (B) spend the live check now on connect and bind only; it cannot show the lease. (C) drop lease-across-turn and keep reasoning manual. Recommendation: A, then the one live run; B is not recommended because it proves nothing about the lease. Blocks: claude-delivery 03 criteria 1 and 2 and the step-7 skill removal.
- D13: unverified host assumptions for the live run. Whether `tool.check` runs for the mod's own `$.mcp.call` (if yes, the gate denies reasoning); the connected server name (expected `plugin:specplane:specplane`) and wire tool name; whether `${CLAUDE_PLUGIN_ROOT}` expands in `mcpServers` args. Recommendation: check in the single live run, and fall back to the D12 plan if any fails. Blocks: reasoning port acceptance.
- D6: superseded (only the bundled snapshot was stale; the approved Codex spec was already correct).

## Decided (by the user, 2026-11-04)
- D9 (a): superseded by D11 option E. The live-probe gate and `live-probe-gate.txt` remain as evidence.
- D10: remove the legacy public Claude skills. The five mechanical skills were removed in `f57d03e`. The six reasoning skills are removed only after native reasoning commands work (D12, then D11).
- Managed recording deferral: plans are `ready`, but managed recording waits until target-lifecycle and recovery are finished. Do not run plan start/step-done/retarget/abandon; do not edit plan `status:`, step checkboxes or managed progress files.
- D1: ADR creation stays noncommit, matching `agent-skills` decision-new. Recording ADR creation returns `UNSUPPORTED_CAPABILITY` by design.
- D2: Adopt the protocol extensions (`WorkflowResult.creation`, `finalizedEdits`, `ContributionProposal`, `captureProposedContribution`, `beforeDigest: "missing"`). A later session drafts the architecture spec edit; the user approves via /approve.
- D3: resolved locally. Old local rewrite kept at `backup/codex-integration-path-scrub-20261102`. Undo with `git branch -f dot/codex-integration-20261101 958973c`.
- D4, D5, D7, D8: resolved or decided earlier (D5 plan abandon waits for final reconciliation; D7 title-only search returns `excerpts: []`; D8 Codex/Claude workflow lines are neutral in `AGENTS.md`).
- Open, not decided: `feature/tooling` line 18 and `feature/plan-execution` "Extension-owned opt-in conductor" wording (optional stale text; needs reopen, edit, re-pin and re-approve). Hold installer moves out of `packages/cli/src/harness/`.

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
| claude-delivery | 03 | partial; blocked (D12 live check) | MCP server (`claude-mcp.test`, 6) and gate (`claude-handlers.test`, 8) built; reasoning port not built; live check not spent; six reasoning skills kept |
| codex-delivery | 01 | impl-complete; managed recording pending | all 3 criteria met by `core/workflow-runner.test`; no live Codex claim |
| codex-delivery | 02 | impl-complete; managed recording pending | all 4 criteria met; `harness/codex-package.test` (6) |
| codex-delivery | 03 | impl-complete; managed recording pending | all 3 criteria met; `harness/codex-consumer.test` (7) |
| extension-conformance | 01 | partial; managed recording pending | 3 of 4 criteria met; Claude rows pending (`harness/conformance.test` (8)) |
| extension-conformance | 02 | partial; managed recording pending | guards built (`harness/release-evidence.test` (4)); pin refresh awaits user implementation review |

## Next session
Decide D12 first (recommendation A: build the Claude package compatibility, then run the one live check). Once D12 is decided, the first concrete task is the Claude package compatibility inputs (`specplane-extension.json`, inventory, `claude-code` host evidence for `SPECPLANE_HOST_EVIDENCE`). Then the one live check (connect, bind, prepare, inspect, close; record verbatim output under `harnesses/claude/host-evidence/2.1.317/`). If it passes, build the reasoning port and remove the six reasoning skills (D10). If it fails, do not retry: keep the skills, record a D-entry, stop.
Extension-conformance 01 Claude rows (per coordinator) flip only when a Claude package exists, so they depend on the same D12 work.

Spec text likely stale after D11 (not verified line by line; spec edits need the user): `claude:architecture/claude-integration` (`harnesses/claude/specifications/architecture/claude-integration.md`) describes the reasoning and lease path, which is now the plugin MCP server, and the plugin layout at its line 68 and the hooks section at line 445. `harnesses/claude/specifications/features/claude-integration.md` lines 54-58 list the six reasoning skills, which D10 will remove.

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
- Bun only: `npm run build` in `packages/cli`, then `bun test --parallel=20 --timeout=30000 ./dist/<files>`; full suite `timeout 120 bun test --parallel=20 --timeout=30000 ./dist` (prefix `env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT`). Never `--concurrent`; no Node runs.
- Never approve, push, rewrite history, or edit plan `status:`, step checkboxes or managed progress. Do not invent ADR kinds or contract text.
- Stage specific paths only; never `problems.md` or `AGENTS.override.md`. Preserve private backups and receipts.
- Cooperative lease-coordinated writers only; native and live-host evidence stays unrun until produced.
