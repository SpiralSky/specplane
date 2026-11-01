---
id: 2026-11-01-core-foundation
title: "Core contracts, coordination and provenance"
status: draft
specs: ["architecture/reference-cli","architecture/file-formats","feature/tooling","feature/agent-integration"]
---

# Core contracts, coordination and provenance

## Goal

Core contracts, coordination and provenance. Deliver the following scope against the reviewed extension-owned workflow design.

## Scope

- Remove inherited nested-runner context and add execution-count plus deliberately failing child coverage.
- Create import-safe core entry, typed ports, compatibility validator and closed shared schemas. Unimplemented mutating operations explicitly refuse.
- Implement canonical repository/checkout/plan lock identities and ordered acquisition as a reusable primitive.
- Implement worker generation/token delegation, stop acknowledgment and recovery on the lease primitive.
- Implement event validation/deduplication and repeated-trailer read/write support.

## Non-goals

- No warning-dismissal feature, provider registry, native/background Codex capability, automatic approval/merge, or publication.
- No global host installation or paid live background run implied by this planning review.
- No pin refresh before target commits and relevant implementation review.

## Specs implemented

- `architecture/reference-cli` — requirements governing this plan’s scope and acceptance criteria.
- `architecture/file-formats` — requirements governing this plan’s scope and acceptance criteria.
- `feature/tooling` — requirements governing this plan’s scope and acceptance criteria.
- `feature/agent-integration` — requirements governing this plan’s scope and acceptance criteria.

## Acceptance criteria

- [ ] A correct child executes its expected test; a broken implementation fails the outer fixture.
- [ ] Existing historical results are not relabeled as verified.
- [ ] Importing the core does not parse CLI arguments or mutate a checkout.
- [ ] Unknown fields, wrong versions and invalid asset digests refuse; unknown host version disables native/background capability.
- [ ] Alias paths share one checkout lock; competing non-plan and plan writers cannot overlap.
- [ ] Multi-checkout contention releases acquired subsets safely; malformed coordination data fails closed.
- [ ] Dead parent/live worker cannot be reclaimed; stale tokens cannot record.
- [ ] Cancellation retains edits; uncertain stop requires recovery; delegated operations do not recursively lock.
- [ ] Same-session A/B, later C and subagent contributions survive serialization and rewrites.
- [ ] Unknown identities remain unknown; duplicate event IDs cannot duplicate attribution.

## Risks

1. Human review of architecture resolutions and approval of this replacement decomposition before draft plan creation; readiness remains separate.
2. Reconcile old conductor plan ownership and unique work before starting overlapping implementation.
3. Commit the settled specification targets through an authorized workflow before snapshot/pin generation. Check context against that commit again.
4. Include relevant feature specs explicitly and obtain required human approvals before starting: agent-integration, plan-execution, configuration and Claude feature are review; Codex feature is draft. ADR 0005 is proposed; resolve its decision before relying on it as accepted authority.
5. If implementing a schema requires contract detail still absent or contradictory, record a numbered gap and settle it before dependent code; this proposal does not authorize inventing spec requirements.
6. With dependency_mode wait_for_merge, dependent plans start only after predecessors are human-finished/merged; do not silently switch to stacked execution.

The old conductor checkout has a stale Git link, and the current abandon implementation removes its worktree contrary to the preservation contract. Resolve disposition before overlapping implementation; draft creation does not authorize retirement. Preserve useful CLI regression scenarios and historical contribution records.

## Steps

1. [`01-trustworthy-subprocess-tests.md`](steps/01-trustworthy-subprocess-tests.md) — Remove inherited nested-runner context and add execution-count plus deliberately failing child coverage.
2. [`02-core-boundary-and-compatibility.md`](steps/02-core-boundary-and-compatibility.md) — Create import-safe core entry, typed ports, compatibility validator and closed shared schemas. Unimplemented mutating operations explicitly refuse.
3. [`03-ordered-writer-leases.md`](steps/03-ordered-writer-leases.md) — Implement canonical repository/checkout/plan lock identities and ordered acquisition as a reusable primitive.
4. [`04-delegation-and-cancellation.md`](steps/04-delegation-and-cancellation.md) — Implement worker generation/token delegation, stop acknowledgment and recovery on the lease primitive.
5. [`05-contribution-capture-and-readers.md`](steps/05-contribution-capture-and-readers.md) — Implement event validation/deduplication and repeated-trailer read/write support.

## Execution prerequisites

This plan is a draft created from the user-approved decomposition in `docs/work-records/2026-11-01-implementation-proposal-review.json`. The approval authorizes draft creation only. A human must separately approve readiness and any required specifications before starting.

This plan has no predecessor dependency.

Run steps sequentially in branch `plan/2026-11-01-core-foundation` after CLI-managed start. Commit settled specification targets and recheck context before implementation; draft creation does not pin the current dirty specification text.
