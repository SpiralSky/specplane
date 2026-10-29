---
id: feature/decisions
title: "Architecture Decision Records (ADRs)"
status: approved
author: mixed
---

# Architecture Decision Records (ADRs)

Architecture Decision Records (ADRs) are short documents that record significant design decisions: the context, the options considered, the decision made, and its consequences. They are an optional feature of Specplane.

---

## Purpose

ADRs stop agents and humans from reopening settled debates. When a decision has been made, recorded, and linked from the relevant specs, an agent encountering the same question can read the ADR and understand why the current approach was chosen — even if the reasoning is not obvious from the spec or the code.

ADRs are not specs. They do not define what the system does or how it is built. They document why a decision was made at a point in time.

---

## Location

ADRs live in the decisions directory (config `decisions.dir`, default `docs/decisions`):

```
docs/decisions/
  0001-build-from-scratch.md
  0002-reference-cli-language.md
  ...
```

Each file is named `<NNNN>-<slug>.md`, where `NNNN` is the ADR's number. The numbering is sequential and permanent. A decision record is never deleted; if superseded, it is updated to reference its replacement.

### Number collisions

Unlike spec IDs, ADR numbers are sequential, so two ADRs created on parallel branches may receive the same number. Their filenames differ (`0003-cache-policy.md`, `0003-auth-tokens.md`), so git reports no conflict. Validation therefore treats two ADRs with the same number as an **error**; because validation runs on pull requests against the merged result, the collision is caught before merge, and the later ADR is renumbered. An ADR is referenced only by its number (never by filename), so renumbering an unmerged ADR touches only references on its own branch.

---

## ADR frontmatter

```yaml
---
id: decision/0001
title: Build from scratch rather than fork an existing tool
date: 2026-10-28
status: accepted         # proposed | accepted | superseded | deprecated
superseded_by: ""        # decision ID if superseded
related_specs: [feature/spec-system, feature/configuration]
---
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | `decision/<NNNN>` where NNNN is zero-padded to four digits. |
| `title` | string | yes | Short description of the decision. |
| `date` | ISO date | yes | Date the decision was made. |
| `status` | enum | yes | `proposed` \| `accepted` \| `superseded` \| `deprecated` |
| `superseded_by` | string | no | ID of the ADR that replaces this one, if any. |
| `related_specs` | list of IDs | no | Spec IDs this decision is relevant to. |

---

## ADR body structure

Each ADR follows this structure:

1. **Context**: the problem or situation that prompted the decision. What forces are at play?
2. **Options considered**: the alternatives evaluated, with a brief note on each (pros and cons or key characteristic).
3. **Decision**: the choice made, in one sentence.
4. **Consequences**: what follows from this decision — benefits, trade-offs, follow-up work, future options opened or closed.

---

## Linking ADRs to specs

Specs, plans, and step `context` entries reference ADRs by their ID: `decision/0001`. This is the only reference format. ADR frontmatter references specs using spec IDs in `related_specs`.

This bidirectional linking allows:
- A reader of a spec to follow the link to understand why the design is as it is.
- A reader of an ADR to find the spec that implements the decision.

---

## When to write an ADR

Write an ADR for decisions where:
- The decision will not be obvious from the spec or code.
- Reasonable alternatives exist; an agent might naturally reach for the wrong one.
- The decision was contested or had significant trade-offs.
- Future revisiting should require explicit justification rather than casual change.

Do **not** write an ADR for:
- Trivial decisions with one obvious answer.
- Decisions already explained inline in a spec.
- Decisions that were never in question.

---

## Acceptance scenarios

### Scenario 1: Agent avoids reopening a settled debate

Given `decision/0001` records "We build from scratch rather than fork an existing tool",
And `feature/spec-system` links to `decision/0001`,
When an agent is asked "Should we fork an existing tool instead?",
Then the agent reads `decision/0001`, finds the recorded decision and reasoning, and answers "This was decided in ADR 0001: we build from scratch because [reasons]. Re-opening this would require a new ADR."

### Scenario 2: Superseded ADR

Given `decision/0002` records "Store the index in a single file",
And a later `decision/0005` records "Split the index per directory",
Then `decision/0002` has `status: superseded` and `superseded_by: decision/0005`.
And `decision/0005` references `decision/0002` in its context section.

### Scenario 3: ADR referenced from spec

Given `architecture/reference-cli` has a section linking to `decision/0002`,
When an implementer reads `architecture/reference-cli` and wonders why its implementation language was chosen,
Then the link to `decision/0002` is present and provides the rationale.

### Scenario 4: ADR validation

Given `decision/0001` has `related_specs: [feature/nonexistent]`,
When `specplane validate` runs,
Then a warning is produced: "ADR `decision/0001` references unknown spec `feature/nonexistent`."

### Scenario 5: ADR number collision from parallel branches

Given branch A adds `0003-cache-policy.md` and branch B adds `0003-auth-tokens.md`,
And branch A has been merged,
When validation runs on branch B's pull request,
Then an error is reported: "Duplicate ADR number `0003`: `0003-auth-tokens.md`, `0003-cache-policy.md`. Renumber the later one."

---

## Edge cases

- ADR numbers are sequential, but the sequence may have gaps (for example, when an ADR is renumbered after a collision, or a proposed ADR on an abandoned branch never merges). Gaps are not errors; a deprecated ADR keeps its number.
- ADRs are not subject to spec policies (authorship, architecture-leak guard). They may be written by anyone.
- ADRs are not versioned within the file; significant updates are recorded as new ADRs that supersede the old.
- The decisions directory is not a spec root; its files are not validated as specs.
