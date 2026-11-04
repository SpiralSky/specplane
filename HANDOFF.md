# Session handoff
Updated 2026-11-04T04:55Z. Branch `overnight/specplane-20261102T144630Z`, HEAD at the commit after `4050dd6` (see `git log`). Read `AGENTS.md` and `.specplane/config.yaml` first.

## Current state
- Review-branch implementation work is committed; only local `problems.md` is untracked (preserve it, never stage it).
- Managed workflow is unavailable: all relevant plans are `status: draft` and `plan start` refuses because `dot/codex-integration-20261101` local and origin refs diverged. "Complete" here means implementation-complete on this branch; managed recording is pending.
- workflow-recording step 04: all four acceptance criteria are met and tested (see Steps). The ADR creation path and protocol extensions remain open as D1 and D2.
- Implemented and extendable: preparation-bound leases, exact-set private-index transactions, finalized edits, dedicated spec/plan/ADR render/apply adapters, trusted contribution metadata, recovery and history, trusted `plan.abandon`, async confirmation, typed finish gates (see `docs/work-records/LOG.md`).
- Docs bundle (`src/docs/bundle.ts`, `assets/docs/`) is prepared; docs operations, packaging, host delivery and conformance are not started.
- Last full Bun run: 898 pass, 0 fail, 86 files (38.15 s). Under an agent environment (`CLAUDECODE` set) Bun hides `(pass)` lines and `harness/codex.test` fails spuriously; run with `env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT`.
- Not run: native macOS/Windows, live Claude/Codex hosts, Node tests (policy: Bun only).
- Live plan list still refuses with a mixed-path error at the old `plan/2026-10-30-plan-conductor` tip; branch reconciliation is a human decision.

## Open decisions
- D1: ADR creation commit kind. `file-formats` §8.3 has no ADR creation kind, so recording ADR creation returns `UNSUPPORTED_CAPABILITY` before any write. Options: (a) add an ADR creation kind to §8.3 and the trailers; (b) keep ADR creation noncommit (as `agent-skills` decision-new does) and document that recording never covers it; (c) record ADR creation under an existing kind. Recommend (b) unless ADR history must be machine-recorded. Blocks: ADR creation through workflow recording only.
- D2: Protocol extension contract review. `WorkflowResult.creation`, `finalizedEdits`, `ContributionProposal`, `captureProposedContribution` and create-only `beforeDigest: "missing"` are implemented but not in an approved spec. Options: (a) adopt them into `reference-cli`/`agent-skills` via spec edit; (b) narrow them to internal-only; (c) redesign. Recommend (a), keeping mechanical CLI defaults separate from workflow explicit-title/content rules. Blocks: protocol documentation, downstream delivery contracts.
- D3: Branch reconciliation of `dot/codex-integration-20261101` (local vs origin). Options: rebase/merge local onto origin, reset to origin, or keep the review branch as the source. Recommend the human choose after reviewing divergence. Blocks: `plan start`, all managed recording.

## Steps
| Plan | Step | State | Note |
| --- | --- | --- | --- |
| workflow-recording | 04 | impl-complete; managed recording pending | Criteria 1-4 met; D1/D2 open |
| manual-lifecycle | 02 | partial | clean abandon and async/typed gate prep done; public finish, forced dirty removal remain |
| manual-lifecycle | 03 | not started | depends on 02 |
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
Step: manual-lifecycle 02. First task: public trusted finish preparation consent (before the frontmatter review claim and publication), then asynchronous result handling and lease retention on uncertain failures in `plan/flows.ts` and `core/confirmed-operations.ts`. Keep rebase, acceptance, publication and merge gates distinct. Do not redo the recording, docs or Claude audits.

## Rules that matter
- Bun only: `npm run build` in `packages/cli`, then `bun test --parallel=20 --timeout=30000 ./dist/<files>`; full suite `timeout 120 bun test --parallel=20 --timeout=30000 ./dist` (prefix `env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT`). Never `--concurrent`; no Node runs.
- Never approve, push, rewrite history, or edit plan `status:`, step checkboxes or managed progress. Do not invent ADR kinds or contract text.
- Stage specific paths only; never `problems.md` or `AGENTS.override.md`. Preserve private backups and receipts.
- Cooperative lease-coordinated writers only; native and live-host evidence stays unrun until produced.
