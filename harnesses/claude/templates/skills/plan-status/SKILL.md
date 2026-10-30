---
name: plan-status
description: Show where Specplane plans stand, with progress and the next step. Use when the user runs /plan-status or plan state is relevant.
disable-model-invocation: false
---
<!-- specplane-contract: architecture/agent-skills#plan-status@8c6880a -->

# plan-status

Shows where plans stand (the `plan-status` workflow integration). Read-only.

## Preconditions

1. **Specplane configured**: if `.specplane/config.yaml` does not exist at the repository root (an `AGENTS.md` alone does not count), say "This repository is not set up for Specplane. Run `specplane init --harness claude`." and stop.
2. **CLI availability**: run `command -v specplane`. If present, use the CLI for resolution, validation, and plan flows. If absent, follow the same rules by hand from the format and flow specs (`architecture/agent-skills` § Config resolution in skills) and say once that the CLI was not found. For `/validate` without the CLI, check frontmatter and IDs by hand against `architecture/file-formats` and label the result "manual check". `/plan-finish` without the CLI stops and tells the user to install it.

Resolve every spec, plan, and ADR path from config (`.specplane/config.yaml`), never from hardcoded paths.

## Policy check

Read config only; this integration changes nothing.

## Steps

1. Run `specplane plan list --live` (without the CLI, read `PLAN.md` and step files by hand).
2. When the session is in a plan's checkout (branch `plan/<id>`), highlight that plan. If `cwd` is not that plan's `checkout` (compare real paths; skip when `checkout` is null), warn once and name the `cd <checkout>` line.
3. Summarise per plan: effective status, step progress, next step, `where`, `checkout`, and any `BLOCKED:` items.
4. Point out plans that need attention: a next step that is blocked, or a stacked plan whose base has merged (`feature/plan-execution` § Restacking).

## Output

The summary, current plan first when there is one.
