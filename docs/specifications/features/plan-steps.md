---
id: feature/plan-steps
title: "Plan steps: context contract and HANDOFF.md"
status: approved
author: mixed
---

# Plan steps: context contract and HANDOFF.md

A **step** is a single agent session within a plan. Steps run sequentially, one at a time, on the plan's branch. This spec defines the structure of step files and the HANDOFF.md contract that carries knowledge between sessions.

---

## Why steps exist

A plan may require many changes across many files. If a single agent session tried to do all of them, it would accumulate a large context window and lose coherence. Steps divide the plan into manageable sessions, each with a clear goal and a well-defined context budget. The HANDOFF.md protocol means each session can be oriented quickly from the handoff rather than re-reading all prior diffs.

---

## Step files

Step files live in `plans/<id>/steps/` and are named with a two-digit sequence number and a short slug:

```
steps/
  01-frontmatter-parser.md
  02-graph-builder.md
  03-markdown-renderer.md
```

The numbering is the execution order. Steps are always executed in order; a later step does not start until every earlier step is `done` or `skipped`.

### Step frontmatter

Every step file begins with YAML frontmatter:

```yaml
---
plan: 2026-10-28-plan-index-generator   # parent plan ID; must match folder name
step: 1                                  # integer; must match filename prefix
title: Frontmatter parser
status: pending                          # pending | done | skipped | blocked
context:                                 # machine-readable list of items to load
  - spec: architecture/reference-cli    # spec ID, optional #heading anchor
  - decision: decision/0002              # ADR ID
  - file: src/graph/                     # file path or directory
# use_subagent: true                     # harness opt-in; defined by the harness overlay spec
---
```

#### Step status

Step status is **stored** in frontmatter (unlike plan `in_progress`/`review` which are derived). Steps only ever change on their own plan branch, executing sequentially, so there is no concurrent-write conflict risk.

| Status | Meaning |
|--------|---------|
| `pending` | Not yet executed. The default for new steps. |
| `done` | Completed. Set in the commit that also appends the step's section to HANDOFF.md. |
| `skipped` | Intentionally not executed. A reason must appear in HANDOFF.md. |
| `blocked` | Ended without meeting its acceptance criteria because of a blocking issue (for example, an unresolved spec contradiction in unattended mode; see `feature/spec-precedence`). HANDOFF.md records the `BLOCKED:` issue. |

**"Next step"** means the lowest-numbered step whose status is not `done` or `skipped`. If that step is `blocked`, execution stops and the blocking issue is reported; no later step runs. Once a human resolves the issue, they set the step back to `pending` and execution resumes with it.

#### `context` entries

The `context` list specifies what the agent must load before starting the step. Each entry has a type prefix:

| Prefix | Example | Resolves to |
|--------|---------|-------------|
| `spec:` | `spec: architecture/reference-cli#cleanup-abandon-archive` | A spec file; optional `#section` anchor narrows to a heading |
| `decision:` | `decision: decision/0002` | An ADR by its ID |
| `file:` | `file: CONTRIBUTING.md` | A file or directory path relative to the repository root |

A `#heading` anchor names a heading in the spec; it matches the first heading whose text equals the anchor or begins with it (ignoring case, code formatting, and leading section numbers), so `#Config loading` matches a heading "Config loading (config module)". An unmatched anchor is a warning, and the agent loads the whole spec.

Validation checks: all `spec:` IDs resolve in the config's spec roots; all `decision:` IDs resolve to ADRs in the configured decisions directory; `file:` paths exist in the repository (warning if absent at validation time, since the file may not yet exist).

#### Validation rules for step files

- `step` value must match the numeric prefix of the filename (e.g. `step: 2` in `02-graph-builder.md`).
- `plan` value must match the plan ID of the containing folder.
- Step numbers across all files in `steps/` must be contiguous starting at 1 (no gaps, no duplicates).
- All `context` references must resolve (see above).
- A `skipped` or `blocked` step must have a corresponding entry in HANDOFF.md explaining why.

### Step file body

Each step file contains the following sections:

#### 1. Goal

One paragraph describing what this step must accomplish. Should be small enough to fit in one agent session.

#### 2. Acceptance criteria

A list of conditions that confirm the step is complete. These are checked before the step is committed.

Example:
```
- [ ] The parser reads YAML frontmatter from a markdown file without error
- [ ] Malformed frontmatter produces a descriptive error, not a crash
- [ ] All fields listed in architecture/file-formats are parsed correctly
```

