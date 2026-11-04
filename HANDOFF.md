# Session handoff
Updated 2026-11-04T14:10Z. Branch `overnight/specplane-20261102T144630Z`, HEAD is the last commit on this branch (`git log -1`). Read `AGENTS.md` and `.specplane/config.yaml` first.

## Current state
- Only local `problems.md` is untracked; preserve it and never stage it. Managed recording is deferred by the user, so "complete" means implementation-complete on this branch.
- claude-delivery 03, D12 option A built offline (commits `8603136`, `7ff6063`, `f2b3289`): `packages/cli/src/harness/claude-package.ts` assembles the package (`specplane-extension.json`, `core/inventory.json`, `dist/harness/claude-mcp-main.js`, `host-evidence/claude-code.json`, docs, runtime deps). `harness/claude.ts` stages it at `.claude/specplane/core` inside the install transaction.
- `harness/claude-mcp-main.ts` now takes compatibility from the installed manifest and host selection, not from `SPECPLANE_HOST_EVIDENCE`. An installed `prepare` for `plan-step` passes `validateCompatibility`, holds the lease, and `close` releases it (`harness/claude-package.test`, test "the installed MCP server binds, prepares a reasoning workflow ...").
- Claude rows in `harness/conformance-matrix.ts` stay pending. The guard now asserts the package exists and is traced to the unmet `exports-and-workflows` criterion.
- No reasoning command is delivered yet: the six reasoning commands are not in the mod, and the six legacy skills stay in `harnesses/claude/templates/skills` and `.claude/skills/`. No live Claude check has been run.
- Last full Bun run (2026-11-04, after `8603136`..`f2b3289`): 1000 pass, 0 fail, 102 files. `specplane validate`: 0 errors, 98 warnings, 80 files. Templates unchanged, so `check-sync.sh` not run.
- Not run: native macOS/Windows, live Claude/Codex hosts, Node tests (policy: Bun only).

## Open decisions
- D11 (decided by coordinator, 2026-11-04): option E. The plugin ships an MCP server the host runs as a persistent stdio process; the mod drives it with `$.mcp.call`; the server owns the writer lease. Residual risk: under `allowManagedHooksOnly` a user-tier plugin loads no hooks, so the gate is absent while the server still connects (d.ts remark at `$.mcp.connect`). Options: ship as managed, or accept the risk. Open for the user.
- D13 (offline findings, 2026-11-04): the 2.1.317 declarations do not say whether `tool.check` runs for the mod's own `$.mcp.call`, do not mention `CLAUDE_PLUGIN_ROOT`, and name the connected server `plugin:<plugin>:<server>`. Design: the gate allows a call only with the bound session nonce and denies everything else. Unverified until the live run: server name, wire tool name, `${CLAUDE_PLUGIN_ROOT}` expansion, `tool.check` on `$.mcp.call`. Blocks the reasoning port's live check.
- D14 (run 1, 2026-11-04): installed package location. Recorded as `.claude/specplane/core`, chosen so the plugin root `.claude/specplane` matches `plugin.json` (`${CLAUDE_PLUGIN_ROOT}/core/dist/harness/claude-mcp-main.js`). Options: (A) keep this layout and confirm at the live check that the plugin loads from `.claude/specplane`; (B) install the package outside the repository, in the plugin's own user-level location (needs installer scope change). Recommendation: A. Blocks the live check only.
- D6: superseded (only the bundled snapshot was stale; the approved Codex spec was already correct).

## Decided (by the user or coordinator)
- D12 (coordinator, delegated): option A. Build the Claude package compatibility inputs first, mirroring Codex, staged through the Claude installer's transaction. `enabled: "unobserved"`; no host beyond recorded evidence is certified. Done offline in run 1.
- D10: remove the legacy public Claude skills. Five mechanical skills removed in `f57d03e`. Six reasoning skills removed only after the live check passes.
- D9 (a): superseded by D11 option E. `live-probe-gate.txt` remains as evidence.
- D1: ADR creation stays noncommit, matching `agent-skills` decision-new. Recording ADR creation returns `UNSUPPORTED_CAPABILITY` by design.
- D2: Adopt the protocol extensions (`WorkflowResult.creation`, `finalizedEdits`, `ContributionProposal`, `captureProposedContribution`, `beforeDigest: "missing"`). A later session drafts the architecture spec edit; the user approves via /approve.
- D3: resolved locally. Old local rewrite kept at `backup/codex-integration-path-scrub-20261102`.
- D4, D5, D7, D8: resolved or decided earlier (D5 plan abandon waits for final reconciliation; D7 title-only search returns `excerpts: []`; D8 Codex/Claude workflow lines are neutral in `AGENTS.md`).
- Managed recording deferral: do not run plan start/step-done/retarget/abandon; do not edit plan `status:`, step checkboxes or managed progress files.

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
| claude-delivery | 03 | partial; blocked (reasoning port, then live check) | MCP server (`claude-mcp.test`, 6), gate (`claude-handlers.test`, 8), package and installed-prepare (`claude-package.test`, 5) built; reasoning commands and live check not done |
| codex-delivery | 01 | impl-complete; managed recording pending | all 3 criteria met by `core/workflow-runner.test`; no live Codex claim |
| codex-delivery | 02 | impl-complete; managed recording pending | all 4 criteria met; `harness/codex-package.test` (6) |
| codex-delivery | 03 | impl-complete; managed recording pending | all 3 criteria met; `harness/codex-consumer.test` (7) |
| extension-conformance | 01 | partial; managed recording pending | 3 of 4 criteria met; Claude rows pending (`harness/conformance.test` (8)) |
| extension-conformance | 02 | partial; managed recording pending | guards built (`harness/release-evidence.test` (4)); pin refresh awaits user implementation review |

## Next session
Run 2 of claude-delivery 03, offline only (no live Claude invocation).
1. Nonce gate: in `hooks/handlers.ts` and the mod, require the bound session nonce on every `$.mcp.call` argument set; deny everything else (fail closed) per D13.
2. Port the six reasoning commands (`spec-assist`, `plan-step`, `plan-create`, `plan-finish`, `decision-new`, `spec-draft-architecture`) to native mod commands over `$.mcp.connect` and `$.mcp.call` against the installed MCP server, with the `prepare`, `executeTest`, `validate`, `record` flow. Keep `planRegistration(..., false)` until the live check passes.
3. Add offline tests (plugin test kit, Bun suites). Update the Claude rows in `harness/conformance-matrix.ts` only where those tests prove them.
4. Do not spend the live check in run 2. Record its prerequisites in the D13 entry.
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
