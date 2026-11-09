# Shared format for the rewritten feature specs

Written 2026-11-09 (spec rewrite session 1). Every new feature spec in `docs/specifications/features/` follows this. It implements `R5`, `R7`, `R9`, `R10`, `R11` and `R40` of `docs/requirements/product-requirements.md`; the spec `specifications` states the same rules as user-visible behaviour. If this record and the page disagree, the page wins.

## 1. File and ID

- One markdown file per spec, `docs/specifications/features/<slug>.md`. ID is `feature/<slug>`, derived from the path and never changed.
- A spec is retired by deleting its file (git keeps it), not by a `deprecated` status (assumption, see HANDOFF "Spec rewrite progress").
- `INFO.md` in a folder is documentation, not a spec, and has no frontmatter.

## 2. Frontmatter

```yaml
---
id: feature/<slug>
title: <Title>
status: awaiting-review
authors:
  - llm: claude-sonnet-5-5
    contribution: drafted
covers: [R1, R2]
references: [R7, R11.2, plans R28]
---
```

- `status`: only `awaiting-review` or `approved` (`R11`). New specs are written as `awaiting-review`. Nothing here sets `approved`; approval is recorded by Specplane with who approved and the commit (`R11.1`), never typed by an LLM.
- `authors`: list; each item is `human: <name>` or `llm: <model id>` with an optional `contribution` (`R10.1`) such as `drafted`, `revised`, `reviewed`. Only record what happened; do not invent a human author.
- `references`: every citation the body uses, deduplicated (`R9`). A citation in the body that is missing from this list is a format error.
- `covers`: the requirement IDs this spec is responsible for. Each requirement is normally covered by one spec; a requirement may be covered by several, and the owner may keep it requirement-only (`R62`, `R63`, and their sub-requirements).

## 3. Sections and traceability (`R5`, `R7`)

- Body starts with a short purpose paragraph, then one section per covered requirement. Heading form: `## R<n>: <Requirement title>`; its subsections that cover sub-requirements use `### R<n>.<m>: <title>`. Everything in a section is behaviour that traces to that R-id.
- Material that covers no requirement (examples, scenarios, edge cases, terms) goes in sections headed `## §<n> <title>` (subsections `### §<n>.<m>`).
- Scenarios use Given/When/Then and sit under the section they test.
- Compliance tests (`R61`): a section may declare tests as `Test (deterministic): <what and how>` or `Test (intelligent): <what and how>`. A section with none is checked by intelligent judgement.
- Behaviour only: no file formats, module names, data schemas or algorithms. User-visible names (commands, config keys, statuses) are fine.

## 4. Citations

| Cite | Meaning |
|------|---------|
| `R11`, `R11.2` | The requirement or sub-requirement itself, on the page |
| `<slug> R<n>` | The section of that feature spec that covers `R<n>`, for example `plans R28` |
| `<slug> §<n>` | A non-requirement section, for example `plans §2` |
| `architecture/<slug> R<n>` | The same for an architecture spec; a bare slug always means a feature spec |
| `<project>:<cite>` | A cite into a subproject or the root project, for example `claude:R7`, `claude:harness R14`. No project means the citing spec's own project. `root` names the root project and is not allowed as a subproject name; spec IDs are unique per project. Assumption (session 13): the page only says the project is named |

A citation to a part of a spec means that section and its subsections only. A bare spec cite (`plans`) means the whole spec and should be avoided, because `R11.2` marks a citing spec outdated when any cited part changes.

## 5. Order and dependencies

Specs are written in the order in `docs/release-plan.md` as listed in HANDOFF. A spec may cite a spec that is not written yet by its planned slug (`plans`, `plan-execution`, `roles-and-permissions`, `requests`, `steering`, `harness`, `cli`, `verification`, `configuration`, `later-releases`); keep such citations at requirement level (`R28`) when the target section does not exist yet.
