---
id: feature/specifications
title: Specifications
status: approved
approval:
  by:
    llm: claude-sonnet-5-5
    delegated-by: spiralsky
  date: 2026-11-09
  commit: eb3828a72200f6445cd9e9d7199de7f952896a20
  note: re-approved by the LLM, not a human, under the user's 2026-11-09 delegation after the session 16 fixes (hand-edited; see docs/work-records/2026-11-09-spec-format.md)
authors:
  - llm: claude-sonnet-5-5
    contribution: drafted
covers: [R1, R2, R4, R5, R7, R9, R10, R10.1, R11, R11.1, R11.2, R11.3, R11.4, R40, R65, R67, R68]
references: [later-releases R39.3, verification R64, plans R28, plans R30.1, roles-and-permissions R57, harness R14, configuration R25, cli R16, verification R61, plans §2]
---

# Specifications

Specifications are what Specplane exists to keep under the control of the people responsible for a product. This spec describes what a specification is, how its layers rank, what a specification file looks like, how it is cited, and how its status, authorship and current state are determined. Who may change or approve a specification is described in `roles-and-permissions`; approving by command in `cli R16`; test records in `verification R61`.

## §1 Layers

A project's specifications are in three layers, from highest to lowest: requirement, feature, architecture.

- **Requirement** specifications describe concrete aspects the product should fulfil. They are optional.
- **Feature** specifications describe concrete features for the user.
- **Architecture** specifications describe how the features are built.

Each layer is a set of markdown files the user can read, edit and review with ordinary tools. A specification is identified by its layer and a short name, for example `feature/plans` or `architecture/cli`. The identifier never changes after creation, and it matches the file's name, so two specs created on parallel branches with the same name show up as an ordinary git conflict.

A folder-level `INFO.md` may describe a layer's folder for readers. It is documentation, not a specification, and carries no specification metadata; if it does, validation reports it as probably a misnamed spec.

## R68: Required layers

Feature and architecture specifications are mandatory. Requirement specifications are optional, and Specplane works in a project that has none.

- A project with only feature and architecture specifications validates and runs plans without warnings about missing requirements.
- A feature specification that lists no requirement in `covers` is valid.

Scenario: Given a project with no requirement specifications, When the user validates it, Then nothing is reported as missing because of that.

## R65: Layer precedence

Each layer outranks the next in the order requirement, feature, architecture. When specifications in different layers conflict, an LLM follows the higher layer and reports the conflict to the user. It does not stop work, and it does not choose the lower layer.

- When the higher layer is silent on something, the lower layer fills the gap. Where there is a plan, the LLM records the gap or assumption in the plan's record (`plans R28`); otherwise it tells the user in conversation.
- When neither layer covers a case, the LLM picks the most reasonable and least destructive default, proceeds, and reports the assumption the same way.
- Assumption, not on the page: two specs in the same layer that contradict each other are reported to the user as a conflict; the LLM does not implement the contradicted behaviour until the user resolves it, and continues with unrelated work.
- Implementation may be ahead of or behind the specifications, and specifications may change together with code or separately. Which branch holds what has no meaning to Specplane.

Scenario: Given `architecture/cli` says results are sorted ascending and `feature/cli` says descending, When an LLM implements sorting, Then it follows `feature/cli` and tells the user the two disagree.

Scenario: Given a requirement says a command must not need network access and a feature spec says it fetches data, When an LLM implements the command, Then it follows the requirement and reports the conflict.

## R1: Requirements formatting

Requirements are written as `R<number>`, with sub-requirements as `R<number>.<number>` and deeper levels separated by dots, for example R1.1.

- Each requirement ID is unique across the project and permanent.
- The ID of a removed requirement is retired and never reused. The requirements document lists its retired IDs.
- The next new requirement takes the highest ID ever used plus one.

Scenario: Given R41 is retired, When a user adds a requirement, Then it cannot be called R41 and checking reports the clash if it is.

## R2: Requirements storage

Requirements are markdown files in a folder meant for requirements, viewable and editable by the user.

- A project may keep all requirements in one file.
- A project may split them across several files. One central file then describes each of the others and references them by file name, and the files can reference each other by file name.

Scenario: Given requirements split into two files and a central file naming both, When a requirement in one file cites a requirement in the other by file name, Then the citation is valid and is treated as a dependency (`R9`).

