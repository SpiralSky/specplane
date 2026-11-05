---
plan: 2026-11-01-codex-delivery
step: 3
title: "Codex consumer integration"
status: done
context:
  - spec: "codex:architecture/codex-integration"
  - file: "packages/cli/src/harness/codex.test.ts"
---

## Goal

Exercise an ordinary permitted remote-backed plan with installed assets and a scripted protocol client.

## Acceptance criteria

- [ ] Synchronize, implement, execute real assertions, record and publish; diverged remote and failed push have safe outcomes.
- [ ] Experimental fixtures remain separate; scripted evidence makes no live host/session claim.

- [ ] Consumer tests cover ordinary no-plan work, offline docs, stale manual completion and prepare/edit/executeTest/validate/record.

## Tasks

1. Exercise an ordinary permitted remote-backed plan with installed assets and a scripted protocol client.
2. Verify each acceptance criterion with the applicable automated checks or required host evidence.
3. Record results, limitations and any specification gaps through the plan-step workflow.

Additional tasks for the settled contracts:

- Run a second-clone summary test; distinguish deterministic scripted results from live agent comprehension.

## Guidance

Complete step 2 before this step.

Follow the architecture before feature details. Record missing or contradictory requirements in `spec-gaps.md` and resolve them before dependent implementation. Execute only in this plan’s designated checkout; let the workflow record progress.
