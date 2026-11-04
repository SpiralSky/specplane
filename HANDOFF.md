# Session handoff
Updated 2026-11-04T11:00Z. Branch `overnight/specplane-20261102T144630Z`, HEAD see `git log`. Read `AGENTS.md` and `.specplane/config.yaml` first.

## Current state
- Review-branch implementation work is committed; only local `problems.md` is untracked (preserve it, never stage it).
- Plans are approved (`ready`), but managed recording is deferred (see Decided) until target-lifecycle and recovery are finished. "Complete" here means implementation-complete on this branch; managed recording is pending.
- manual-lifecycle 02 is implementation-complete: trusted `plan.finish` (preparation challenge, per-gate fresh challenges, `confirmOperationAsync`, lease retention on uncertain failure) and checkout leases on manual `spec new/approve/reopen/pin`, `decision new/accept`.
- workflow-recording step 04: all four acceptance criteria are met and tested (see Steps). The ADR creation path and protocol extensions remain open as D1 and D2.
- Implemented and extendable: preparation-bound leases, exact-set private-index transactions, finalized edits, dedicated spec/plan/ADR render/apply adapters, trusted contribution metadata, recovery and history, trusted `plan.abandon`, async confirmation, typed finish gates (see `docs/work-records/LOG.md`).
- product-docs 02 is implementation-complete: `docs/operations` (`docsIndex/docsTopic/docsSearch`, exported from core) and `specplane docs [topic] [--json]` / `docs search <text...>`; `docs/operations.test` (7) pass.
- product-docs 03 is implementation-complete: `docs/freshness.ts` (`checkGuidance` read-only, `refreshGuidance` explicit with `dryRun`, both exported from core); the AGENTS.md block marker can carry `docs=`/`contract=`/`sha256=` (written only by refresh; plain init keeps a matching marker); `validate` warns on stale identity or an edited block. Orientation text updated (manifest hash too). Generated authorship text now matches `agent-skills` (problems.md finding closed; templates, `.claude/` and root AGENTS.md updated). No new CLI command; installer wiring and prior-release digests belong to extension-packaging.
- product-docs 01 is implementation-complete: bundle tests (9) pass and examples are executed against the real CLI; docs state that `plan run` and `plan start --run` do not exist. Packaging, host delivery and conformance are not started.
- manual-lifecycle 03 is implementation-complete: `runPlan`/public `runConductor` take only an extension-supplied Protocol 1 `SessionAdapter` (probe before every launch, session record written before launch, resume, `unknown` is a refusal); `plan run`/`plan start --run` are hidden and print a migration diagnostic; init composes `COEXISTING_WORKFLOWS_LINE` when several harnesses are installed. The legacy sync Claude adapter in `harness/session.ts` is now unused by the conductor (claude-delivery 03 owns the real adapter). Delegation of the lease to a worker (token) is not implemented.
- extension-packaging 01 is implementation-complete: `harness/package-builder.ts` (`buildExtensionPackage`) copies runtime/dependency trees, docs bundle, reasoning/hook assets and a stamped instruction file into an empty directory, derives `core/inventory.json` and `specplane-extension.json` from written bytes, resolves procedure contracts from the docs bundle sources, and self-validates with `validateCompatibility`; it certifies no host (`hostCompatibility: []`), writes no pin and activates no installer. Tests: `harness/package-builder.test` (3) plus the existing `harness/package-inventory-preparation.test` (4) and `core/compatibility.test`.
- Last full Bun run: 936 pass, 0 fail, 92 files (37.69 s); one earlier full run in the same session was terminated by `timeout 120` with no output (cause not diagnosed; the rerun passed). An earlier session once hit a 30 s stall (`unprepared edits...` in `core/non-plan-recording.test`) that passed on rerun. Under an agent environment (`CLAUDECODE` set) Bun hides `(pass)` lines and `harness/codex.test` fails spuriously; run with `env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT`.
- Not run: native macOS/Windows, live Claude/Codex hosts, Node tests (policy: Bun only).

