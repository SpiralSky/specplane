---
plan: 2026-10-29-assist-and-approve
step: 4
title: plan approve, decision new, and decision accept
status: done
context:
  - spec: "feature/tooling#`specplane plan approve <id>...`"
  - spec: "feature/tooling#`specplane decision`"
  - spec: feature/decisions
  - spec: architecture/reference-cli
  - file: packages/cli/src/commands/plan.ts
  - file: packages/cli/src/decisions/
  - file: packages/cli/src/cli.ts
---

## Goal

Approve plans and accept decision records from the CLI, and create new decision records with the next free number.

## Acceptance criteria

- [x] `plan approve` sets `draft` → `ready` and commits `docs(<plan-id>): approve plan`; it refuses with the `feature/tooling` messages (unknown, not `draft`, uncommitted, unapproved specs per `plans.require_approved_specs`, validation errors).
- [x] `decision new <title>` creates `<decisions.dir>/<NNNN>-<slug>.md` with `status: proposed` and the ADR body sections; an existing file is refused.
- [x] `decision accept` sets `proposed` → `accepted` and commits `docs(decisions): accept <id>`; it refuses non-`proposed` ADRs and uncommitted changes.
- [x] `feature/tooling` Scenario 10 and the error cases have tests; `npm test` passes.

## Tasks

1. Add `plan approve` and the `decision` command group.
2. Add tests.
