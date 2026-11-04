# Session handoff
Updated 2026-11-04T08:00Z. Branch `overnight/specplane-20261102T144630Z`, HEAD `f613898`+ (see `git log`). Read `AGENTS.md` and `.specplane/config.yaml` first.

## Current state
- Review-branch implementation work is committed; only local `problems.md` is untracked (preserve it, never stage it).
- Plans are approved (`ready`), but managed recording is deferred (see Decided) until target-lifecycle and recovery are finished. "Complete" here means implementation-complete on this branch; managed recording is pending.
- manual-lifecycle 02 is implementation-complete: trusted `plan.finish` (preparation challenge, per-gate fresh challenges, `confirmOperationAsync`, lease retention on uncertain failure) and checkout leases on manual `spec new/approve/reopen/pin`, `decision new/accept`.
- workflow-recording step 04: all four acceptance criteria are met and tested (see Steps). The ADR creation path and protocol extensions remain open as D1 and D2.
- Implemented and extendable: preparation-bound leases, exact-set private-index transactions, finalized edits, dedicated spec/plan/ADR render/apply adapters, trusted contribution metadata, recovery and history, trusted `plan.abandon`, async confirmation, typed finish gates (see `docs/work-records/LOG.md`).
- product-docs 01 is implementation-complete: bundle tests (9) pass and examples are executed against the real CLI; docs state that `plan run` and `plan start --run` do not exist. Docs operations (02, 03), packaging, host delivery and conformance are not started.
- manual-lifecycle 03 is implementation-complete: `runPlan`/public `runConductor` take only an extension-supplied Protocol 1 `SessionAdapter` (probe before every launch, session record written before launch, resume, `unknown` is a refusal); `plan run`/`plan start --run` are hidden and print a migration diagnostic; init composes `COEXISTING_WORKFLOWS_LINE` when several harnesses are installed. The legacy sync Claude adapter in `harness/session.ts` is now unused by the conductor (claude-delivery 03 owns the real adapter). Delegation of the lease to a worker (token) is not implemented.
- Last full Bun run: 917 pass, 0 fail, 89 files (41.03 s); an earlier run in the same session hit the 120 s timeout with one 30 s stall (`unprepared edits...` in `core/non-plan-recording.test`), which passed alone and in the rerun. Under an agent environment (`CLAUDECODE` set) Bun hides `(pass)` lines and `harness/codex.test` fails spuriously; run with `env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT`.
- Not run: native macOS/Windows, live Claude/Codex hosts, Node tests (policy: Bun only).

## Open decisions
- D6: The Codex spec and its bundled snapshot (`harnesses/codex/specifications/architecture/codex-integration.md`, `harnesses/codex/templates/contracts/codex-integration.md`) still say `plan run --harness codex` refuses. Options: (a) edit both under `/spec-assist` and approve; (b) leave as superseded text. Recommend (a). Blocks: nothing in code; contract drift.

## Decided (by coordinator, delegated by the user)
- D4: Resolved. GitHub branches were already clean and the local branches have been scrubbed. Nothing further to do.
- D5: Resolved in part. `plan-conductor`'s branch and worktree were removed; the `plan abandon 2026-10-30-plan-conductor` status change is deferred to final reconciliation (it must run from a checkout of the integration branch).
- Managed recording deferral (user, 2026-11-04): plans are `ready`, but managed recording waits until target-lifecycle and recovery are finished. Do not run plan start/step-done/retarget/abandon; do not edit plan `status:`, step checkboxes or managed progress files.
- D1: ADR creation stays noncommit, matching `agent-skills` decision-new. No new `file-formats` §8.3 kind. Recording ADR creation returns `UNSUPPORTED_CAPABILITY` by design (documented behavior, not a gap).
- D2: Adopt the protocol extensions (`WorkflowResult.creation`, `finalizedEdits`, `ContributionProposal`, `captureProposedContribution`, `beforeDigest: "missing"`). A later session drafts the architecture spec edit (`llm_role: draft`); the user approves via /approve. No spec edits yet.
- D3: Resolved locally. `dot/codex-integration-20261101` was reset to origin (958973c); the old local rewrite is `backup/codex-integration-path-scrub-20261102`. `plan start` now refuses only because the plans are `draft`.

## Steps
| Plan | Step | State | Note |
| --- | --- | --- | --- |
| workflow-recording | 04 | impl-complete; managed recording pending | Criteria 1-4 met; D1/D2 open |
| manual-lifecycle | 02 | impl-complete; managed recording pending | trusted finish + checkout leases done; forced dirty abandon stays UNSUPPORTED (no content-review adapter) |
| manual-lifecycle | 03 | impl-complete; managed recording pending | criteria 1-3 met; D5/D6 open; worker lease delegation not built |
| product-docs | 01 | impl-complete; managed recording pending | both criteria met; `docs/bundle.test` |
| product-docs | 02 | not started | title-only excerpt rule unresolved |
| product-docs | 03 | not started | |
| extension-packaging | 01 | partial | inventory/tamper prep tests delivered |
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
Step: product-docs 02 (docs operations; the title-only excerpt rule is unresolved, so check the step file for a decision first). Also eligible: claude-delivery 03 (adapter on Protocol 1) once host evidence exists.

## Rules that matter
- Bun only: `npm run build` in `packages/cli`, then `bun test --parallel=20 --timeout=30000 ./dist/<files>`; full suite `timeout 120 bun test --parallel=20 --timeout=30000 ./dist` (prefix `env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT`). Never `--concurrent`; no Node runs.
- Never approve, push, rewrite history, or edit plan `status:`, step checkboxes or managed progress. Do not invent ADR kinds or contract text.
- Stage specific paths only; never `problems.md` or `AGENTS.override.md`. Preserve private backups and receipts.
- Cooperative lease-coordinated writers only; native and live-host evidence stays unrun until produced.
