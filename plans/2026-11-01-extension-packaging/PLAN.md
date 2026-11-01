---
id: 2026-11-01-extension-packaging
title: "Compatible packages and recoverable installation"
status: draft
specs: ["architecture/reference-cli","architecture/agent-skills","feature/agent-integration"]
depends_on: ["2026-11-01-manual-lifecycle"]
---

# Compatible packages and recoverable installation

## Goal

Compatible packages and recoverable installation. Deliver the following scope against the reviewed extension-owned workflow design.

## Scope

- Produce reusable package builder and complete asset/procedure inventories against committed targets.
- Implement common/host destination validation, ownership digests, journal, backups and recovery.
- Connect explicit installation selection and neutral guidance; gate legacy retirement on replacement readiness.

## Non-goals

- No warning-dismissal feature, provider registry, native/background Codex capability, automatic approval/merge, or publication.
- No global host installation or paid live background run implied by this planning review.
- No pin refresh before target commits and relevant implementation review.

## Specs implemented

- `architecture/reference-cli` — requirements governing this plan’s scope and acceptance criteria.
- `architecture/agent-skills` — requirements governing this plan’s scope and acceptance criteria.
- `feature/agent-integration` — requirements governing this plan’s scope and acceptance criteria.

## Acceptance criteria

- [ ] Every runtime/dependency asset and required procedure is covered and resolvable from the built package.
- [ ] Tampered or incompatible bundle refuses before mutation; a pin is not treated as conformance evidence.
- [ ] Dangling links and changed path components never write outside the target.
- [ ] Customized files survive; interruption at each transaction phase recovers without partial activation.
- [ ] Both install orders and repeated init preserve the other extension and user settings.
- [ ] Old public skills remain available until replacements are usable; collisions keep affected commands unavailable with an exact action.
- [ ] Prepared/installed/enabled states reflect observed evidence only.

## Risks

1. Human review of architecture resolutions and approval of this replacement decomposition before draft plan creation; readiness remains separate.
2. Reconcile old conductor plan ownership and unique work before starting overlapping implementation.
3. Commit the settled specification targets through an authorized workflow before snapshot/pin generation. Check context against that commit again.
4. Include relevant feature specs explicitly and obtain required human approvals before starting: agent-integration, plan-execution, configuration and Claude feature are review; Codex feature is draft. ADR 0005 is proposed; resolve its decision before relying on it as accepted authority.
5. If implementing a schema requires contract detail still absent or contradictory, record a numbered gap and settle it before dependent code; this proposal does not authorize inventing spec requirements.
6. With dependency_mode wait_for_merge, dependent plans start only after predecessors are human-finished/merged; do not silently switch to stacked execution.

The old conductor checkout has a stale Git link, and the current abandon implementation removes its worktree contrary to the preservation contract. Resolve disposition before overlapping implementation; draft creation does not authorize retirement. Preserve useful CLI regression scenarios and historical contribution records.

## Steps

1. [`01-package-inventory-and-contract-snapshots.md`](steps/01-package-inventory-and-contract-snapshots.md) — Produce reusable package builder and complete asset/procedure inventories against committed targets.
2. [`02-containment-and-migration-transaction.md`](steps/02-containment-and-migration-transaction.md) — Implement common/host destination validation, ownership digests, journal, backups and recovery.
3. [`03-coexistence-and-legacy-rollout.md`](steps/03-coexistence-and-legacy-rollout.md) — Connect explicit installation selection and neutral guidance; gate legacy retirement on replacement readiness.

## Execution prerequisites

This plan is a draft created from the user-approved decomposition in `docs/work-records/2026-11-01-implementation-proposal-review.json`. The approval authorizes draft creation only. A human must separately approve readiness and any required specifications before starting.

Dependencies: `2026-11-01-manual-lifecycle`. Under `wait_for_merge`, each predecessor must be human-finished and merged before this plan starts.

Run steps sequentially in branch `plan/2026-11-01-extension-packaging` after CLI-managed start. Commit settled specification targets and recheck context before implementation; draft creation does not pin the current dirty specification text.
