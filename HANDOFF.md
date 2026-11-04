# Session handoff
Updated 2026-11-04T14:19Z. Branch `overnight/specplane-20261102T144630Z`, HEAD is the last commit on this branch (`git log -1`). Read `AGENTS.md` and `.specplane/config.yaml` first.

## Current state
- Only local `problems.md` is untracked; preserve it and never stage it. Managed recording is deferred by the user, so "complete" means implementation-complete on this branch.
- claude-delivery 03 run 2 (offline) built the nonce gate and the six reasoning commands in `harnesses/claude/plugin/hooks/commands.ts` and `handlers.ts` (commits `c21141c`, `2bffb7d`).
- The gate admits a Specplane server call only with the nonce the mod bound at session start. Any other server call is denied, and a throwing gate denies. The completion tool `mcp__specplane__specplane_result` is exempt. Run 1's gate denied every `specplane` tool, including the completion tool, so results could never be returned. That is fixed.
- Each reasoning command runs connect, bind (once per session), prepare, then queues the model part. `acceptResult` runs validate, record and close. `close` also runs on refusal, throw, cancel and failed submit (`submitDelegation`).
- The reasoning commands are not registered. `startNative` keeps `reasoning = false` until the live check (D13). The legacy reasoning skills stay in `harnesses/claude/templates/skills` (D10).
- Installer: `harness/claude-package.ts` stages `core/` at `.claude/specplane/core` (D14). It does not stage `.claude-plugin/plugin.json`, so the plugin root that `${CLAUDE_PLUGIN_ROOT}` expects is not installed (checked by grep of `harness/claude*.ts`).
- Claude conformance rows stay `not-delivered` and `pending`. The column means delivered to the host, and offline tests cannot show that.
- Verified offline (run 2, after `2bffb7d`): full Bun `./dist` 1012 pass, 0 fail, 102 files. `claude plugin validate harnesses/claude/plugin` passed with warnings. `claude plugin test` 27 pass. `hooks.test.sh` 94 pass. `check-sync.sh` OK. `specplane validate` 0 errors, 98 warnings, 80 files. Strict tsc clean on the two mod files, checked against the bundled 2.1.317 declarations.
- Not run: live Claude invocation; native macOS and Windows; Node tests (policy: Bun only).

## Open decisions
- D11: plugin ships an MCP server (option E, coordinator-decided). Open for the user: under `allowManagedHooksOnly` a user-tier plugin loads no hooks, so the gate is absent while the server still connects. Options: ship as managed, or accept the risk. Blocks: nothing offline.
- D13: unverified until the live check: the connected server name (expected `plugin:specplane:specplane`), the wire tool name `tool.check` sees, `${CLAUDE_PLUGIN_ROOT}` expansion in `mcpServers` args, and whether `tool.check` fires for the mod's own `$.mcp.call`. Blocks the live check and the flip of `reasoning`.
- D14 (decided by coordinator, 2026-11-04): keep `.claude/specplane/core`. Run 3 confirms it. Also decide how the plugin root gets `.claude-plugin/plugin.json` and `hooks/`, since the installer does not stage them. Blocks the live check.
- D15 (new): `plan-finish` has no core initiation. `WorkflowName` and `workflowInitiationSchema` (`core/contracts.ts`, `core/schemas.ts`) omit it, though `nonPlanScopes` lists it. Options: (A) add it to the initiation contract (spec and core change); (B) keep it manual through the CLI, and its native command refuses with the core message. Recommendation: B for now. Blocks: `plan-finish` only.
- D16 (new): `executeTest` is not wired. A criterion with `testRequirements` needs test evidence, but nothing says which executable and args run a suite. Options: (A) the mod runs the reviewed suite with a host-fixed command; (B) the model supplies executable and args (untrusted); (C) refuse such criteria until decided. Recommendation: C now, A later. Blocks: plan-step criteria that have tests.
- D17 (new): recording a result with `requiresConfirmation` (finalized spec edits, creation) needs a direct-human interaction port. The MCP server's runner has none, so `record` returns `CONFIRMATION_REQUIRED` (`core/workflow-recording.ts`). Options: (A) confirm through the mod dialog and add a protocol field (protocol extension); (B) keep finalized edits and creation manual through the CLI. Recommendation: B for run 3. Blocks: reasoning commands that create or finalize specs, plans or decisions.
- D6: superseded.

