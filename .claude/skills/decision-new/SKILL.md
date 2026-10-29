---
name: decision-new
description: Create a Specplane decision record, optionally written from the user's description. Use when the user runs /decision-new.
argument-hint: "[title]"
disable-model-invocation: true
---
<!-- specplane-contract: architecture/agent-skills#decision-new@a94912d -->

# decision-new

Creates a decision record (the `decision-new` workflow integration).

## Preconditions

1. **Specplane configured**: if `.specplane/config.yaml` does not exist at the repository root (an `AGENTS.md` alone does not count), say "This repository is not set up for Specplane. Run `specplane init --harness claude`." and stop.
2. **CLI availability**: run `command -v specplane`. If present, use the CLI for resolution, validation, and plan flows. If absent, follow the same rules by hand from the format and flow specs (`architecture/agent-skills` § Config resolution in skills) and say once that the CLI was not found. For `/validate` without the CLI, check frontmatter and IDs by hand against `architecture/file-formats` and label the result "manual check". `/plan-finish` without the CLI stops and tells the user to install it.

Resolve every spec, plan, and ADR path from config (`.specplane/config.yaml`), never from hardcoded paths.

## Policy check

The record starts as `status: proposed`; accepting it is the `/approve` integration. Write the body only from the user's description: do not invent alternatives, consequences, or decisions.

## Steps

`$ARGUMENTS` is `[title]`: the title to use when it is given.

1. Run `specplane decision new "<title>"` and keep the reported path.
2. If the user describes the decision, write the body sections from `feature/decisions#adr-body-structure` from that description only, marking anything left open as open.
3. Otherwise leave the sections for the user to fill in.

## Output

The created path and the sections still open.