## R7: Format

Feature and architecture specifications are written in one consistent, checkable and citable format, so that a person, an LLM and Specplane can all read it the same way. Requirement specifications follow `R1` and `R2`, and share the metadata rules below.

A specification file has two parts:

- **Metadata**, at the top: its identifier, title, status (`R11`), authors (`R10`), the specifications and requirements it references (`R9`), and, where the project uses requirements, the requirements it covers.
- **Body**: sections as described in `R5`.

The body is checked for the format: metadata present and valid, the identifier matching the file, every cited thing resolving, and every citation appearing in the metadata's references. Problems are reported with the file and section, and do not stop git use.

Scenario: Given a spec whose identifier does not match its file's name, When it is validated, Then the mismatch is reported naming both.

Scenario: Given a feature spec that cites a section that does not exist, When it is validated, Then the unresolved citation is reported.

### Citing

A citation names a requirement or a part of a specification in a fixed shape:

- `R11` or `R11.2`: a requirement or sub-requirement.
- `plans R28`: the section of the named feature spec that covers that requirement.
- `plans §2`: a section of the named spec that is not tied to a requirement.
- `architecture/cli R16`: the same for an architecture spec. A name without a layer always means a feature spec.
- `claude:R7`, `claude:harness R14`: a cite into a subproject or the root project, written `<project>:<cite>` with any of the shapes above. A cite without a project means the citing spec's own project; `root` always names the root project and cannot be a subproject name; spec IDs are unique within a project (`later-releases R39.3`). This syntax is an assumption, because the page only asks that the project be named.

A citation to a part means that section and its subsections. A citation to a whole spec is allowed but marks the citing spec outdated whenever anything in the cited spec changes (`R11.2`), so citing the narrowest part is preferred.

### Metadata for all layers

Metadata rules in this spec apply to requirement, feature and architecture specifications alike.

## R5: Layout

A feature or architecture spec is easy for a person and an LLM to find a part of.

- It opens with a short purpose paragraph.
- It is divided into sections, and long sections into small subsections, each with a stable heading that can be cited (`R7`).
- A section that covers a requirement is headed with its ID and title, for example `R11: Spec status`. Its subsections cover sub-requirements by their own IDs. This makes every requirement traceable to the one spec section that covers it.
- Sections that cover no requirement, such as terms or examples, are numbered `§1`, `§2` and so on.
- Acceptance scenarios are written as Given, When, Then and sit under the section they check.
- A section may declare how it is verified: tests (deterministic or checked with intelligence) or neither, in which case intelligent judgement applies (`verification R61`).

A requirement that no spec covers can be listed by checking, unless the user keeps it requirement-only. Requirement-only is the owner's choice for a requirement (and its sub-requirements) and is recorded by the project's coverage rules, not by a spec (`verification R64`); on this project R62 and R63 are requirement-only.

## R4: Feature and architecture separation

Feature specs describe behaviour users can observe; architecture specs describe how it is built. Architecture belongs in architecture specs and should ideally not appear in feature specs.

- The user controls exceptions. A feature spec may mark a passage as an exception with a reason, for example when a mechanism is itself the behaviour the user sees. Technical words alone are not a violation.
- Where the harness helps write specs, it may carry optional instructions that verify the separation and warn the user per change or per review. The user can configure or remove these instructions (`harness R14`, `configuration R25`). Specplane does not block a commit or an edit because of them.

Scenario: Given the user configures the harness instruction off, When an LLM writes a feature spec that names a file path, Then no separation warning is shown.

## R9: Spec dependencies

Everything a specification refers to is a dependency of it: another spec or a part of one, a requirement, or a part of a requirement.

- A dependency is written as a citation (`R7`) and listed in the spec's metadata.
- Dependencies decide when a spec becomes outdated (`R11.2`), and what must be approved first (`cli R16`).
- A cited item that does not exist is reported.

## R10: Spec authorship

A spec records a list of authors, both people and LLMs.

- When the harness writes or changes a spec, it adds the LLM as an author. Recording LLM authorship is on by default and the user can turn it off in configuration (`configuration R25`).
- Earlier authors stay when later ones are added; approving a spec does not make the approver an author.
- Each author is recorded as a person or a model, by the identity the harness reports. An unknown identity stays unknown and is never guessed.

