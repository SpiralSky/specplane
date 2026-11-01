---
id: 2026-11-01-workflow-recording
title: "Prepared workflows and exact recording"
status: draft
specs: ["architecture/reference-cli","architecture/agent-skills","architecture/file-formats","feature/plan-steps","feature/spec-policies"]
depends_on: ["2026-11-01-core-foundation"]
---

# Prepared workflows and exact recording

## Goal

Prepared workflows and exact recording. Deliver the following scope against the reviewed extension-owned workflow design.

## Scope

- Prepare plan and non-plan workflow envelopes with compatibility/policy checks, resolved scope, expected suites and snapshots.
- Implement execution ledger, output capture, supported reporters and receipt validation.
- Add recording-set input and shared atomic recording primitive; update the manual procedure and affected callers in this same change.
- Connect criterion/provenance validation to the shared recorder, proposal revalidation and recoverable receipts.

## Non-goals

- No warning-dismissal feature, provider registry, native/background Codex capability, automatic approval/merge, or publication.
- No global host installation or paid live background run implied by this planning review.
- No pin refresh before target commits and relevant implementation review.

## Specs implemented

- `architecture/reference-cli` — requirements governing this plan’s scope and acceptance criteria.
- `architecture/agent-skills` — requirements governing this plan’s scope and acceptance criteria.
- `architecture/file-formats` — requirements governing this plan’s scope and acceptance criteria.
- `feature/plan-steps` — requirements governing this plan’s scope and acceptance criteria.
- `feature/spec-policies` — requirements governing this plan’s scope and acceptance criteria.

## Acceptance criteria

- [ ] Remote plan fast-forward precedes snapshot; divergence refuses.
- [ ] Dirty baseline, changed policy/criteria and wrong checkout are handled according to the settled contract; missing schema details become gaps before dependent code.
- [ ] Successful expected suites validate; failed/skipped-only/missing child suites do not.
- [ ] Changed input, output, receipt or request identity invalidates evidence; tests count actual reporter cases.
- [ ] Unrelated staged/unstaged/plan-folder edits and partial staging refuse before mutation.
- [ ] Empty status-only result, additions/deletions, forced rerecord and commit-failure index restoration are covered.
- [ ] Existing callers are migrated or receive actionable refusal; no silent blanket-staging fallback.
- [ ] Core alone writes status/HANDOFF; stale proposals and lost leases refuse.
- [ ] Matching retry returns existing commit; failed push retries publication without implementation or duplicate commit.
- [ ] Non-plan results cannot set lifecycle states or bypass creation operations.

## Risks

1. Human review of architecture resolutions and approval of this replacement decomposition before draft plan creation; readiness remains separate.
2. Reconcile old conductor plan ownership and unique work before starting overlapping implementation.
3. Commit the settled specification targets through an authorized workflow before snapshot/pin generation. Check context against that commit again.
4. Include relevant feature specs explicitly and obtain required human approvals before starting: agent-integration, plan-execution, configuration and Claude feature are review; Codex feature is draft. ADR 0005 is proposed; resolve its decision before relying on it as accepted authority.
5. If implementing a schema requires contract detail still absent or contradictory, record a numbered gap and settle it before dependent code; this proposal does not authorize inventing spec requirements.
6. With dependency_mode wait_for_merge, dependent plans start only after predecessors are human-finished/merged; do not silently switch to stacked execution.

The old conductor checkout has a stale Git link, and the current abandon implementation removes its worktree contrary to the preservation contract. Resolve disposition before overlapping implementation; draft creation does not authorize retirement. Preserve useful CLI regression scenarios and historical contribution records.

## Steps

1. [`01-preparation-and-state-binding.md`](steps/01-preparation-and-state-binding.md) — Prepare plan and non-plan workflow envelopes with compatibility/policy checks, resolved scope, expected suites and snapshots.
2. [`02-execution-receipts.md`](steps/02-execution-receipts.md) — Implement execution ledger, output capture, supported reporters and receipt validation.
3. [`03-manual-exact-set-recording.md`](steps/03-manual-exact-set-recording.md) — Add recording-set input and shared atomic recording primitive; update the manual procedure and affected callers in this same change.
4. [`04-workflow-validation-and-recording.md`](steps/04-workflow-validation-and-recording.md) — Connect criterion/provenance validation to the shared recorder, proposal revalidation and recoverable receipts.

## Execution prerequisites

This plan is a draft created from the user-approved decomposition in `docs/work-records/2026-11-01-implementation-proposal-review.json`. The approval authorizes draft creation only. A human must separately approve readiness and any required specifications before starting.

Dependencies: `2026-11-01-core-foundation`. Under `wait_for_merge`, each predecessor must be human-finished and merged before this plan starts.

Run steps sequentially in branch `plan/2026-11-01-workflow-recording` after CLI-managed start. Commit settled specification targets and recheck context before implementation; draft creation does not pin the current dirty specification text.
