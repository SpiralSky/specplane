---
plan: 2026-11-01-manual-lifecycle
step: 2
title: "Lifecycle command integration"
status: done
context:
  - spec: "architecture/reference-cli#Revision-bound human confirmation"
  - file: "packages/cli/src/commands/spec-approve.ts"
  - file: "packages/cli/src/commands/plan-approve.ts"
  - file: "packages/cli/src/commands/decision.ts"
  - file: "packages/cli/src/plan/flows.ts"
---

## Goal

Route approval, assist text authorization, finish and abandon through operation-specific gates and full writer lease sets.

## Acceptance criteria

- [ ] Approval/text authorization/finish acceptance/merge remain distinct; rebase invalidates prior acceptance.
- [ ] Manual human-invoked confirmations retain documented behavior; agent entry points cannot reuse them.
- [ ] Spec/ADR creation and other stateful CLI operations use checkout coordination.

- [ ] Completion declarations and ordinary Git remain separate from review approval; metadata-only completion never triggers body-writing approval.
- [ ] Human gates retain target binding and prospective index transaction invariants.

## Tasks

1. Route approval, assist text authorization, finish and abandon through operation-specific gates and full writer lease sets.
2. Verify each acceptance criterion with the applicable automated checks or required host evidence.
3. Record results, limitations and any specification gaps through the plan-step workflow.

Additional tasks for the settled contracts:

- Test ordinary non-plan edits, exact-approved review edits, manual completion and retarget changes without inventing lifecycle authority.

## Guidance

Complete step 1 before this step.

Follow the architecture before feature details. Record missing or contradictory requirements in `spec-gaps.md` and resolve them before dependent implementation. Execute only in this plan’s designated checkout; let the workflow record progress.
