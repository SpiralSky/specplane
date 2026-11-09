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

- `status`: only `awaiting-review` or `approved` (`R11`). New specs are written as `awaiting-review`. Once the CLI reads this format, Specplane records approval; until then approval is recorded by hand as in "Approval record" below.
- `authors`: list; each item is `human: <name>` or `llm: <model id>` with an optional `contribution` (`R10.1`) such as `drafted`, `revised`, `reviewed`. Only record what happened; do not invent a human author.
- `references`: every citation the body uses, deduplicated (`R9`). A citation in the body that is missing from this list is a format error.
- `covers`: the requirement IDs this spec is responsible for. Each requirement is normally covered by one spec; a requirement may be covered by several, and the owner may keep it requirement-only (`R62`, `R63`, and their sub-requirements).

### Approval record (by hand, until the CLI reads this format)

Written 2026-11-09 (session 14). Assumption: the page requires the status to be bound to the committed content and the commit it was set on (`R11`), and the approver to be recorded (`R11.1`). An approved spec therefore carries, in addition to `status: approved`:

```yaml
status: approved
approval:
  by:
    llm: claude-sonnet-5-5
    delegated-by: spiralsky
  date: 2026-11-09
  commit: <hash of the commit whose content was approved>
  note: <free text, optional>
```

- `approval.by` uses the same `human:` or `llm:` item form as `authors`. An LLM approver is recorded as an LLM, never as a human; `delegated-by` names the human whose instruction allowed it (the user's 2026-11-09 instruction that the 11 feature specs may be approved by hand-editing metadata).
- `approval.commit` is a real commit that contains the final content being approved: the last commit that changed the spec before the approval edit. The approval edit itself is a metadata-only commit and does not count as a content edit (`R11.3`).
- Content means the whole file except `status`, `approval` and `authors`. The approval stays valid while that content is byte-identical to the content at `approval.commit`, so it survives rebase and squash merge (`R11`).
- Return to Awaiting Review: a later commit that changes content returns the spec to `awaiting-review` (`R11.3`); the author sets `status: awaiting-review` and removes `approval` (git keeps the old record), and records the reason as `review-reason: edited`. If a cited part of another spec changed or was deleted (`R11.2`), the reason is `review-reason: outdated`, naming the cite. Until the CLI computes these, whoever edits a spec or a spec it cites does this by hand.
- This hand process is temporary and is replaced by CLI-recorded approval; the shape above is the proposal the CLI should read.

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
