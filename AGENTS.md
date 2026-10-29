# AGENTS.md — Specplane workflow

This repository uses Specplane to manage specs and implementation plans. This file tells any AI agent how to work in it. It is a workflow guide, not a spec: policy details live in the specs it references.

## Finding things (read this first)

Never assume a path. Everything is resolved from `.specplane/config.yaml` (if absent, defaults apply):

- `spec_roots`: list of spec roots (`name`, `path`, optional `extends`). A spec ID like `feature/foo` or `<root>:architecture/bar` resolves to a file under a root's `path`. Example default: `docs/specifications`.
- `specs`: authorship and LLM-role policy per spec type (`feature`, `architecture`).
- `plans`: the plans directory (`plans.dir`, example default `plans`), plus start and finish settings.
- `execution`: how plan steps run (`backend`, `worktree_dir`).
- `decisions`: where ADRs live (`decisions.dir`, example default `docs/decisions`).

Each plan is a folder under `plans.dir` containing `PLAN.md`, `steps/NN-<slug>.md`, and `HANDOFF.md`. Read the config before acting on any spec or plan.

## The Specplane model

- A **feature spec** says what the system does for its users. An **architecture spec** says how it is built. Both are markdown files with YAML frontmatter, including a `status` (for example `draft`, `review`, `approved`).
- A **plan** implements one or more approved specs as ordered **steps**. Each step file lists a goal, acceptance criteria, tasks, and the spec sections to load as context.
- Lifecycle: write feature specs, get them approved, draft architecture specs, approve those, create a plan, execute its steps one at a time, finish the plan.

## Authorship policies

The config's `specs.<type>.authorship` and `specs.<type>.llm_role` say what you may do:

- `llm_role: assist`: ask questions, suggest edits, and review. Do not write the spec body yourself.
- `llm_role: draft`: you may produce an initial draft for the user to review.
- `llm_role: none`: do not act on specs of that type; decline and say why.

Read the config for the current values; this file only explains what they mean. Rules and the architecture-leak guard are defined in `feature/spec-policies`.

## Precedence rules

When implementing, the architecture spec wins; the feature spec fills gaps; record each gap. If two specs contradict each other, stop: do not implement the contradicted behaviour, and report it. Full rules are in `feature/spec-precedence`.

## The step context contract

At the start of a step:

1. Read the step file.
2. Read all of the plan's `HANDOFF.md` to learn what earlier steps did and left open.
3. Read exactly the context items the step lists (spec sections, files). Avoid reading other files; if you must, record the expansion in HANDOFF.md.

Then do the tasks, check every acceptance criterion, set the step's `status` (`done` or `blocked`), and append to HANDOFF.md.

## HANDOFF.md

HANDOFF.md is an append-only log and the source of truth for plan progress. Append one section per step, never editing earlier ones:

```
## Step NN: <step title>
**Date**: YYYY-MM-DD
**Outcome**: done | skipped | blocked
### What changed
### Deviations from the plan
### Gaps found in specs
### Open issues
### What the next step must know
```

Use `None.` for an empty subsection. `Outcome` must equal the step's `status`. A blocked step needs at least one `BLOCKED:` item under Open issues.

## Writing a step commit

One commit per step, containing the step's changes, the updated step file, and the HANDOFF.md section. Message format:

```
plan/<plan-id> step NN: <slug>

- bullet summary of the changes
```

## Common flows

- **Start a feature spec**: create the file under the base spec root from the feature template; the user writes it. Under `assist`, help by asking questions and reviewing.
- **Assist with a feature spec**: check `specs.feature.llm_role` first; suggest and critique, do not draft unless the policy allows.
- **Draft an architecture spec**: requires the feature specs it covers to be in an acceptable status (see `specs.architecture.require_approved_features`); derive the design from them.
- **Create a plan**: check `plans.require_approved_specs`, then create the plan folder, `PLAN.md`, and step files, each step listing its context.
- **Execute the next step**: follow the step context contract above, work in the plan's branch or worktree (per `execution`), and commit as described.
- **Finish a plan**: confirm all steps are done, run `plans.test_command` if set, then follow `plans.merge` (open a pull request or merge locally).
- **Validate**: run `specplane validate` when the CLI is available; otherwise check frontmatter, links, and status rules by hand.
