---
id: feature/spec-system
title: "Spec system: roots, types, frontmatter, lifecycle, and IDs"
status: approved
author: mixed
---

<!-- Revision 2026-11-01: extension/core separation and contribution provenance agreed in conversation; existing lifecycle status is unchanged. Implementation and integration review remain pending. -->

# Spec system: roots, types, frontmatter, lifecycle, and IDs

## Glossary

The following terms are used consistently across all Specplane specs.

| Term | Definition |
|------|------------|
| **Spec** | A single markdown file that describes what a project does (feature spec) or how it is built (architecture spec). |
| **Spec root** | A directory that holds a `features/` and an `architecture/` subfolder of spec files. |
| **Base root** | The default spec root, at the path declared in config (default: `docs/specifications`). |
| **Overlay root** | An additional spec root that extends the base root, used for context-specific specs. See `feature/spec-overlays`. |
| **Slug** | A short, lowercase, hyphen-separated identifier derived from a file's path within its root. |
| **Spec ID** | The canonical identifier of a spec, in the form `<type>/<slug>`. Immutable after creation. |
| **Feature spec** | A spec describing observable behaviour, rules, and user-visible outcomes. |
| **Architecture spec** | A spec describing the internal structure, components, and implementation approach. |
| **Status** | The lifecycle stage of a spec: `draft`, `review`, `approved`, or `deprecated`. |
| **Author** | Compatibility summary of actual authorship: `user`, `llm`, or `mixed`; detailed provenance records the contributors. |
| **Plan** | A structured unit of implementation work. See `feature/plan-system`. |
| **Step** | One agent session within a plan. See `feature/plan-steps`. |
| **Handoff** | A record of what a step accomplished, written at the end of the step for the next session. |
| **Config** | The single `.specplane/config.yaml` file that controls all Specplane policy. |
| **Frontmatter** | YAML metadata at the top of a markdown file, delimited by `---` lines. |
| **Architecture-leak guard** | A policy that prevents implementation details from appearing in feature specs. See `feature/spec-policies`. |
| **Overlay** | A spec that extends a base spec from another root, adding to but not contradicting it. |
| **ADR** | Architecture Decision Record — a short document recording a design decision. See `feature/decisions`. |

---

## Spec roots

A **spec root** is a directory that organises specs into two subfolders:

```
<spec-root>/
  features/
    INFO.md      (optional)
    <slug>.md
    ...
  architecture/
    INFO.md      (optional)
    <slug>.md
    ...
```

### Rules

- Every spec root must have both a `features/` and an `architecture/` subfolder. Either may be empty.
- `INFO.md` inside either subfolder is reserved for human-readable documentation (an index, conventions, notes). It is never a spec file and never has spec frontmatter: an `INFO.md` that starts with a frontmatter block is a validation error (it is almost always a misnamed spec). It does not hold policy.
- The only `INFO.md` files are at `features/INFO.md` and `architecture/INFO.md` within each root; no other directory uses this convention.
- The base spec root is declared in config. Default: `docs/specifications`.
- Additional spec roots (overlays) are declared in config. See `feature/spec-overlays`.

---

## Spec types

### Feature specs

Feature specs describe **what** the project does:

- Capabilities and behaviours visible to users, operators, or calling systems.
- Business rules and invariants.
- Edge cases, error conditions, and rejection criteria.
- Acceptance scenarios.

Feature specs describe the contract, including technical mechanisms when those mechanisms are themselves observable requirements or the workflow being evaluated. Incidental implementation choices belong in architecture. The architecture-leak guard is an advisory aid; technical vocabulary alone does not establish a violation. Existing `allow_architecture` and `architecture_reason` fields can document why a mechanism belongs in the contract (see `feature/spec-policies`).

### Architecture specs

Architecture specs describe **how** the project is built:

- Components, modules, and their responsibilities.
- Data models, schemas, and storage strategies.
- Interfaces, protocols, and integration points.
- Algorithms and processing logic.
- Technology and library choices.
- Error handling strategies.
- File and module structure.

