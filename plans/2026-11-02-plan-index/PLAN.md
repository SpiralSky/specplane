---
id: 2026-11-02-plan-index
title: "Explicit plan-index snapshots and lifecycle generation"
status: done
specs: ["architecture/reference-cli", "architecture/file-formats", "architecture/ci", "feature/plan-index", "feature/tooling"]
depends_on: ["2026-11-02-target-lifecycle"]
---

# Explicit plan-index snapshots and lifecycle generation

## Goal

Explicit plan-index snapshots and lifecycle generation under the settled architecture contracts.

## Scope

- Capture head, staged and working plan snapshots
- Deliver plan index and deterministic rendering
- Integrate prospective lifecycle and recovery snapshots

## Non-goals

No lifecycle approval, automatic merge/publication, host certification, or implicit guidance installation. Preserve existing plan history and user-owned content.

## Specs implemented

- `architecture/reference-cli`
- `architecture/file-formats`
- `architecture/ci`
- `feature/plan-index`
- `feature/tooling`

## Acceptance criteria

- [ ] Each snapshot resolves its own config and plan inventory; detached/unborn HEAD and staged additions/deletions behave as specified.
- [ ] Working includes tracked ignored files and non-ignored new plans; unresolved inputs and changed discovery/index bytes refuse safely.
- [ ] Default head rendering is deterministic with the Target column; --live requires --print and print writes nothing.
- [ ] Old generate command refuses with migration guidance; CI targets the selected branch and uses head; unchanged output is not rewritten.
- [ ] Approval/shelve/resume commit new metadata and its matching index together; post-commit regeneration is byte-identical.
- [ ] Resolved staged merge/rebase/cherry-pick inputs appear in recovery rendering; unmerged plan/config inputs refuse while output-only conflict is allowed.

## Risks

Target/bootstrap selection and readiness are human decisions. Dependencies must be finished and integrated under wait_for_merge. A missing contract becomes a numbered spec gap before dependent implementation. Changes that exceed a small reviewable component must be split before execution.

## Steps

1. [Capture head, staged and working plan snapshots](steps/01-snapshot-reader.md)
2. [Deliver plan index and deterministic rendering](steps/02-index-command.md)
3. [Integrate prospective lifecycle and recovery snapshots](steps/03-transaction-snapshots.md)

## Execution prerequisites

Create through the existing CLI after proposal approval; readiness and start remain separate human decisions. The current CLI does not support target/comparison inputs: do not synthesize execution metadata. Resolve the bootstrap exception explicitly before execution.
