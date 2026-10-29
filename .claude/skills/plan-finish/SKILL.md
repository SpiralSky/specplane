---
name: plan-finish
description: Run the finish flow for the current plan. Use when the user runs /plan-finish.
argument-hint: "[plan-id]"
disable-model-invocation: true
---
<!-- specplane-contract: architecture/agent-skills#plan-finish@9b59fd0 -->

# plan-finish

Runs the finish flow for the current plan (the `plan-finish` workflow integration).

## Preconditions

1. **Specplane configured**: if `.specplane/config.yaml` does not exist at the repository root (an `AGENTS.md` alone does not count), say "This repository is not set up for Specplane. Run `specplane init --harness claude`." and stop.
2. **CLI availability**: run `command -v specplane`. If present, use the CLI for resolution, validation, and plan flows. If absent, follow the same rules by hand from the format and flow specs (`architecture/agent-skills` § Config resolution in skills) and say once that the CLI was not found. For `/validate` without the CLI, check frontmatter and IDs by hand against `architecture/file-formats` and label the result "manual check". `/plan-finish` without the CLI stops and tells the user to install it.

Resolve every spec, plan, and ADR path from config (`.specplane/config.yaml`), never from hardcoded paths.

## Policy check

Read `config.plans` and `config.execution` before finishing.

- If the CLI is unavailable: stop and tell the user to install it; the flow is not reimplemented by hand.
- If any step of the plan is not `done` or `skipped`: stop and report which.

## Steps

1. Identify the plan: the plan ID in `$ARGUMENTS`, else the current git branch `plan/<id>`.
2. Confirm with the user: "Run finish flow for `<plan-id>`?" In attended sessions use `AskUserQuestion`. In unattended sessions proceed only if the session was explicitly started to finish the plan.
3. Invoke `specplane plan finish <id>` (readiness checks, verification, rebase, final commit, PR or merge).
4. When verification asks for acceptance-criteria confirmation, check each criterion and state the evidence.
5. The plan's handoff log is `<plans.dir>/<plan-id>/HANDOFF.md` (resolve `plans.dir` from config); it is committed on the plan branch and moves with the plan when archived. Do not touch the repo-root HANDOFF.md.

## Output

The result: PR URL, merge confirmation, or the error that stopped the flow and what to do about it.
