---
name: plan-abandon
description: Abandon a Specplane plan after confirmation. Use when the user runs /plan-abandon.
argument-hint: "[plan-id]"
disable-model-invocation: true
---
<!-- specplane-contract: architecture/agent-skills#plan-abandon@74958ce -->

# plan-abandon

Abandons a plan (the `plan-abandon` workflow integration).

## Preconditions

1. **Specplane configured**: if `.specplane/config.yaml` does not exist at the repository root (an `AGENTS.md` alone does not count), say "This repository is not set up for Specplane. Run `specplane init --harness claude`." and stop.
2. **CLI availability**: run `command -v specplane`. If present, use the CLI for resolution, validation, and plan flows. If absent, follow the same rules by hand from the format and flow specs (`architecture/agent-skills` § Config resolution in skills) and say once that the CLI was not found. For `/validate` without the CLI, check frontmatter and IDs by hand against `architecture/file-formats` and label the result "manual check". `/plan-finish` without the CLI runs its manual mode (labelled "manual mode: no stale-base or divergence checks").

Resolve every spec, plan, and ADR path from config (`.specplane/config.yaml`), never from hardcoded paths.

## Policy check

Read `config.plans`. Abandoning keeps the branch and worktree unless the user asks for deletion (`feature/plan-execution`). Unattended: do not proceed; report the plan that would be abandoned instead.

## Steps

`$ARGUMENTS` is `[plan-id]`: any token is the plan ID.

1. Identify the plan: the ID argument, else the current branch.
2. Show what is being abandoned: stored status, step progress, branch, and checkout. Ask the user to confirm; use `AskUserQuestion` in attended sessions.
3. Run `specplane plan abandon <id>`; add the branch-deletion option only when the user asks for it.

## Output

The result, and the documented manual cleanup for a branch that is kept (`git branch -D plan/<id>`).
