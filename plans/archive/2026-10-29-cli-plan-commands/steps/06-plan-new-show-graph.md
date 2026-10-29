---
plan: 2026-10-29-cli-plan-commands
step: 6
title: plan new, show, graph
status: done
context:
  - spec: feature/tooling#`specplane plan new`
  - spec: feature/tooling#`specplane plan show <id>`
  - spec: feature/tooling#`specplane plan graph`
  - spec: feature/plan-system
  - spec: architecture/file-formats#2. Plan files
  - spec: architecture/file-formats#3. Step files
  - spec: architecture/reference-cli#Dependency graph (`plan/graph.ts`)
  - file: packages/cli/src/commands/
  - file: packages/cli/src/plan/
---

## Goal

Implement `plan new`, `plan show`, and `plan graph`.

## Acceptance criteria

- [x] `plan new --id <id> --title T --specs a,b --depends-on c` creates `PLAN.md` (status `draft`, template body), an empty `steps/`, and a header-only `HANDOFF.md`; the result passes `validate`.
- [x] An existing ID exits 1 with "Plan `<id>` already exists. Choose a different slug."; unknown spec or plan IDs and cycles are rejected.
- [x] `plan show <id>` prints the PLAN.md of an active or archived plan; unknown ID exits 1.
- [x] `plan graph` prints the same Mermaid graph as PLANS.md.
- [x] Tests for each command.

## Tasks

1. Implement the three subcommands in `commands/plan.ts` using the shared template for PLAN.md.
2. Prompt only on a TTY; otherwise require flags.
3. Integration tests.

## Guidance

- Use `AlreadyExistsError` from the previous plan.
- The plan ID defaults to today's date plus slug only when `--id` is absent.
