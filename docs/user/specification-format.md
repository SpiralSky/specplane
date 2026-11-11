---
title: Specification format
summary: Requirement files, spec files, frontmatter, citations and how approval status is computed.
related: [concepts, commands, verification, plans]
---

# Specification format

## Files

- **Requirements**: markdown files in the requirements folder (`paths.requirements`). One file, or several with one central file that lists the others as `- <file-name>: <description>` items. A requirement starts at a marker line alone on its line: `**R<n>: <Title>**` for a top-level requirement, `*R<n>.<m>: <Title>*` for a sub-requirement. A requirement file is always approved and has no approval record. A line `Retired IDs: ` followed by backticked IDs lists retired ones.
- **Feature specs**: `<paths.features>/<slug>.md`, ID `feature/<slug>`. **Architecture specs**: `<paths.architecture>/<slug>.md`, ID `architecture/<slug>`. A slug is lower-case words joined by hyphens. The ID is written in the file and must equal the path.
- `INFO.md` in a folder is documentation, not a spec, and has no frontmatter.
- Retire a spec by deleting the file. There is no `deprecated` status.

Requirement IDs are permanent: `R<n>` and `R<n>.<m>(.<k>)*`, unique across the project. A removed ID is added to the retired list and never reused; the next new one is the highest ever used plus one.

## Frontmatter

```yaml
---
id: feature/login            # required, layer/slug, equals the path
title: Login                 # required
authors:                     # required, may be empty
  - human: Alex
  - llm: claude-sonnet-5-5
    contribution: drafted    # optional
covers: [R1, R2]             # feature specs: requirements the spec has a heading for
implements: [login R3]       # architecture specs: feature spec sections it builds
references: [R7]             # every other cite used in the body
---
```

A spec file holds only what a person or LLM writes. `status`, `approval`, `review-reason`, `results` and `implementation` are not in the file; if an older file still has one, validation warns and the key is ignored until `migrate status` moves it. `covers` on an architecture spec, or `implements` on a feature spec, is an error. A cite in the body that is not in `references`, `covers` or `implements` is an error. An author is a recorded fact; an unknown identity is `unknown`.

## Citations

A cite names a part of a requirement file or another spec: `R<n>` or `R<n>.<m>` for a requirement; `<slug> R<n>` or `<slug> §<n>` for a section of a spec (a name without a layer is a feature spec; write `architecture/<slug> §<n>` for an architecture spec); `plan/<id>` for a plan; `file:<path>` for a repository file in a plan step. In frontmatter a cite is a plain string; in the body it is an inline code span whose whole content is the cite. Prose that only mentions a requirement without backticks is not a cite. A spec's `covers`, `implements` and `references` are its dependencies: a change to a cited part makes the spec `awaiting-review` with reason `outdated: <cite>`. A cite that does not resolve is reported, and a spec that cites a part that no longer exists cannot be approved.

A citable section is a heading of level 2 to 6 such as `## R11: Title`, `### R11.2: Title` or `## §2 Title`; its number is its ID and must be unique in the file. A section's content runs to the next heading of equal or shallower depth.

## Status

The effective status is computed: `approved` when an approval record applies to the current content fingerprint (`spec-v3`) and every cited part still matches, otherwise `awaiting-review` with its reason. Commands that show it: `spec list`, `spec show <id>`, `spec meta get <id>`, `validate`. See `commands` for approving, reopening and the protected overrides, and `verification` for tests and implementation records.

## Declaring tests

A line `Test T<n> (deterministic): <what and how>` or `Test T<n> (intelligent): <what and how>` in a section declares a test; its ID is `<section>#T<n>`, for example `R11#T1`. The label, not the position, is the identity. A deterministic test names a runnable command in a `specplane-test` block; see `verification`.
