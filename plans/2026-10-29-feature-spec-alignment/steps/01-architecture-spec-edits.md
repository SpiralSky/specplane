---
plan: 2026-10-29-feature-spec-alignment
step: 1
title: Architecture spec edits for reference-cli and file-formats
status: pending
context:
  - spec: architecture/reference-cli
  - spec: architecture/file-formats
  - spec: feature/spec-precedence#Spec gaps record
  - spec: feature/configuration
  - spec: feature/decisions
  - spec: feature/plan-status
  - spec: feature/plan-steps
  - spec: feature/tooling
---

## Goal

Specify in the architecture specs everything the applied feature-spec changes require, before any code changes.

## Acceptance criteria

- [ ] `architecture/file-formats` has a `spec-gaps.md` section (entry heading `## G<n>: <case>`, fields, kinds, statuses, unique and never-reused numbers) and §4 states that a re-run step appends a section with the same heading, latest wins.
- [ ] §6.2 matches `feature/decisions` § Frontmatter validation (id/filename, `superseded_by` warning, cycles).
- [ ] `architecture/reference-cli` covers: spec root path checks and the `worktree_dir` message; ADR checks; stack-mode `blocked` in `plan/status.ts`; abandon from `done`/`abandoned` fails; `--no-fetch` on start and finish; `search --kind`; `restack --dry-run` output; `spec-gaps.md` parsing, validation, and the finish-flow listing.
- [ ] `specplane spec pin` refreshed for dependants; `specplane spec pin --check` and `specplane validate` pass.

## Tasks

1. Diff `676b645~1..9491332 -- docs/specifications/features` to list every change.
2. Edit the two architecture specs; one commit per spec.
3. Re-pin overlays and skill contracts, one commit per level.

## Guidance

- Approved specs edited on a plan branch keep `status: approved`. Do not edit feature specs (`llm_role: assist`); record any gap as a `proposal` entry in this plan's `spec-gaps.md`.
- Already implemented, describe as is: `plan list --no-fetch`, the stack check at start (`plan/flows.ts`), restack errors, the base-merged notice on resume.