## Open decisions
- D6: The Codex spec and its bundled snapshot (`harnesses/codex/specifications/architecture/codex-integration.md`, `harnesses/codex/templates/contracts/codex-integration.md`) still say `plan run --harness codex` refuses. Options: (a) edit both under `/spec-assist` and approve; (b) leave as superseded text. Recommend (a). Blocks: nothing in code; contract drift.
- D8: The rest of the generated standing text (intro paragraph, Precedence, Plans, Commits, Workflows bullets) still differs from the `agent-skills` standing block; only the Authorship bullet was aligned. Options: (a) rewrite `standingText` to the spec text, bumping `STANDING_VERSION` and reconciling the per-harness/coexisting Workflows lines; (b) amend the spec to the shipped text. Recommend (a) in extension-packaging 03. Blocks: nothing.

## Decided (by coordinator, delegated by the user)
- D7: Title-only search matches return the topic with `excerpts: []` (option a, implemented). The user may amend `reference-cli` later.
- D4: Resolved. GitHub branches were already clean and the local branches have been scrubbed. Nothing further to do.
- D5: Resolved in part. `plan-conductor`'s branch and worktree were removed; the `plan abandon 2026-10-30-plan-conductor` status change is deferred to final reconciliation (it must run from a checkout of the integration branch).
- Managed recording deferral (user, 2026-11-04): plans are `ready`, but managed recording waits until target-lifecycle and recovery are finished. Do not run plan start/step-done/retarget/abandon; do not edit plan `status:`, step checkboxes or managed progress files.
- D1: ADR creation stays noncommit, matching `agent-skills` decision-new. No new `file-formats` §8.3 kind. Recording ADR creation returns `UNSUPPORTED_CAPABILITY` by design (documented behavior, not a gap).
- D2: Adopt the protocol extensions (`WorkflowResult.creation`, `finalizedEdits`, `ContributionProposal`, `captureProposedContribution`, `beforeDigest: "missing"`). A later session drafts the architecture spec edit (`llm_role: draft`); the user approves via /approve. No spec edits yet.
- D3: Resolved locally. `dot/codex-integration-20261101` was fast-forwarded (local only, not pushed) to the review branch at `f613898` after the user approved the plans; this branch has moved ahead since. The old local rewrite is kept at `backup/codex-integration-path-scrub-20261102`. Undo with `git branch -f dot/codex-integration-20261101 958973c`.

## Steps
| Plan | Step | State | Note |
| --- | --- | --- | --- |
| workflow-recording | 04 | impl-complete; managed recording pending | Criteria 1-4 met; D1/D2 open |
| manual-lifecycle | 02 | impl-complete; managed recording pending | trusted finish + checkout leases done; forced dirty abandon stays UNSUPPORTED (no content-review adapter) |
| manual-lifecycle | 03 | impl-complete; managed recording pending | criteria 1-3 met; D5/D6 open; worker lease delegation not built |
| product-docs | 01 | impl-complete; managed recording pending | both criteria met; `docs/bundle.test` |
| product-docs | 02 | impl-complete; managed recording pending | both criteria met; `docs/operations.test`; D7 |
| product-docs | 03 | impl-complete; managed recording pending | both criteria met; `docs/freshness.test` (7); D8 |
| extension-packaging | 01 | impl-complete; managed recording pending | all 3 criteria met; builder + prep tests; no release pins frozen |
| extension-packaging | 02 | partial | containment work only |
| extension-packaging | 03 | not started | |
| claude-delivery | 01 | blocked | native host API evidence missing |
| claude-delivery | 02 | not started | |
| claude-delivery | 03 | not started | |
| codex-delivery | 01 | not started | |
| codex-delivery | 02 | not started | |
| codex-delivery | 03 | not started | |
| extension-conformance | 01 | not started | |
| extension-conformance | 02 | not started | |

## Next session
Step: **extension-packaging 02** (partial; containment work only). First task: check each criterion against `harness/containment.ts` and its tests, then add the journal, ownership digests and recovery that are missing. Then 03 (consumes `refreshGuidance`, `buildExtensionPackage` and D8). Real host assets (Claude/Codex runtime, hooks) are still changing, so use the builder only on fixtures until claude/codex-delivery land; do not freeze their hashes as release evidence. After packaging: codex-delivery 01→03 (claude-delivery 01 stays blocked on native host API evidence), then conformance.

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