## Decided
- D12 (coordinator, delegated): option A. Claude package built and staged through the installer transaction, `enabled: "unobserved"`.
- D10: legacy public Claude skills. Five mechanical ones removed in `f57d03e`. Six reasoning skills removed only after the live check passes.
- D9 (a): superseded by D11 option E. `live-probe-gate.txt` remains as evidence.
- D1: ADR creation stays noncommit. Recording ADR creation returns `UNSUPPORTED_CAPABILITY` by design.
- D2: protocol extensions adopted (`WorkflowResult.creation`, `finalizedEdits`, `ContributionProposal`, `captureProposedContribution`, `beforeDigest: "missing"`). Architecture spec edit pending user approval.
- D3, D4, D5, D7, D8: resolved or decided earlier (D5: plan abandon waits for final reconciliation; D7: title-only search returns `excerpts: []`; D8: Codex and Claude workflow lines are neutral in `AGENTS.md`).
- Managed recording deferral: do not run plan start, step-done, retarget or abandon; do not edit plan `status:`, step checkboxes or managed progress files.

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
| claude-delivery | 03 | partial; blocked (live check, D13/D14) | server, package and installed prepare built (runs 1-2); nonce gate and six reasoning handlers built and tested offline (`claude-handlers`, 20), not registered |
| codex-delivery | 01 | impl-complete; managed recording pending | all 3 criteria met by `core/workflow-runner.test`; no live Codex claim |
| codex-delivery | 02 | impl-complete; managed recording pending | all 4 criteria met; `harness/codex-package.test` (6) |
| codex-delivery | 03 | impl-complete; managed recording pending | all 3 criteria met; `harness/codex-consumer.test` (7) |
| extension-conformance | 01 | partial; managed recording pending | 3 of 4 criteria met; Claude rows pending (`harness/conformance.test` (8)) |
| extension-conformance | 02 | partial; managed recording pending | guards built (`harness/release-evidence.test` (4)); pin refresh awaits user implementation review |

## Next session
Run 3 of claude-delivery 03: one live check, then removal of the legacy reasoning skills. Nothing is registered yet, so the live check needs a deliberate flip.

1. Precondition (human or coordinator decision): settle how the plugin root gets `.claude-plugin/plugin.json` and `hooks/` (see D14). Then, in one commit, set `reasoning = true` in `startNative` (`harnesses/claude/plugin/hooks/handlers.ts`), rebuild, and run `claude plugin validate` and `claude plugin test` again.
2. Build a fixture checkout, never the repo itself: copy the repo to a scratch directory, run `specplane init --harness claude` there, and confirm `.claude/specplane/core/specplane-extension.json`, `core/dist/harness/claude-mcp-main.js` and `host-evidence/claude-code.json` exist.
3. Confirm the flag with `claude --help | grep -i plugin`. Then run one prepare-only session: `claude -p '/spec-assist search filter draft' --plugin-dir <fixture>/.claude/specplane --output-format stream-json --verbose`, from the fixture. Prepare-only avoids D15, D16 and D17, because `record` is not reached.
4. Evidence that proves the run passed:
   - connect: `$.mcp.connect` returns `isConnected: true` with `server` `plugin:specplane:specplane`, and the transcript shows the prepare reply.
   - bind: the first server call returns `{"bound":true}`. A second reasoning command in the same session sends only `prepare`.
   - prepare: the reply holds a `requestId` and a criteria list.
   - lease held: the server's `inspect` tool for that `requestId` shows the writer lease held. A second `prepare` from another process returns `LOCKED`.
   - close: `close` for that `requestId`, then `inspect` shows the lease released.
   - D13 facts: the gate lets the mod's `$.mcp.call` through (bind succeeds with the gate in place). Record the wire tool name `tool.check` sees. Confirm `${CLAUDE_PLUGIN_ROOT}` expanded (the server process path is under the fixture's `.claude/specplane/core`).
   - D14: the server path is `.claude/specplane/core`, so D14 is confirmed.
5. Failure rule: if any item fails, record the exact output in `harnesses/claude/host-evidence/2.1.317/` and stop. Do not retry. Only a passing run allows the skill removal.
6. After a pass: record the live facts in the D13 entry, then in one commit remove the six reasoning skills (D10) and `harness/conformance-matrix.ts` reasoning rows if the live evidence supports them. Update `harnesses/claude/specifications/features/claude-integration.md` lines 54-58 only with the user's spec approval.
- Spec text is likely stale after D11 (not verified line by line). `claude:architecture/claude-integration` (`harnesses/claude/specifications/architecture/claude-integration.md`) describes the reasoning and lease path, which is now the plugin MCP server. Its plugin layout (line 68) and hooks section (line 445) may be stale. Spec edits need the user.

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
