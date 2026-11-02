---
id: 2026-11-02-target-lifecycle
title: "Target binding and lifecycle reconciliation"
status: ready
specs: ["architecture/reference-cli", "architecture/file-formats", "feature/plan-execution", "feature/configuration", "feature/tooling", "feature/plan-system"]
depends_on: ["2026-11-01-core-foundation"]
---

# Target binding and lifecycle reconciliation

## Goal

Target binding and lifecycle reconciliation under the settled architecture contracts.

## Scope

- Resolve targets and validate immutable execution bindings
- Create and resume plans against their recorded target
- Use target context in plan discovery and reports
- Use recorded destinations for finish and restack
- Implement explicit retarget previews and atomic metadata updates
- Reconcile shelving, resume and integration-checked cleanup

## Non-goals

No lifecycle approval, automatic merge/publication, host certification, or implicit guidance installation. Preserve existing plan history and user-owned content.

## Specs implemented

- `architecture/reference-cli`
- `architecture/file-formats`
- `feature/plan-execution`
- `feature/configuration`
- `feature/tooling`
- `feature/plan-system`

## Acceptance criteria

- [ ] Explicit, declared, team and repository-default precedence is deterministic; ambiguous or unavailable legacy targets refuse.
- [ ] Target and comparison inputs resolve valid commits/branches; malformed bindings fail before mutation.
- [ ] First start validates target-local plans/specs/dependencies and records immutable provenance before execution.
- [ ] Dirty reused worktrees skip setup and survive failure; missing checkout recreation preserves branch and step commits.
- [ ] List/show/live discovery report target, starting commit, comparison base and pending retarget state consistently.
- [ ] Missing/offline refs and manually declared done without integration are distinguished.
- [ ] Rebase, PR base and local merge use the recorded destination; ambiguous legacy provenance refuses.
- [ ] Target changes or rebase invalidate prior acceptance; cross-target stacks refuse; failed operations preserve recoverable state.
- [ ] Dry-run/JSON inspect identical preconditions without mutation; actual writes recheck refs, leases and plan identity.
- [ ] PR base/lifecycle conflicts and missing required forge evidence refuse; original start/comparison provenance survives; no commit, rebase or PR edit occurs.
- [ ] Shelving preserves checkout/branch/history and blocks execution until explicit resume.
- [ ] Automated worktree/branch removal requires independent integration evidence; a manual done edit alone never permits cleanup.

## Risks

Target/bootstrap selection and readiness are human decisions. Dependencies must be finished and integrated under wait_for_merge. A missing contract becomes a numbered spec gap before dependent implementation. Changes that exceed a small reviewable component must be split before execution.

## Steps

1. [Resolve targets and validate immutable execution bindings](steps/01-target-resolution.md)
2. [Create and resume plans against their recorded target](steps/02-target-start.md)
3. [Use target context in plan discovery and reports](steps/03-target-readers.md)
4. [Use recorded destinations for finish and restack](steps/04-target-finish.md)
5. [Implement explicit retarget previews and atomic metadata updates](steps/05-retarget.md)
6. [Reconcile shelving, resume and integration-checked cleanup](steps/06-shelve-cleanup.md)

## Execution prerequisites

Create through the existing CLI after proposal approval; readiness and start remain separate human decisions. The current CLI does not support target/comparison inputs: do not synthesize execution metadata. Resolve the bootstrap exception explicitly before execution.
