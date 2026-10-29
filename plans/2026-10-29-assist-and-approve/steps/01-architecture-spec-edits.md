---
plan: 2026-10-29-assist-and-approve
step: 1
title: Architecture spec edits for the review and assist roles and approval commands
status: pending
context:
  - spec: "feature/spec-policies#Refine-then-write (`llm_role: assist`)"
  - spec: feature/agent-integration
  - spec: feature/tooling
  - spec: feature/configuration
  - spec: claude:feature/claude-integration
  - spec: architecture/agent-skills
  - spec: architecture/reference-cli
  - spec: architecture/file-formats
  - spec: claude:architecture/claude-integration
---

## Goal

Specify in the architecture specs everything the approved feature-spec changes require, before any code changes.

## Acceptance criteria

- [ ] `architecture/agent-skills`: `spec-assist` has a refine-then-write mode (`assist`) and a review-only mode (`review`); `spec-draft-architecture` follows refine-then-write under `assist`; contracts for `approve`, `plan-start`, `decision-new`, `plan-status`, `plan-abandon`, each with a Policy check section.
- [ ] `architecture/reference-cli`: `review` in the `llm_role` schema; `spec approve` (checks, re-pin of overlay bases, one commit per id, stop at first refusal), `spec reopen` (cascade report), `plan approve`, `decision new` (next free number), `decision accept`; error classes and message texts from `feature/tooling`.
- [ ] `architecture/file-formats` §8: `Specplane-Workflow: approve` and the commit subjects `docs(specs): approve <id>`, `docs(specs): reopen <id>`, `docs(<plan-id>): approve plan`, `docs(decisions): accept <id>`.
- [ ] `claude:architecture/claude-integration`: skill table rows (`/approve` has `disable-model-invocation: true`); the guard maps `review` and `assist` to ask and denies edits that set `approved`, `ready`, or `accepted`.
- [ ] Dependants re-pinned (one commit per level); `specplane validate` has 0 errors.

## Tasks

1. Edit the four architecture specs.
2. Re-pin `claude:architecture/claude-integration` and the skill contract markers that pin `agent-skills` (the markers are updated in step 05; record that here).