Architecture specs must be detailed enough that an implementation can be generated from them, supplemented only by feature specs for behavioural gaps.

Architecture specs must reference at least one feature spec in their `implements` field.

---

## Frontmatter schema

### Contribution provenance

A spec can have multiple human and model contributors. Preserve the original creator and subsequent revision and review contributions; later work must not replace earlier attribution. Each distinct contributing model is represented, even when several models worked in one session or a later session edited the same spec. A model merely selected but doing no work is not a contributor.

Contributor identity, session identity, and model identity are separate. One contributor can work across sessions, and one session can use several models. Record the runtime-reported model identifier and its provider when available; an optional display name is cosmetic and can change without changing historical identity. Unknown identities remain unknown rather than inferred from product names or invented.

Keep `author` as a coarse compatibility summary and expose a concise contributor summary plus revision-linked contribution history. Contribution roles distinguish creation, revision, and review. Approval provenance remains separate and identifies the human decision and exact revision it covers. Approval alone does not add an author, and an agent making a mechanical write does not establish that the human contributed the content.

Provenance supports inspection and derived analytics but never overrides authorship policy or proves authenticated identity. Record the source of attribution, distinguish explicit declarations from runtime observations, and do not silently export transcripts or session data. Older specs without detailed provenance remain valid; do not fabricate their history.

Acceptance: work by model A followed by model B in the same session retains both models; a later revision by model C retains all three; selecting model D without a contribution adds no contributor; a human approval changes approval history without attributing the spec's writing to that approver.

Every spec file begins with YAML frontmatter. The schema is defined below.

### Fields common to all specs

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | string | yes | — | `<type>/<slug>`. Immutable after creation. |
| `title` | string | yes | — | Human-readable name. May change; the ID does not. |
| `status` | enum | yes | — | New specs start as `draft`. `draft` \| `review` \| `approved` \| `deprecated` |
| `author` | enum | yes | — | `user` \| `llm` \| `mixed` |
| `contributors` | list | no | — | Human/model contributor summaries with creation, revision, or review roles; detailed history is revision-linked. |
| `supersedes` | list of IDs | no | `[]` | IDs of specs this one replaces. Superseded specs are set to `deprecated`. |
| `extends` | string or list of IDs | no | — | For overlay specs only. A single ID or a list. See `feature/spec-overlays`. |
| `implementation` | completion record | no | absent | Optional implementation declaration and assessed content fingerprint; independent of review status. |
| `based_on` | map of ID → git blob hash | no | — | Pins each referenced spec (keys from `extends` or `implements`) to the blob at last review. Stale pins warn and block approval. See `feature/spec-overlays#base-pins`. |

### Additional fields for feature specs only

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `allow_architecture` | boolean | no | `false` | Overrides the architecture-leak guard for this spec. |
| `architecture_reason` | string | conditional | `""` | Required (non-empty) when `allow_architecture: true`. Explains why implementation detail is part of the feature description. |

### Additional fields for architecture specs only

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `implements` | list of IDs | yes | — | Feature spec IDs this architecture spec implements. Must be non-empty. |

### Example: feature spec frontmatter

```yaml
---
id: feature/plan-system
title: Plan system
status: review
author: mixed
---
```

### Example: feature spec with architecture override

```yaml
---
id: feature/llm-workflow
title: LLM workflow feature
status: review
author: user
allow_architecture: true
architecture_reason: "This feature IS an LLM workflow; the choice of tool-calling vs. prompt-chaining is part of its user-visible behaviour contract."
---
```

### Example: architecture spec frontmatter

```yaml
---
id: architecture/plan-system
title: Plan system implementation
status: draft
author: llm
implements: [feature/plan-system, feature/plan-status]
---
```

---

## Spec IDs

A spec ID has the format `<type>/<slug>`, where:

- `<type>` is `feature` or `architecture`.
- `<slug>` is derived from the file's path within its root's `features/` or `architecture/` folder, with the `.md` extension removed and path separators replaced with `/`.

