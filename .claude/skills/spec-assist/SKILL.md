---
name: spec-assist
description: Help the user write a feature spec (refine-then-write under assist, review-only under review). Use when the user runs /spec-assist or asks for help with a feature spec.
argument-hint: "[topic]"
disable-model-invocation: false
---
<!-- specplane-contract: architecture/agent-skills#spec-assist@396f26e -->

# spec-assist

Helps the user write a feature spec (the `spec-assist` workflow integration). The mode follows `specs.feature.llm_role`: refine-then-write under `assist`, review-only under `review`.

## Preconditions

1. **Specplane configured**: if `.specplane/config.yaml` does not exist at the repository root (an `AGENTS.md` alone does not count), say "This repository is not set up for Specplane. Run `specplane init --harness claude`." and stop.
2. **CLI availability**: run `command -v specplane`. If present, use the CLI for resolution, validation, and plan flows. If absent, follow the same rules by hand from the format and flow specs (`architecture/agent-skills` § Config resolution in skills) and say once that the CLI was not found. For `/validate` without the CLI, check frontmatter and IDs by hand against `architecture/file-formats` and label the result "manual check". `/plan-finish` without the CLI stops and tells the user to install it.

Resolve every spec, plan, and ADR path from config (`.specplane/config.yaml`), never from hardcoded paths.

## Policy check

Read `specs.feature.llm_role` from config.

- `none`: decline and explain that LLM help on feature specs is disabled.
- `review`: review-only mode (below). Never write the spec body; propose edits as text and apply only an exact edit the user approves.
- `assist`: refine-then-write mode (below), following `feature/spec-policies#refine-then-write-llm_role-assist`.
- `draft`: drafting is permitted; default to refine-then-write unless the user asks for a draft.

## Steps

Refine-then-write (`assist`; also the default under `draft`):

1. **Describe**: ask the user to describe the feature in their own words (use `$ARGUMENTS` as the topic if given). Write nothing to the spec.
2. **Refine**: discuss the description to find issues — gaps, ambiguous rules, contradictions with other specs, missing edge cases and acceptance scenarios, and architecture leaks. Raise each issue with a suggested resolution; the user decides. Repeat until no issue is open or the user chooses to stop.
3. **Finalise**: summarise the agreed content (rules, scenarios, the decision on each issue, and anything left open). The user confirms the summary is final.
4. **Write**: write the body from the finalised content only, using the feature spec template in `architecture/file-formats` §1.3, and show it to the user. Write the file only after the user approves the text; mark every detail filled in as an assumption to confirm.
5. Set `author: mixed` and leave `status` unchanged. Never set it to `approved`.
6. Before writing, self-check the body: no implementation detail (the architecture-leak test) and no contradiction with the user's agreed content. Rewrite or drop any passage that fails.

Review-only (`review`):

1. Ask the user what the spec is about (use `$ARGUMENTS` as the topic if given) and who it is for.
2. Suggest a structure (list of section headings) without writing content.
3. Ask clarifying questions to surface edge cases and acceptance scenarios.
4. Review a draft the user has written: missing acceptance scenarios, ambiguous rules, and architecture-leak violations (implementation detail that is not part of the user-visible interface).
5. Self-check every suggestion and proposed edit before showing it: it must not introduce implementation detail and must not contradict the user's existing text. Rewrite or drop any that fail.
6. Propose edits as text; never write the spec body, and apply only an exact edit the user approves. Never use `Write` or `Edit` on a feature spec without the user's explicit approval of the exact change; the policy guard asks the user in this mode.

Under `draft`, the agent may also produce a `draft` with `author: llm` when the user asks.

## Output

Refine-then-write: the written body and its path, after approval, with the assumptions listed. Review-only: a summary of suggested additions and changes, applied only where the user approved them.
