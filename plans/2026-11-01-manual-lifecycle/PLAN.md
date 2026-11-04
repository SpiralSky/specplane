---
id: 2026-11-01-manual-lifecycle
title: "Human gates and neutral CLI lifecycle"
status: ready
specs: ["architecture/reference-cli","architecture/agent-skills","feature/spec-policies","feature/plan-execution","feature/configuration","feature/decisions","feature/agent-integration"]
depends_on: ["2026-11-01-workflow-recording"]
---

# Human gates and neutral CLI lifecycle

## Goal

Human gates and neutral CLI lifecycle. Deliver the following scope against the reviewed extension-owned workflow design.

## Scope

- Implement direct interaction port, one-use challenges, payload/state/evidence binding and expiry.
- Route approval, assist text authorization, finish and abandon through operation-specific gates and full writer lease sets.
- Extract extension-supplied adapter entry, remove standalone run surfaces, and deliver neutral startup/instruction routing with migration diagnostics.

## Non-goals

- No warning-dismissal feature, provider registry, native/background Codex capability, automatic approval/merge, or publication.
- No global host installation or paid live background run implied by this planning review.
- No pin refresh before target commits and relevant implementation review.

## Specs implemented

- `architecture/reference-cli` — requirements governing this plan’s scope and acceptance criteria.
- `architecture/agent-skills` — requirements governing this plan’s scope and acceptance criteria.
- `feature/spec-policies` — requirements governing this plan’s scope and acceptance criteria.
- `feature/plan-execution` — requirements governing this plan’s scope and acceptance criteria.
- `feature/configuration` — requirements governing this plan’s scope and acceptance criteria.
- `feature/decisions` — requirements governing this plan’s scope and acceptance criteria.
- `feature/agent-integration` — requirements governing this plan’s scope and acceptance criteria.

## Acceptance criteria

- [ ] Model tool input cannot consume a human response port.
- [ ] Decline, timeout, replay and changed bytes refuse without mutation.
- [ ] Approval/text authorization/finish acceptance/merge remain distinct; rebase invalidates prior acceptance.
- [ ] Manual human-invoked confirmations retain documented behavior; agent entry points cannot reuse them.
- [ ] Spec/ADR creation and other stateful CLI operations use checkout coordination.
- [ ] No installed-file/default/registry-order runtime selection; plain start remains usable without a host.
- [ ] Fake adapter tests cover launch uncertainty, resume, limits, cancellation, finish-ready and identity mapping without approving or merging.
- [ ] CLI help, docs and callers match removed commands; host capabilities remain gated until later verification.

- [ ] Completion declarations and ordinary Git remain separate from review approval; metadata-only completion never triggers body-writing approval.
- [ ] Human gates retain target binding and prospective index transaction invariants.

## Risks

1. Human review of architecture resolutions and approval of this replacement decomposition before draft plan creation; readiness remains separate.
2. Reconcile old conductor plan ownership and unique work before starting overlapping implementation.
3. Commit the settled specification targets through an authorized workflow before snapshot/pin generation. Check context against that commit again.
4. Resolve current feature and decision statuses at execution time; do not rely on historical status summaries. ADR acceptance remains a human decision.
5. If implementing a schema requires contract detail still absent or contradictory, record a numbered gap and settle it before dependent code; this proposal does not authorize inventing spec requirements.
6. With dependency_mode wait_for_merge, dependent plans start only after predecessors are human-finished/merged; do not silently switch to stacked execution.

The old conductor checkout has a stale Git link, and the current abandon implementation removes its worktree contrary to the preservation contract. Resolve disposition before overlapping implementation; draft creation does not authorize retirement. Preserve useful CLI regression scenarios and historical contribution records.

## Steps

1. [`01-confirmation-challenge-primitive.md`](steps/01-confirmation-challenge-primitive.md) — Implement direct interaction port, one-use challenges, payload/state/evidence binding and expiry.
2. [`02-lifecycle-command-integration.md`](steps/02-lifecycle-command-integration.md) — Route approval, assist text authorization, finish and abandon through operation-specific gates and full writer lease sets.
3. [`03-neutral-startup-and-extension-conductor.md`](steps/03-neutral-startup-and-extension-conductor.md) — Extract extension-supplied adapter entry, remove standalone run surfaces, and deliver neutral startup/instruction routing with migration diagnostics.

## Execution prerequisites

This plan originated in the approved November 1 decomposition. The November 2 coverage revision does not change stored readiness or authorize execution. Reconfirm readiness against the revised scope before start; resolve current spec/dependency status through the CLI.

Dependencies: `2026-11-01-workflow-recording`. Under `wait_for_merge`, each predecessor must be human-finished and merged before this plan starts.

Run steps sequentially in branch `plan/2026-11-01-manual-lifecycle` after CLI-managed start. Commit settled specification targets and recheck context before implementation; draft creation does not pin the current dirty specification text.