### R10.1: Detailed contributions

An author entry may carry a contribution degree, saying what that author did, such as drafting, revising or reviewing.

Scenario: Given an LLM drafts a spec and a user then revises it in the editor, When the user records it, Then both appear as authors, each with their own contribution.

## R11: Spec status

Every spec has a status, bound to the spec's committed content, and records the commit on which it was set. An approval remains valid while the content is unchanged, including after a rebase or a squash merge.

Statuses:

- **Awaiting Review** (the default): a spec nobody has reviewed, a spec whose content has changed, or a spec that references parts of other specs that have changed since its last Approved state.
- **Approved**: approved by a role with the required permission (`roles-and-permissions R57`).

New specs always start as Awaiting Review. There are no other statuses. A spec that is no longer wanted is deleted, and anything that cited it becomes Awaiting Review (`R11.2`).

Scenario: Given an approved spec is rebased onto a newer branch with its content unchanged, When status is shown, Then it is still Approved.

Scenario: Given a spec was never approved, When a spec that cites it is checked, Then the citing spec is Awaiting Review.

### R11.1: Spec status records

When a spec is approved, who approved it is recorded with the status.

### R11.2: Outdated specs to Awaiting Review

A spec that refers to a part of another spec or requirement that has changed or been deleted since the citing spec was last Approved is marked Awaiting Review automatically.

- Only the cited part counts. A change elsewhere in the cited spec does not affect the citing spec.
- Deleting a cited part counts as a change.
- This applies across all layers, including requirements.

Scenario: Given `feature/a` cites `b R7` and `b R9` changes, When status is calculated, Then `feature/a` stays Approved.

Scenario: Given `feature/a` cites `b R7` and `b R7` changes, When status is calculated, Then `feature/a` is Awaiting Review with the reason that a cited part changed.

### R11.3: Awaiting Review post-edit

After a commit changes a spec's content, its status goes to Awaiting Review for the user's review and further editing. A change to metadata alone is not an edit. This also holds for a spec edited within a plan; the plan does not approve the edit.

Scenario: Given an approved spec, When a commit changes only its authors list, Then it stays Approved.

Scenario: Given an approved spec, When a commit rewrites a sentence in its body, Then it becomes Awaiting Review.

### R11.4: Tracking Awaiting Review reasoning

An Awaiting Review spec records why: outdated (`R11.2`), edited (`R11.3`), never approved, or a combination. The reason names the changed cited parts where there are any.

## R40: Specification versioning

The current state of the specifications is the committed state of the checked-out branch.

- Status, outdated checks and references use committed content only. Uncommitted changes are ignored: an uncommitted edit neither makes a spec Awaiting Review nor makes a reference outdated until it is committed.
- Each branch has its own state, and merging follows git. Specplane adds nothing of its own to merge handling.
- Metadata that Specplane calculates can be attached to commits without changing the content of the specs.

Scenario: Given an approved spec edited in the working tree but not committed, When status is shown, Then it is Approved, and the user is told the file has uncommitted changes.

## R67: Specification generation

Where the harness can run an LLM, feature specs can be generated from requirement specs, and architecture specs from feature specs.

- Generation is a request to the LLM through the harness, and it can be carried out as a step of a plan (`plans R30.1`).
- The LLM acts under its role's permissions (`roles-and-permissions R57`) and cannot approve what it generates; everything generated starts as Awaiting Review with the LLM recorded as author.
- A generated spec cites the parts of the higher-layer spec it comes from, so changes there make it outdated (`R11.2`).

Scenario: Given an approved requirement spec, When an LLM generates a feature spec from it, Then the new spec is Awaiting Review, lists the LLM as author and cites the requirements it covers.

## §2 Edge cases

- A file with no valid metadata is reported as invalid; it is not treated as `INFO.md`, and an `INFO.md` with metadata is reported rather than loaded as a spec.
- Two specs that cite each other are valid. They are approved together (`cli R16`).
- A spec that contradicts itself in two sections is reported as a gap in the spec; the LLM follows the more specific passage and reports it (`R65`).
- Git history is the record of a spec's earlier text. Rewriting or squashing history does not by itself change status while content is unchanged (`R11`).
