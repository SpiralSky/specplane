---
plan: 2026-10-29-cli-spec-search
step: 2
title: Feature-spec proposals for tooling, decisions, configuration, precedence
status: pending
context:
  - spec: feature/tooling#`specplane spec`
  - spec: feature/tooling#`specplane plan`
  - spec: feature/decisions#ADR frontmatter
  - spec: feature/decisions#Acceptance scenarios
  - spec: feature/configuration
  - spec: feature/spec-precedence
  - file: HANDOFF.md
---

## Goal

Record the feature-spec review findings assigned to this plan as written proposals for the user to review.

## Acceptance criteria

- [ ] `plans/2026-10-29-cli-spec-search/feature-spec-proposals.md` has one section per finding below, each with target, problem, proposed text, reason.
- [ ] No file under `docs/specifications/features/` or `harnesses/*/specifications/features/` is modified (`git diff --stat` shows only the proposal file and plan files).

## Tasks

1. Write `plans/2026-10-29-cli-spec-search/feature-spec-proposals.md` (feature specs are `llm_role: assist`, so agents never edit them). One section per finding: target spec and anchor, the problem, proposed replacement text, and the reason. Proposals only; list the file in this step's HANDOFF 'What the next step must know' and 'Open issues' as 'needs user review'. Findings: (a) `feature/tooling`: `--no-fetch` is missing from the options list of the commands that fetch (`plan list --live`, `plan start`, `plan finish`); `--type` takes `feature|architecture` in `spec list` and `spec|plan` in `search`, so name the two options distinctly or document the difference. (b) `feature/decisions`: validation cases for ADR id/filename mismatch and for `superseded_by` that is missing or forms a cycle. (c) `feature/configuration`: errors for a `worktree_dir` that resolves inside the repository and for `spec_roots` paths that do not exist or escape the repository. (d) `feature/spec-precedence`: "both silent" (neither spec covers the case) has no numbered rule; propose one.

## Guidance

- Quote the current spec text in each proposal so the user can apply it without re-reading.
- Each proposal stands alone; do not propose behaviour that needs an unapproved decision without saying so.