The context to load is declared only in the `context` frontmatter field (see above), not repeated in the body. Prior HANDOFF.md sections are always loaded and are not listed.

#### 3. Tasks

An ordered list of tasks for the step. Tasks are imperative actions, not goals.

Example:
```
1. Implement `parseSpecFrontmatter(filePath)` to read and validate YAML frontmatter
2. Write unit tests for valid, invalid, and missing frontmatter
3. Add error type `FrontmatterError` with `file`, `field`, and `message` properties
```

#### 4. Guidance (optional)

Notes for the agent: common pitfalls, design constraints that aren't in the specs, or reminders about project conventions.

---

## Harness non-interference

The framework defines **what** a step session must do:
- Load the context listed in the step frontmatter and all prior HANDOFF.md sections.
- Respect authorship and precedence policies.
- Append the step's HANDOFF.md entry.
- Commit with the required message format.
- Set the step's final status (`done`, `skipped`, or `blocked`) in its frontmatter as part of that commit.

The framework does **not** dictate how the harness runs the session: whether it uses subagents, which model it uses, what tools it calls, or how it manages parallelism within a session. These are harness concerns. A harness may offer per-step features (e.g. running the session as a subagent) as opt-in extensions without affecting the base behaviour defined here.

See `feature/agent-integration` for the harness non-interference principle.

---

## Context contract

The context contract is the set of rules about what an agent may and must read during a step.

### What the agent must load

- Every item in the step's `context` field.
- All prior sections of `HANDOFF.md`.
- The step file itself.

### What the agent should avoid

- Files not listed in the step's `context`, unless the listed context is insufficient for a specific task.
- Spec sections not relevant to the step's tasks.
- Large files loaded wholesale when only a few sections are needed.

### When to expand context

If the agent cannot complete a task because the listed context is insufficient, it may read additional files. In this case, it must record in HANDOFF.md that the context list was expanded and what was added, so future step files can be updated.

### Rationale

Token economy. Each additional file read costs tokens for the current session and narrows how much of the step's work can be done. By making context explicit, each step loads only what it needs, and the HANDOFF.md accumulates a running synthesis that replaces re-reading the diff.

---

## Step grouping guidance

When authoring a plan's steps:

- **Group related tasks together**: tasks that share context (the same source file, the same spec section) belong in the same step. This avoids loading the same context twice.
- **Separate unrelated concerns**: tasks that touch different subsystems, require different spec sections, or would benefit from independent review belong in separate steps.
- **Keep steps small**: a step that would require reviewing more than ~5 files or implementing more than one non-trivial component is likely too large. Split it.
- **If steps need independent review, split the plan**: if two steps are producing changes that need to be reviewed independently, those are separate plans with a dependency, not steps.

---

## HANDOFF.md

`HANDOFF.md` is created by the first step that ends and appended to by every later one (done, skipped, or blocked). It is the primary context carrier between sessions. It begins with a `# HANDOFF — <plan-id>` heading.

### Format

HANDOFF.md has a section per ended step:

```markdown
## Step 01: Frontmatter parser

**Date**: 2026-10-28
**Outcome**: done

### What changed

- `src/parser/frontmatter.ts`: implemented `parseSpecFrontmatter`; returns a typed object or throws `FrontmatterError`
- `src/parser/errors.ts`: added `FrontmatterError` with `file`, `field`, and `message` fields
- `tests/parser/frontmatter.test.ts`: 14 tests covering valid, missing, and malformed cases

### Deviations from the plan

- The plan listed `parseArchitectureFrontmatter` as a separate function, but the schema difference is handled by a discriminated union in `parseSpecFrontmatter`. This is simpler and fully covered by tests.

### Gaps found in specs

- G1 (gap): `architecture/file-formats` does not specify the ID-mismatch error message; used the `feature/spec-system` Scenario 2 text. See `spec-gaps.md`.

### Open issues

- None.

### What the next step must know

- `FrontmatterError` is the canonical error type for all frontmatter failures. Use it in the graph builder when a spec file has unparseable frontmatter.
- The `id` field validation (ID must match file path) is implemented in `validateId()` in `src/parser/frontmatter.ts`, not in the frontmatter parser itself. The graph builder can call `validateId()` separately.
```

### Sections in each step's entry

