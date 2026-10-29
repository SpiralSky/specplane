---
name: plan-finish
description: Run the finish flow for the current plan. Use when the user runs /plan-finish.
argument-hint: "[plan-id]"
disable-model-invocation: true
---

# plan-finish

Runs the finish flow for the current plan (the `plan-finish` workflow integration).

## Preconditions

1. **Specplane configured**: if `.specplane/config.yaml` does not exist at the repository root (an `AGENTS.md` alone does not count), say "This repository is not set up for Specplane. Run `specplane init --harness claude`." and stop.
2. **CLI availability**: run `command -v specplane`. If present, use the CLI for resolution, validation, and plan flows. If absent, follow the same rules by hand from the format and flow specs (`architecture/agent-skills` § Config resolution in skills) and say once that the CLI was not found. For `/validate` without the CLI, check frontmatter and IDs by hand against `architecture/file-formats` and label the result "manual check". For `/plan-finish` without the CLI, perform `feature/plan-execution` § Finish flow by hand, in its stated order.

Resolve every spec, plan, and ADR path from config (`.specplane/config.yaml`; defaults if absent), never from hardcoded paths.

## Policy check

None.

## Steps

1. Identify the plan: the plan ID in `$ARGUMENTS`, else the current git branch `plan/<id>`.
2. Confirm with the user: "Run finish flow for `<plan-id>`?" In attended sessions use `AskUserQuestion`. In unattended sessions proceed only if the session was explicitly started to finish the plan.
3. Invoke `specplane plan finish <id>` (readiness checks, verification, rebase, final commit, PR or merge).
4. When verification asks for acceptance-criteria confirmation, check each criterion and state the evidence.

## Output

The result: PR URL, merge confirmation, or the error that stopped the flow and what to do about it.