Examples:
- `features/plan-system.md` → ID `feature/plan-system`
- `features/overlays/extension.md` → ID `feature/overlays/extension`

### Immutability

An ID is immutable after creation. It must match the file's path at all times; moving the file without updating the ID is a validation error.

### Renaming

If a spec needs a new name, the correct procedure is:
1. Create a new spec with the new slug and title.
2. Set `supersedes: [<old-id>]` in the new spec's frontmatter.
3. Set the old spec's `status: deprecated`.

Rationale: IDs are used as references in other specs and plans. Silent renaming breaks those references. Supersession preserves traceability.

### Collision avoidance

IDs are path-derived, not sequential numbers. This prevents two specs created on parallel branches from receiving the same ID. If two specs with the same ID are created on separate branches, the conflict appears as a standard git merge conflict on the file, not as an invisible data collision.

---

## Spec lifecycle

```
draft ──► review ──► approved ──► deprecated
  ▲          │
  └──────────┘  (returned for revision)
```

| Status | Meaning |
|--------|---------|
| `draft` | Work in progress. Not yet ready for review. May contain gaps or placeholder sections. |
| `review` | Complete enough for review. Awaiting approval. |
| `approved` | Accepted. Plans may reference this spec and implementations may be generated from it. |
| `deprecated` | Superseded or withdrawn. Kept for traceability. Must not be used in new plans. |

### Transition rules

- Any status may move to `draft` (revision after review feedback).
- `draft` → `review`: the spec author or a collaborator marks it ready.
- `review` → `approved`: a human approves it. An LLM agent never sets `approved`.
- `approved` → `deprecated`: only when a superseding spec is also approved, or when the feature is explicitly removed.
- An architecture spec cannot be `approved` unless all specs in its `implements` list are `approved` (configurable; see `feature/spec-policies`).
- A spec with a stale `based_on` pin cannot be `approved` until the base change is reviewed and the pin refreshed (see `feature/spec-overlays#base-pins`).
- Editing an approved spec as part of a plan does not change its status; the plan's review approves the edit. See `feature/spec-precedence` Rule 5.

---

## Acceptance scenarios

### Scenario 1: Valid spec creation

Given a spec root exists with the path `docs/specifications`,
When a user creates `docs/specifications/features/search.md` with valid frontmatter (`id: feature/search`, `status: draft`, `author: user`, `title: Search`),
Then the spec is valid and the ID `feature/search` is registered.

### Scenario 2: ID–path mismatch

Given a spec file at `docs/specifications/features/search.md`,
When its frontmatter declares `id: feature/wrong-name`,
Then validation reports an error: "ID `feature/wrong-name` does not match path-derived ID `feature/search`."

### Scenario 3: Architecture spec missing `implements`

Given a file at `docs/specifications/architecture/search.md`,
When its frontmatter omits the `implements` field,
Then validation reports an error: "Architecture spec `architecture/search` must have a non-empty `implements` list."

### Scenario 4: Feature spec with `allow_architecture: true` but no reason

Given a feature spec with `allow_architecture: true`,
When `architecture_reason` is empty or absent,
Then validation reports an error: "`architecture_reason` is required and must be non-empty when `allow_architecture: true`."

### Scenario 5: Renaming a spec

Given `feature/plan` is referenced by two plans,
When a user renames it by creating `feature/plan-system` with `supersedes: [feature/plan]` and setting `feature/plan` to `deprecated`,
Then validation passes, existing plan references to `feature/plan` produce a deprecation warning (not an error), and new plans should use `feature/plan-system`.

### Scenario 6: Parallel branch ID collision attempt

Given branches `feat/A` and `feat/B` both create `features/export.md` with different content,
When the branches are merged,
Then git reports a merge conflict on `docs/specifications/features/export.md`, making the collision visible before it can be silently resolved.

### Scenario 7: `INFO.md` with frontmatter

