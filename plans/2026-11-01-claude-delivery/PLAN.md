---
id: 2026-11-01-claude-delivery
title: "Claude extension-owned workflow delivery"
status: ready
specs: ["architecture/reference-cli","architecture/agent-skills","claude:architecture/claude-integration","claude:feature/claude-integration"]
depends_on: ["2026-11-01-extension-packaging"]
---

# Claude extension-owned workflow delivery

## Goal

Claude extension-owned workflow delivery. Deliver the following scope against the reviewed extension-owned workflow design.

## Scope

- Inspect installed declarations and build a named-version API/collision/interaction compatibility fixture.
- Implement verified native handlers and policy hooks delegating to core; package internal reasoning procedures and fallback.
- Implement extension-owned session adapter against verified declarations with shared contract fixtures.

## Non-goals

- No warning-dismissal feature, provider registry, native/background Codex capability, automatic approval/merge, or publication.
- No global host installation or paid live background run implied by this planning review.
- No pin refresh before target commits and relevant implementation review.

## Specs implemented

- `architecture/reference-cli` — requirements governing this plan’s scope and acceptance criteria.
- `architecture/agent-skills` — requirements governing this plan’s scope and acceptance criteria.
- `claude:architecture/claude-integration` — requirements governing this plan’s scope and acceptance criteria.
- `claude:feature/claude-integration` — requirements governing this plan’s scope and acceptance criteria.

## Acceptance criteria

- [ ] Native APIs and direct-human port signatures have evidence before native handler implementation.
- [ ] If unavailable, report the native work blocked and retain labeled fallback; do not count unavailable capability as successful delivery.
- [ ] Mechanical handler path performs no model call; built-in commands are not shadowed.
- [ ] Human gates cannot be supplied by model output; every replaced legacy workflow has conformance coverage.
- [ ] Launch/observe/resume/cancel and budget behavior preserve core leases and recording ownership.
- [ ] Live certification requires named-version test evidence; fake-runner success alone enables no native/background capability.

- [ ] Docs/completion handlers preserve core/version parity and host command names; the optional edit hook invokes plan index --source working.
- [ ] Body policy honors exact user-approved edits under review and distinguishes implementation metadata from review status.
- [ ] Consumer coverage includes offline docs, no-plan edits, completion and target-aware managed flows under named-version capability evidence.

## Risks

1. Human review of architecture resolutions and approval of this replacement decomposition before draft plan creation; readiness remains separate.
2. Reconcile old conductor plan ownership and unique work before starting overlapping implementation.
3. Commit the settled specification targets through an authorized workflow before snapshot/pin generation. Check context against that commit again.
4. Resolve current feature and decision statuses at execution time; do not rely on historical status summaries. ADR acceptance remains a human decision.
5. If implementing a schema requires contract detail still absent or contradictory, record a numbered gap and settle it before dependent code; this proposal does not authorize inventing spec requirements.
6. With dependency_mode wait_for_merge, dependent plans start only after predecessors are human-finished/merged; do not silently switch to stacked execution.

The old conductor checkout has a stale Git link, and the current abandon implementation removes its worktree contrary to the preservation contract. Resolve disposition before overlapping implementation; draft creation does not authorize retirement. Preserve useful CLI regression scenarios and historical contribution records.

## Steps

1. [`01-host-surface-evidence.md`](steps/01-host-surface-evidence.md) — Inspect installed declarations and build a named-version API/collision/interaction compatibility fixture.
2. [`02-handlers-and-reasoning-procedures.md`](steps/02-handlers-and-reasoning-procedures.md) — Implement verified native handlers and policy hooks delegating to core; package internal reasoning procedures and fallback.
3. [`03-adapter-lifecycle-and-integration.md`](steps/03-adapter-lifecycle-and-integration.md) — Implement extension-owned session adapter against verified declarations with shared contract fixtures.

## Execution prerequisites

This plan originated in the approved November 1 decomposition. The November 2 coverage revision does not change stored readiness or authorize execution. Reconfirm readiness against the revised scope before start; resolve current spec/dependency status through the CLI.

Dependencies: `2026-11-01-extension-packaging`. Under `wait_for_merge`, each predecessor must be human-finished and merged before this plan starts.

Run steps sequentially in branch `plan/2026-11-01-claude-delivery` after CLI-managed start. Commit settled specification targets and recheck context before implementation; draft creation does not pin the current dirty specification text.
