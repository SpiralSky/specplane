# Session handoff
Updated 2026-11-04 (night). Branch `overnight/specplane-20261102T144630Z`, HEAD is the last commit on this branch (`git log -1`). Read `AGENTS.md` and `.specplane/config.yaml` first.

## Current state
- Only local `problems.md` is untracked; preserve it and never stage it. Managed recording is deferred by the user, so "complete" means implementation-complete on this branch.
- Implementation work from manual-lifecycle, workflow-recording, product-docs, extension-packaging, codex-delivery and extension-conformance 01 is committed (details in `docs/work-records/LOG.md`).
- claude-delivery 01 is implementation-complete offline: 2.1.317 declarations fixture (`harnesses/claude/host-evidence/2.1.317/capabilities.json`) and `probe/` mod. No live evidence.
- claude-delivery 02 is partial offline: `harnesses/claude/plugin/hooks/commands.ts` and `handlers.ts`. Reasoning commands are not registered (D9). The five mechanical legacy skills were removed (D10, `f57d03e`).
- claude-delivery 03 is blocked (D11). The one live probe was not run because `claude plugin validate` rejects `node:` imports in hooks modules (evidence: `harnesses/claude/host-evidence/2.1.317/live-probe-gate.txt`, commit `e1d2ff8`).
- The six reasoning legacy skills (`spec-assist`, `plan-step`, `plan-create`, `plan-finish`, `decision-new`, `spec-draft-architecture`) stay in `harnesses/claude/templates/skills` and `.claude/skills/`. Removing them is not allowed until native reasoning commands work.
- Last full Bun run (claude-delivery 02, 2026-11-04): 988 pass, 0 fail, 100 files. No code changed in claude-delivery 03, so no new suite run. `check-sync`: OK. `specplane validate`: 0 errors, 98 warnings.
- Not run: native macOS/Windows, live Claude/Codex hosts, Node tests (policy: Bun only).

## Open decisions
- D11: the Claude extension cannot load the bundled core in-process as D9(a) specifies, because the host forbids `node:` imports in hooks modules (`claude plugin validate` error at 2.1.317).
  - Option A: ask the host to allow node built-ins for hooks modules, or a supported alternative such as a documented handle for the writer lease. After a yes, run the one live check again.
  - Option B: keep the six reasoning legacy skills as the labeled fallback, and keep D9 open. Reasoning commands stay manual.
  - Option C: spend the one live check on a probe the validator rejects. This shows only runtime tolerance, not a supported mod.
  - Recommendation: B now, and raise A with the host. C is not recommended.
  - Blocks: claude-delivery 03 criteria 1 and 2 (leases across a reasoning turn), and the D10 removal of the six reasoning skills.
- D6: superseded (only the bundled snapshot was stale; the approved Codex spec was already correct).

## Decided (by the user, 2026-11-04)
- D9: option (a), the Claude extension loads the bundled core in-process so the writer lease is owned by the Claude Code process. Its live check is now blocked by D11.
- D10: remove the legacy public Claude skills. The five mechanical skills were removed in `f57d03e`. The six reasoning skills are removed only after native reasoning commands work (see D11). No consumer migration is needed (low-priority "dot" repo follow-up: stale copies, no journaled delete).
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
| claude-delivery | 02 | partial; managed recording pending | criteria 1, 3, 4 met offline; criterion 2 met for gates and coverage; D9 decided; D10 mechanical skills removed |
| claude-delivery | 03 | blocked (D11) | live gate not run: validator refuses `node:` imports in hooks modules; reasoning skills kept |
| codex-delivery | 01 | impl-complete; managed recording pending | all 3 criteria met by `core/workflow-runner.test`; no live Codex claim |
| codex-delivery | 02 | impl-complete; managed recording pending | all 4 criteria met; `harness/codex-package.test` (6) |
| codex-delivery | 03 | impl-complete; managed recording pending | all 3 criteria met; `harness/codex-consumer.test` (7) |
| extension-conformance | 01 | partial; managed recording pending | 3 of 4 criteria met; Claude rows pending (`harness/conformance.test` (8)) |
| extension-conformance | 02 | partial; managed recording pending | guards built (`harness/release-evidence.test` (4)); pin refresh awaits user implementation review |

## Next session
Wait for the user's answer to D11 before touching claude-delivery 03. If the user chooses A and the host allows the bundled core, rerun the one live check (`harnesses/claude/host-evidence/2.1.317/`), then build the in-process path and native reasoning commands. If B, record the outcome and make no skill removal. Work that is not blocked by D11: the session-adapter contract fixtures (argv launch through `$.process`, observation and resume against the fixtures), which need no live host. Then the extension-conformance 01 Claude rows, which flip only when a Claude package exists.

Spec text made stale by D10 once removals happen: `claude:architecture/claude-integration` lists the five mechanical skills (already stale) and the six reasoning skills in its command table (`harnesses/claude/specifications/features/claude-integration.md` lines 54-58). Spec edits need the user.

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