Given `docs/specifications/features/INFO.md` starts with a frontmatter block,
When validation runs,
Then it reports an error: "`docs/specifications/features/INFO.md` has frontmatter. `INFO.md` is not a spec; rename the file if it is meant to be one."

---

## Edge cases

- A spec file with no frontmatter is a validation error; the file is not treated as an `INFO.md`. Conversely, an `INFO.md` with frontmatter is an error, not a spec.
- A spec with `status: deprecated` may still be referenced for historical traceability; the reference produces a warning, not an error.
- Nested slugs (e.g. `features/overlays/extension.md` → `feature/overlays/extension`) are supported. Folder nesting inside `features/` or `architecture/` is allowed.
- The `INFO.md` name is case-sensitive. `info.md` is treated as a regular spec file (and will fail validation because it lacks the required frontmatter).

## Optional coordination and implementation completion

Specplane supports ordinary Git workflows without requiring plans, prescribed branch names, or a fixed integration branch. It records specification review, implementation evidence, and optional plan progress separately. By default, discrepancies are reported for user judgment; enforcement is an explicit policy choice.

A reviewed definition may precede implementation, or specs and implementation may change together. Multiple branches may carry different definitions or implementations. Branch names confer no lifecycle role. Approval is agreement on intended behaviour; completion is a declaration about implementation; evidence records the checks supporting an assessment. None implies the others.

Optional `implementation` metadata records `status: incomplete`, `partial`, or `complete`, independently of the spec's review `status`. Absent metadata means unrecorded, not incomplete. Manual edits are valid; plans, special commit trailers and CLI use are not required. Changing completion does not approve the spec or merge anything. An agent records completion when instructed or as an explicitly requested workflow outcome, not merely because it drafted a spec or completed a plan.

A completion declaration may include an assessed content fingerprint. The mark-complete operation captures the current definition and its declared requirement dependencies. Fingerprints use a documented, versioned rule that excludes review, attribution and completion bookkeeping. A metadata-only completion update does not invalidate itself. Changes to substantive content, even editorial changes, can require reassessment; semantic equivalence is not inferred.

Reports distinguish stored completion from derived assessment: `current`, `reassessment_needed`, `unrecorded`, or `unverifiable`. Matching fingerprints mean only that completion was declared against this definition. A mismatch preserves the declaration and reports reassessment needed. A missing fingerprint reports unrecorded assessment; an unsupported fingerprint version or unavailable dependency reports unverifiable assessment. These findings warn by default and do not silently rewrite metadata or prevent ordinary Git operations. Invalid metadata remains a format error.

Marking complete again explicitly acknowledges the current definition and refreshes the assessment. If further implementation is needed, the user can instead set partial or incomplete. Verification evidence and implementation-revision references are optional and remain separate. Content fingerprints do not detect code regressions, authenticate a reviewer, or prove that tests passed.

Declared requirement dependencies are the resolved `extends` and `implements` references, recursively, with cycles handled without infinite traversal. Completion captures their content fingerprints; changed dependency content or membership requires reassessment. Missing declared dependencies prevent creation of a current assessment without overwriting the prior declaration. Arbitrary prose links are not inferred as dependencies. For an anchored reference, assessment conservatively covers the whole referenced spec. A child spec's completion or approval metadata alone does not invalidate a parent's implementation assessment.

Assessments describe the definition in the inspected checkout or explicitly selected revision, never a global result across every candidate. Copying a matching spec fingerprint to another implementation is not evidence about that implementation.

### Acceptance: completion and reassessment

- A user marks a spec complete without a plan; review status and Git history are unchanged until the user commits.
- A manual complete declaration without a fingerprint remains valid and reports unrecorded assessment.
- Editing a completed spec's requirements preserves stored complete and reports reassessment needed; explicitly marking complete again records the new definition.
- Changing only completion, review or contributor bookkeeping does not invalidate the content fingerprint.
- Changing a declared requirement dependency requires reassessment; an unavailable dependency reports unverifiable, never current.
- Changing code without changing the spec does not produce a claim that the implementation remains verified.
