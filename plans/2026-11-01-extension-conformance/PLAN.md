---
id: 2026-11-01-extension-conformance
title: "Cross-package conformance and rollout evidence"
status: ready
specs: ["architecture/reference-cli","architecture/agent-skills","architecture/file-formats","codex:architecture/codex-integration","claude:architecture/claude-integration"]
depends_on: ["2026-11-01-codex-delivery","2026-11-01-claude-delivery"]
---

# Cross-package conformance and rollout evidence

## Goal

Cross-package conformance and rollout evidence. Deliver the following scope against the reviewed extension-owned workflow design.

## Scope

- Run package installation, shared protocol, manual lifecycle and host workflow regression matrix from release artifacts.
- After implementation conformance review, refresh CLI-managed pins and write exact tested-version/surface evidence plus migration docs.

## Non-goals

- No warning-dismissal feature, provider registry, native/background Codex capability, automatic approval/merge, or publication.
- No global host installation or paid live background run implied by this planning review.
- No pin refresh before target commits and relevant implementation review.

## Specs implemented

- `architecture/reference-cli` — requirements governing this plan’s scope and acceptance criteria.
- `architecture/agent-skills` — requirements governing this plan’s scope and acceptance criteria.
- `architecture/file-formats` — requirements governing this plan’s scope and acceptance criteria.
- `codex:architecture/codex-integration` — requirements governing this plan’s scope and acceptance criteria.
- `claude:architecture/claude-integration` — requirements governing this plan’s scope and acceptance criteria.

## Acceptance criteria

- [ ] CLI/core paths agree for exact staging, coordination, confirmations, receipts and provenance.
- [ ] Each public export and delivered workflow maps to passing applicable tests; full implementation suite and repository validation are reported separately.
- [ ] All pins refer to committed reviewed targets; no hash-only claim of conformance.
- [ ] Warnings receive revision-bound review; no requirement to make unrelated heuristic warnings disappear.
- [ ] Human finish/merge/publication remains separate; blocked Claude delivery cannot be hidden by a generic unavailable flag.

- [ ] Acceptance covers all three index sources, target/retarget refusal paths, completion dependency changes and offline CLI/core/harness docs parity.
- [ ] Ordinary Git/manual declarations and agent interpretation are assessed separately from deterministic packaging tests.
- [ ] Spec dependency pins already current do not imply installed-skill conformance; refresh skill comments only after implementation review.

## Risks

1. Human review of architecture resolutions and approval of this replacement decomposition before draft plan creation; readiness remains separate.
2. Reconcile old conductor plan ownership and unique work before starting overlapping implementation.
3. Commit the settled specification targets through an authorized workflow before snapshot/pin generation. Check context against that commit again.
4. Resolve current feature and decision statuses at execution time; do not rely on historical status summaries. ADR acceptance remains a human decision.
5. If implementing a schema requires contract detail still absent or contradictory, record a numbered gap and settle it before dependent code; this proposal does not authorize inventing spec requirements.
6. With dependency_mode wait_for_merge, dependent plans start only after predecessors are human-finished/merged; do not silently switch to stacked execution.

The old conductor checkout has a stale Git link, and the current abandon implementation removes its worktree contrary to the preservation contract. Resolve disposition before overlapping implementation; draft creation does not authorize retirement. Preserve useful CLI regression scenarios and historical contribution records.

## Steps

1. [`01-cross-package-acceptance-matrix.md`](steps/01-cross-package-acceptance-matrix.md) — Run package installation, shared protocol, manual lifecycle and host workflow regression matrix from release artifacts.
2. [`02-pin-review-and-release-evidence.md`](steps/02-pin-review-and-release-evidence.md) — After implementation conformance review, refresh CLI-managed pins and write exact tested-version/surface evidence plus migration docs.

## Execution prerequisites

This plan originated in the approved November 1 decomposition. The November 2 coverage revision does not change stored readiness or authorize execution. Reconfirm readiness against the revised scope before start; resolve current spec/dependency status through the CLI.

Dependencies: `2026-11-01-codex-delivery`, `2026-11-01-claude-delivery`. Under `wait_for_merge`, each predecessor must be human-finished and merged before this plan starts.

Run steps sequentially in branch `plan/2026-11-01-extension-conformance` after CLI-managed start. Commit settled specification targets and recheck context before implementation; draft creation does not pin the current dirty specification text.
