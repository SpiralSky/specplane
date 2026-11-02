---
id: 2026-11-01-codex-delivery
title: "Codex existing-session delivery"
status: draft
specs: ["architecture/reference-cli","architecture/agent-skills","codex:architecture/codex-integration","codex:feature/codex-integration"]
depends_on: ["2026-11-01-extension-packaging"]
---

# Codex existing-session delivery

## Goal

Codex existing-session delivery. Deliver the following scope against the reviewed extension-owned workflow design.

## Scope

- Implement packaged NDJSON runner and core lifecycle channel.
- Deliver complete workflows, provenance capture and fallback documentation in the packaged skill.
- Exercise an ordinary permitted remote-backed plan with installed assets and a scripted protocol client.

## Non-goals

- No warning-dismissal feature, provider registry, native/background Codex capability, automatic approval/merge, or publication.
- No global host installation or paid live background run implied by this planning review.
- No pin refresh before target commits and relevant implementation review.

## Specs implemented

- `architecture/reference-cli` — requirements governing this plan’s scope and acceptance criteria.
- `architecture/agent-skills` — requirements governing this plan’s scope and acceptance criteria.
- `codex:architecture/codex-integration` — requirements governing this plan’s scope and acceptance criteria.
- `codex:feature/codex-integration` — requirements governing this plan’s scope and acceptance criteria.

## Acceptance criteria

- [ ] Protocol framing, request matching, stale state, disconnect and worker-stop recovery are covered.
- [ ] No persistent channel yields the labeled manual fallback; no other host is substituted.
- [ ] Consumers need not possess this repository to load required shared procedure/context.
- [ ] Manual fallback supplies the new recording manifest; unsupported identity stays unknown.
- [ ] Native/background capability flags remain false.
- [ ] Synchronize, implement, execute real assertions, record and publish; diverged remote and failed push have safe outcomes.
- [ ] Experimental fixtures remain separate; scripted evidence makes no live host/session claim.

- [ ] executeTest forwards the closed request to executeWorkflowTest under the retained lease; disconnect/cancel and permission refusal propagate.
- [ ] Docs/completion use bundled shared operations and optional-workflow guidance without source-repository dependencies.
- [ ] Consumer tests cover ordinary no-plan work, offline docs, stale manual completion and prepare/edit/executeTest/validate/record.

## Risks

1. Human review of architecture resolutions and approval of this replacement decomposition before draft plan creation; readiness remains separate.
2. Reconcile old conductor plan ownership and unique work before starting overlapping implementation.
3. Commit the settled specification targets through an authorized workflow before snapshot/pin generation. Check context against that commit again.
4. Resolve current feature and decision statuses at execution time; do not rely on historical status summaries. ADR acceptance remains a human decision.
5. If implementing a schema requires contract detail still absent or contradictory, record a numbered gap and settle it before dependent code; this proposal does not authorize inventing spec requirements.
6. With dependency_mode wait_for_merge, dependent plans start only after predecessors are human-finished/merged; do not silently switch to stacked execution.

The old conductor checkout has a stale Git link, and the current abandon implementation removes its worktree contrary to the preservation contract. Resolve disposition before overlapping implementation; draft creation does not authorize retirement. Preserve useful CLI regression scenarios and historical contribution records.

## Steps

1. [`01-persistent-runner.md`](steps/01-persistent-runner.md) — Implement packaged NDJSON runner and core lifecycle channel.
2. [`02-complete-installed-procedure.md`](steps/02-complete-installed-procedure.md) — Deliver complete workflows, provenance capture and fallback documentation in the packaged skill.
3. [`03-codex-consumer-integration.md`](steps/03-codex-consumer-integration.md) — Exercise an ordinary permitted remote-backed plan with installed assets and a scripted protocol client.

## Execution prerequisites

This plan originated in the approved November 1 decomposition. The November 2 coverage revision does not change stored readiness or authorize execution. Reconfirm readiness against the revised scope before start; resolve current spec/dependency status through the CLI.

Dependencies: `2026-11-01-extension-packaging`. Under `wait_for_merge`, each predecessor must be human-finished and merged before this plan starts.

Run steps sequentially in branch `plan/2026-11-01-codex-delivery` after CLI-managed start. Commit settled specification targets and recheck context before implementation; draft creation does not pin the current dirty specification text.
