---
name: plan-start
description: Start a Specplane plan and report its checkout and next step. Use when the user runs /plan-start.
argument-hint: "[plan-id]"
disable-model-invocation: true
---
<!-- specplane-contract: architecture/agent-skills#plan-start@a94912d -->

# plan-start

Starts a plan so its steps can run (the `plan-start` workflow integration).

## Preconditions

1. **Specplane configured**: if `.specplane/config.yaml` does not exist at the repository root (an `AGENTS.md` alone does not count), say "This repository is not set up for Specplane. Run `specplane init --harness claude`." and stop.
2. **CLI availability**: run `command -v specplane`. If present, use the CLI for resolution, validation, and plan flows. If absent, follow the same rules by hand from the format and flow specs (`architecture/agent-skills` § Config resolution in skills) and say once that the CLI was not found. For `/validate` without the CLI, check frontmatter and IDs by hand against `architecture/file-formats` and label the result "manual check". `/plan-finish` without the CLI stops and tells the user to install it.

Resolve every spec, plan, and ADR path from config (`.specplane/config.yaml`), never from hardcoded paths.

## Policy check

Read `execution.backend` from config (`worktree`, `branch`, or `external`).

## Steps

`$ARGUMENTS` is `[plan-id]`: any token is the plan ID.

1. Identify the plan: the plan ID argument, else the current branch `plan/<id>`, else ask the user.
2. Run `specplane plan start <id>`; it performs the checks of `feature/plan-execution` § Start flow.
3. Report the checkout path and the next step.
4. When the backend puts the plan in another checkout (`worktree`, `external`), tell the user to open a new session there: that session is told the plan and its next step by the harness. Do not run a step in a session whose checkout differs from the plan's.

## Output

The outcome, the checkout path, and the next step.
