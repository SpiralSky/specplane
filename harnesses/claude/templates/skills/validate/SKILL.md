---
name: validate
description: Run full Specplane repository validation and summarise the results. Use when the user runs /validate or when validation results are relevant.
disable-model-invocation: false
---

# validate

Runs full repository validation and presents actionable results (the `validate` workflow integration). Read-only.

## Preconditions

1. **Specplane configured**: if neither `.specplane/config.yaml` nor `AGENTS.md` exists at the repository root, say "This repository is not set up for Specplane. Run `specplane init --harness claude`." and stop.
2. **CLI availability**: run `command -v specplane`. If present, use the CLI for resolution, validation, and plan flows. If absent, follow the same rules by hand from the format and flow specs (`architecture/agent-skills` § Config resolution in skills) and say once that the CLI was not found. For `/validate` without the CLI, check frontmatter and IDs by hand against `architecture/file-formats` and label the result "manual check". For `/plan-finish` without the CLI, perform `feature/plan-execution` § Finish flow by hand, in its stated order.

Resolve every spec, plan, and ADR path from config (`.specplane/config.yaml`; defaults if absent), never from hardcoded paths.

## Policy check

None.

## Steps

1. Run `specplane validate --json`.
2. Parse the JSON output; group errors and warnings by file.
3. If `specs.llm_review: true`:
   a. For each feature spec (skipped if `specs.feature.llm_role: none`, or if the spec sets `allow_architecture: true`), ask: "Does this text describe how something is implemented (architecture) rather than what it does (behaviour)? List any suspect passages." Each passage becomes a warning.
   b. For each overlay spec with `extends`, read it together with its base spec and ask whether it adds to or contradicts the base. Each suspected contradiction becomes a warning quoting both passages.
4. Present a summary: "N errors, M warnings", with a suggested fix for each error (e.g. for an ID mismatch: "Rename the file or update the `id:` field").

## Output

The grouped summary. Label warnings from LLM review as such.
