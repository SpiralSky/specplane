---
name: spec-assist
description: Help the user write or review a feature spec without authoring it. Use when the user runs /spec-assist or asks for help with a feature spec.
argument-hint: "[topic]"
disable-model-invocation: false
---
<!-- specplane-contract: architecture/agent-skills#spec-assist@a8e55f4 -->

# spec-assist

Helps the user write a feature spec without authoring it (the `spec-assist` workflow integration). The user stays the author; you ask, suggest, and review.

## Preconditions

1. **Specplane configured**: if `.specplane/config.yaml` does not exist at the repository root (an `AGENTS.md` alone does not count), say "This repository is not set up for Specplane. Run `specplane init --harness claude`." and stop.
2. **CLI availability**: run `command -v specplane`. If present, use the CLI for resolution, validation, and plan flows. If absent, follow the same rules by hand from the format and flow specs (`architecture/agent-skills` § Config resolution in skills) and say once that the CLI was not found. For `/validate` without the CLI, check frontmatter and IDs by hand against `architecture/file-formats` and label the result "manual check". `/plan-finish` without the CLI stops and tells the user to install it.

Resolve every spec, plan, and ADR path from config (`.specplane/config.yaml`), never from hardcoded paths.

## Policy check

Read `specs.feature.llm_role` from config.

- `none`: decline and explain that LLM help on feature specs is disabled.
- `assist`: proceed in help mode. Never produce a feature spec body, even if asked (for example "Write the feature spec for search"): offer to ask questions or review the user's draft instead.
- `draft`: drafting is permitted, but default to help mode unless the user asks for a draft.

## Steps

1. Ask what the spec should be about (use `$ARGUMENTS` as the topic if given) and who it is for.
2. Suggest a structure (list of section headings) based on the feature spec template in `architecture/file-formats` §1.3.
3. For each section, ask a clarifying question to surface edge cases and acceptance scenarios.
4. If the user provides a draft, review it for missing acceptance scenarios, ambiguous rules, and architecture-leak violations (implementation detail that is not part of the user-visible interface).
5. Self-check every suggestion and proposed edit before showing it: it must not introduce implementation detail (the same architecture-leak test as step 4) and must not contradict the user's existing text. Rewrite or drop any that fail.
6. Propose edits to the user's text; never write the file without explicit approval. Never use `Write` or `Edit` on a feature spec without the user's explicit approval of the exact change.

## Output

A summary of suggested additions and changes. The user approves, and you apply only what was approved.