| Section | Required | Content |
|---------|----------|---------|
| `## Step NN: <title>` | yes | Step heading, followed by `**Date**` and `**Outcome**` (`done`, `skipped`, or `blocked`, matching the step's status) |
| `### What changed` | yes | Files changed and why, in brief bullets |
| `### Deviations from the plan` | yes | How the implementation differed from the step's tasks, if at all. "None" if no deviations. |
| `### Gaps found in specs` | yes | One line per `spec-gaps.md` entry this step added: its ID, kind, and a one-line summary. The full record is in `spec-gaps.md` (see `feature/spec-precedence`). "None" if no entries. |
| `### Open issues` | yes | Unresolved issues, blockers (prefixed `BLOCKED:`), or follow-ups needed before or after the next step. "None" if clean. |
| `### What the next step must know` | yes | Key facts the next session must have. Must be self-contained: the next session reads only HANDOFF.md and the step file, not the diff. |

All sections are required. An empty section is written as "None." This discipline ensures HANDOFF.md is always complete, even when there is nothing to report.

When a `blocked` step is run again and ends, its new entry is appended as another section with the same `## Step NN: <title>` heading; earlier entries are never edited. A step can therefore have several entries, for example one `blocked` followed by one `done`. The latest entry for a step is authoritative: its `**Outcome**` must equal the step's current status, and a reader looking for the state of that step uses the last section with that heading. The earlier `blocked` entry stays as the record of why the step was stopped.

---

## Commit convention

Each step ends with **one commit** (or a small, cohesive group of commits). The message has a conventional, human-readable subject and machine-readable fields naming the workflow, plan ID, step number, and the agent session that made it. The exact format is defined in `architecture/file-formats` §8 and is shared by every commit Specplane or an agent makes in a Specplane workflow.

Example:
```
feat(plan-index-generator): frontmatter parser

- Implement parseSpecFrontmatter
- Add FrontmatterError type
- 14 unit tests

Specplane-Workflow: step
Specplane-Plan: 2026-10-28-plan-index-generator
Specplane-Step: 01
Specplane-Agent: claude-code/claude-opus-5-5
Specplane-Session: 6531c4f4
```

---

## Acceptance scenarios

### Scenario 1: Agent loads only listed context

Given a step's `context` lists `file: CONTRIBUTING.md`,
When the agent begins the step,
Then the agent reads `CONTRIBUTING.md` and HANDOFF.md, and does not read unrelated files without need.

### Scenario 2: Agent expands context and records it

Given a step file lists only `CONTRIBUTING.md`,
When the agent discovers it also needs `STYLE.md`,
Then the agent reads `STYLE.md` and records in HANDOFF.md: "Context expanded: read `STYLE.md` (not listed in step 02); step 03 context list should include it."

### Scenario 3: Step not complete — criteria not met

Given a step's acceptance criteria include "All 14 tests pass",
When the agent runs the tests and 3 fail,
Then the agent does not mark the step `done`. It continues working until the criteria are met; if it cannot meet them (for example, because of an unresolved contradiction), it ends the step as `blocked`, recording the `BLOCKED:` issue in HANDOFF.md in the step's commit.

### Scenario 4: HANDOFF.md written after step

Given step 01 completes successfully,
When the agent finishes the step,
Then a section `## Step 01: <slug>` is appended to HANDOFF.md with all required sub-sections filled.

### Scenario 5: Next session oriented from HANDOFF.md

Given steps 01 and 02 are complete,
When step 03 begins in a new agent session,
Then the agent reads HANDOFF.md and the step 03 file and is able to proceed without re-reading the step 01 or 02 files or the diff.

### Scenario 6: Plan that should be split

Given a single plan's step 01 implements the parser and step 02 implements a separate unrelated subsystem,
And both steps require independent code review,
When the plan is authored,
Then this is a signal to split into two plans with a dependency: plan A (parser) and plan B (subsystem, depends_on: A).

---

## Edge cases

- HANDOFF.md is on the plan branch. It is committed as part of the plan and merged with it; when the plan is archived, its HANDOFF.md moves with it, so the default branch keeps each finished plan's handoff log under the archive folder.
- A step may produce zero code changes (e.g. an investigation step that only produces a HANDOFF.md entry with findings). This is valid.
- If a step is aborted partway through, the HANDOFF.md should record the partial state and what the re-run must start from.
- A step file's body should not be edited once that step has started (only its `status` changes). If a step's tasks turn out to be wrong, the deviation is recorded in HANDOFF.md and the plan body may be updated to reflect the new direction. Steps that have not started yet may still be edited, for example to add context that an earlier step found was missing.
- A step that was `blocked` and is re-run gets a new HANDOFF.md section; the earlier `blocked` section is kept unchanged and the latest section wins.
