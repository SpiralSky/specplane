---
name: spec-draft-architecture
description: Draft an architecture spec from one or more feature specs. Use when the user runs /spec-draft-architecture.
argument-hint: "[feature-spec-id ...]"
disable-model-invocation: true
---

# spec-draft-architecture

Drafts an architecture spec from feature specs (the `spec-draft-architecture` workflow integration).

## Preconditions

1. **Specplane configured**: if neither `.specplane/config.yaml` nor `AGENTS.md` exists at the repository root, say "This repository is not set up for Specplane. Run `specplane init --harness claude`." and stop.
2. **CLI availability**: run `command -v specplane`. If present, use the CLI for resolution, validation, and plan flows. If absent, follow the same rules by hand from the format and flow specs (`architecture/agent-skills` § Config resolution in skills) and say once that the CLI was not found. For `/validate` without the CLI, check frontmatter and IDs by hand against `architecture/file-formats` and label the result "manual check". For `/plan-finish` without the CLI, perform `feature/plan-execution` § Finish flow by hand, in its stated order.

Resolve every spec, plan, and ADR path from config (`.specplane/config.yaml`; defaults if absent), never from hardcoded paths.

## Policy check

Read `specs.architecture.llm_role` from config.

- `none`: decline.
- `assist`: review an existing architecture draft instead of producing one.
- `draft`: proceed.

## Steps

1. Identify the feature specs to implement: from `$ARGUMENTS`, otherwise ask the user.
2. Read each feature spec (resolve its path from config) and any ADRs listed in their text or whose `related_specs` include them.
3. Check each feature spec's status. Warn about any that are not `approved`; note that the architecture spec cannot be approved until they are when `specs.architecture.require_approved_features: true`.
4. Produce a draft using the template in `architecture/file-formats` §1.4.
5. Mark any place where the feature specs leave the architecture open with `<!-- GAP: <description> -->`.
6. Set `author: llm`, `status: draft`, and the `implements` list.
7. Write the draft with `Write` to `<root.path>/architecture/<slug>.md` (root from config; `base` unless the user names another).

## Output

The path to the created file and the list of GAP markers found.
