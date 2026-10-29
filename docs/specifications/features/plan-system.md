---
id: feature/plan-system
title: "Plan system: layout, IDs, PLAN.md, and dependencies"
status: approved
author: mixed
---

# Plan system: layout, IDs, PLAN.md, and dependencies

A **plan** is a self-contained unit of implementation work. It has a branch, a sequence of steps, a set of specs it implements, and a set of dependencies on other plans.

---

## Plan directory layout

All plans live under the `plans/` directory (configurable via `plans.dir`). Each plan occupies its own folder:

```
plans/
  PLANS.md                         # GENERATED — never hand-edit
  <plan-id>/
    PLAN.md                        # plan frontmatter and body
    steps/
      01-<slug>.md
      02-<slug>.md
      ...
    HANDOFF.md                     # appended after each step
  archive/
    <done or abandoned plan folders>
```

### `PLANS.md`

`PLANS.md` is generated from plan frontmatter and git state. It is never hand-edited. See `feature/plan-index`.

### `HANDOFF.md`

`HANDOFF.md` is created by the first step that ends (done, skipped, or blocked) and appended to by every later one. It records what each step accomplished and what the next step needs to know. It stays in the plan folder and moves with it when the plan is archived. See `feature/plan-steps`.

---

## Plan IDs

A plan ID has the format:

```
YYYY-MM-DD-<2-to-4-word-kebab-slug>
```

Examples:
- `2026-10-28-plan-index-generator`
- `2026-11-03-auth-middleware-rewrite`

Rules:
- The plan ID equals the folder name. The folder is `plans/<id>/`.
- The ID is immutable after creation. Changing the title does not rename the folder.
- The branch name is derived from the ID: `plan/<id>`.
- If a folder with the given ID already exists, creation fails with: "Plan `<id>` already exists. Choose a different slug."
- The date portion is the creation date in ISO format (UTC). It does not need to be today's date, but using today's is the convention.

### Collision avoidance

The date prefix makes ID collisions very unlikely when multiple plans are created on the same day. If two plans on parallel branches happen to choose the same slug on the same date, the collision appears as a standard git merge conflict, not as a data corruption.

---

## PLAN.md

`PLAN.md` holds the plan's frontmatter and body.

### Frontmatter schema

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | string | yes | — | The plan ID, matching the folder name. Immutable. |
| `title` | string | yes | — | Human-readable description of the plan's goal. |
| `status` | enum | yes | — | Stored status; new plans start as `draft`. See `feature/plan-status`. |
| `specs` | list of IDs | yes | — | Spec IDs (feature and/or architecture) this plan implements. Non-empty. |
| `depends_on` | list of IDs | no | `[]` | Plan IDs this plan depends on. Must be done before this plan can start (default mode). |

### Example frontmatter

```yaml
---
id: 2026-10-28-plan-index-generator
title: Generate PLANS.md from plan frontmatter
status: ready
specs: [feature/plan-index, architecture/reference-cli]
depends_on: [2026-10-20-frontmatter-schema]
---
```

### Body sections

The PLAN.md body contains the following sections (order is conventional, not enforced):

1. **Goal**: one paragraph describing the outcome the plan achieves.
2. **Scope**: what is in scope for this plan.
3. **Non-goals**: what is explicitly out of scope (to prevent scope creep).
4. **Specs implemented**: the spec IDs in `specs`, with a brief note on which aspect each covers.
5. **Acceptance criteria**: observable conditions that confirm the plan is complete. These are checked in the finish flow.
6. **Risks**: known risks or uncertainties.
7. **Steps**: an ordered list of the steps, with a one-line summary of each.

---

## Dependencies

The `depends_on` field lists plan IDs that must be complete before this plan may start.

### Dependency constraints

- A plan cannot start while any plan in its `depends_on` list has a status other than `done`.
- This applies by default (`dependency_mode: wait_for_merge`). See `feature/plan-execution` for the `stack` alternative.
- A plan must not depend on an `abandoned` plan (see `feature/plan-status`).
- Dependencies must not form a cycle. A cycle is a validation error detected before plan creation.
- A dangling dependency ID (a plan that does not exist) is a validation error.

### Dependency graph

The dependency graph is represented in `PLANS.md` as a Mermaid diagram. See `feature/plan-index`.

---

## Acceptance scenarios

### Scenario 1: Creating a plan with a unique ID

Given no folder `plans/2026-10-28-search-indexer` exists,
When a user creates a plan with slug `search-indexer` on 2026-10-28,
Then the folder `plans/2026-10-28-search-indexer/` is created, `PLAN.md` is populated with the given fields, and the branch `plan/2026-10-28-search-indexer` is ready to be created.

### Scenario 2: Duplicate plan ID rejected

Given `plans/2026-10-28-search-indexer` already exists,
When a user or agent attempts to create a new plan with the same slug on the same date,
Then creation fails with: "Plan `2026-10-28-search-indexer` already exists. Choose a different slug."

### Scenario 3: Plan with dependency on existing done plan

Given `2026-10-20-frontmatter-schema` has `status: done`,
And a new plan declares `depends_on: [2026-10-20-frontmatter-schema]`,
Then the new plan may start immediately (the dependency is already satisfied).

### Scenario 4: Plan with unmet dependency cannot start

Given `2026-10-20-frontmatter-schema` has `status: ready` (not done),
And `2026-10-28-plan-index-generator` declares `depends_on: [2026-10-20-frontmatter-schema]`,
When a user attempts to start `2026-10-28-plan-index-generator`,
Then the start is rejected: "Plan `2026-10-28-plan-index-generator` is blocked: dependency `2026-10-20-frontmatter-schema` is not done."

### Scenario 5: Dependency cycle rejected

Given plan A declares `depends_on: [B]` and plan B declares `depends_on: [A]`,
When either plan is created or validated,
Then a validation error is reported: "Dependency cycle detected: A → B → A."

### Scenario 6: Dangling dependency ID

Given `depends_on: [2026-11-01-nonexistent]` and no plan with that ID exists,
When validation runs,
Then an error is reported: "Plan `2026-10-28-search-indexer` references unknown dependency `2026-11-01-nonexistent`."

### Scenario 7: PLAN.md body is free-form after frontmatter

Given a PLAN.md with valid frontmatter,
When the body sections are in a different order or missing optional sections,
Then validation passes. Body section structure is conventional, not enforced.

---

## Edge cases

- A plan's `specs` list may include specs from overlay roots using qualified IDs (e.g. `claude:feature/claude-integration`).
- A plan with an empty `depends_on` list (or the field omitted) has no dependencies and may start immediately once spec requirements are met.
- A plan may reference a deprecated spec; validation issues a warning but does not block plan creation.
- The `archive/` subfolder inside `plans/` is not a plan folder. Its contents are completed plan folders moved there by the archive operation.
