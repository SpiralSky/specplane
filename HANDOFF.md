# Session handoff
Updated 2026-11-04T06:00Z. Branch `overnight/specplane-20261102T144630Z`, HEAD `9d83912`+ (see `git log`). Read `AGENTS.md` and `.specplane/config.yaml` first.

## Current state
- Review-branch implementation work is committed; only local `problems.md` is untracked (preserve it, never stage it).
- Managed workflow is unavailable: all relevant plans are `status: draft`, so `plan start` refuses (branch divergence was resolved, see Decided). "Complete" here means implementation-complete on this branch; managed recording is pending.
- manual-lifecycle 02 is implementation-complete: trusted `plan.finish` (preparation challenge, per-gate fresh challenges, `confirmOperationAsync`, lease retention on uncertain failure) and checkout leases on manual `spec new/approve/reopen/pin`, `decision new/accept`.
- workflow-recording step 04: all four acceptance criteria are met and tested (see Steps). The ADR creation path and protocol extensions remain open as D1 and D2.
- Implemented and extendable: preparation-bound leases, exact-set private-index transactions, finalized edits, dedicated spec/plan/ADR render/apply adapters, trusted contribution metadata, recovery and history, trusted `plan.abandon`, async confirmation, typed finish gates (see `docs/work-records/LOG.md`).
- Docs bundle (`src/docs/bundle.ts`, `assets/docs/`) is prepared; docs operations, packaging, host delivery and conformance are not started.
- Last full Bun run: 904 pass, 0 fail, 88 files (34.18 s). Under an agent environment (`CLAUDECODE` set) Bun hides `(pass)` lines and `harness/codex.test` fails spuriously; run with `env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT`.
- Not run: native macOS/Windows, live Claude/Codex hosts, Node tests (policy: Bun only).
- Live plan list may still refuse with a mixed-path error at the old `plan/2026-10-30-plan-conductor` tip; re-check after D3.

## Open decisions
- D4: Origin (public) history still contains identifying local paths. Removing them needs a force-push that only the user can authorize. Options: (a) force-push a scrubbed history from `backup/codex-integration-path-scrub-20261102`; (b) leave history as is; (c) rotate to a fresh public repo. Recommend the user decide after reviewing exposure. Blocks: nothing in code; public hygiene only.

## Decided (by coordinator, delegated by the user)
- D1: ADR creation stays noncommit, matching `agent-skills` decision-new. No new `file-formats` §8.3 kind. Recording ADR creation returns `UNSUPPORTED_CAPABILITY` by design (documented behavior, not a gap).
- D2: Adopt the protocol extensions (`WorkflowResult.creation`, `finalizedEdits`, `ContributionProposal`, `captureProposedContribution`, `beforeDigest: "missing"`). A later session drafts the architecture spec edit (`llm_role: draft`); the user approves via /approve. No spec edits yet.
- D3: Resolved locally. `dot/codex-integration-20261101` was reset to origin (958973c); the old local rewrite is `backup/codex-integration-path-scrub-20261102`. `plan start` now refuses only because the plans are `draft`.

## Steps
| Plan | Step | State | Note |
| --- | --- | --- | --- |
| workflow-recording | 04 | impl-complete; managed recording pending | Criteria 1-4 met; D1/D2 open |
| manual-lifecycle | 02 | impl-complete; managed recording pending | trusted finish + checkout leases done; forced dirty abandon stays UNSUPPORTED (no content-review adapter) |
| manual-lifecycle | 03 | not started | 02 done; eligible |
| product-docs | 01 | partial | bundle prepared; final content waits on lifecycle |
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
Step: manual-lifecycle 03 (read its step file first). Also eligible: product-docs 01 final content now that lifecycle 02 is done. Unverified: an unpublished-claim preparation gate has no dedicated test (only the claim path is covered).

## Rules that matter
- Bun only: `npm run build` in `packages/cli`, then `bun test --parallel=20 --timeout=30000 ./dist/<files>`; full suite `timeout 120 bun test --parallel=20 --timeout=30000 ./dist` (prefix `env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT`). Never `--concurrent`; no Node runs.
- Never approve, push, rewrite history, or edit plan `status:`, step checkboxes or managed progress. Do not invent ADR kinds or contract text.
- Stage specific paths only; never `problems.md` or `AGENTS.override.md`. Preserve private backups and receipts.
- Cooperative lease-coordinated writers only; native and live-host evidence stays unrun until produced.
