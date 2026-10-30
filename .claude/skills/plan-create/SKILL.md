---
name: plan-create
description: Create a new Specplane plan interactively. Use when the user runs /plan-create.
argument-hint: "[goal]"
disable-model-invocation: true
---
<!-- specplane-contract: architecture/agent-skills#plan-create@396f26e -->

# plan-create

Creates a new plan interactively (the `plan-create` workflow integration).

## Preconditions

1. **Specplane configured**: if `.specplane/config.yaml` does not exist at the repository root (an `AGENTS.md` alone does not count), say "This repository is not set up for Specplane. Run `specplane init --harness claude`." and stop.
2. **CLI availability**: run `command -v specplane`. If present, use the CLI for resolution, validation, and plan flows. If absent, follow the same rules by hand from the format and flow specs (`architecture/agent-skills` § Config resolution in skills) and say once that the CLI was not found. For `/validate` without the CLI, check frontmatter and IDs by hand against `architecture/file-formats` and label the result "manual check". `/plan-finish` without the CLI stops and tells the user to install it.

Resolve every spec, plan, and ADR path from config (`.specplane/config.yaml`), never from hardcoded paths.

## Policy check

Read `plans.require_approved_specs` from config. Specs below the requirement produce a warning: the plan can be created, but not started, until they are approved.

## Steps

Use `AskUserQuestion` for the slug, spec, and dependency choices when it is available.

1. Ask for the goal (use `$ARGUMENTS` if given) and title; propose a slug (2-4 words) and the ID `<today>-<slug>`. Confirm it does not exist.
2. Ask for the specs and dependencies; resolve each spec ID (no root context) and plan ID. Reject unknown IDs, abandoned dependencies, and dependency cycles.
3. Draft the PLAN.md body sections (`architecture/file-formats` §2.2) with the user.
4. Propose a step decomposition following `feature/plan-steps` § Step grouping guidance, with a `context` list per step (spec IDs with anchors, `decision/NNNN` IDs, file paths). Ordering check: confirm that each step depends only on earlier steps (nothing a step needs is produced by a later one) and reorder before showing the proposal if not.
5. After user approval, create `<plans.dir>/<id>/PLAN.md` (`status: draft`), an empty `<plans.dir>/<id>/HANDOFF.md` (header only; `/plan-step` appends step sections), and `steps/NN-<slug>.md` files (`status: pending`), using `specplane plan new` when available.
6. Run validation on the new plan. Without the CLI, apply `architecture/file-formats` §2 by hand (create the files, check IDs and dependencies manually) and tell the user validation was not run.

## Output

The plan ID, path, and step list, with a reminder that a human sets `status: ready` before the plan can be started.
