---
id: feature/plan-index
title: "PLANS.md: plan index generation"
status: approved
author: mixed
---

# PLANS.md: plan index generation

`PLANS.md` is a generated file at the root of the `plans/` directory that provides an at-a-glance view of all plans, their statuses, and their dependencies.

---

## Purpose

`PLANS.md` makes the state of all plans visible without running the CLI or querying git. It is especially useful in code review and in brief-reading sessions where an agent or human wants to understand what work is in progress or planned.

It is derived from the explicitly selected plan/config snapshot, never hand-edited. The default source is HEAD. Staged and working sources support preparing an index before committing. Any conflict in it is resolved from the intended source records by regeneration.

### Index status, not live status

`PLANS.md` is intended to be committed with the plan/config inputs it describes; it contains no live Git/forge activity. Explicit staged/working generation can prepare that output before committing. Its Status column shows the **index status**: the plan's stored status, except that a `ready` plan with an unmet dependency (under `dependency_mode: wait_for_merge`) is shown as `blocked`. Git- and forge-derived statuses (`in_progress` and `review` under `status_source: git`) are not written to it, because creating a branch or opening a pull request does not change any committed file, so a committed copy of those statuses would always be stale. With `status_source: frontmatter`, `in_progress` and `review` are stored and therefore appear.

The live effective status (see `feature/plan-status`) is available from `specplane plan list` and `specplane plan index --print --live`.

This makes the file deterministic: the same commit always produces the same `PLANS.md`, so it can be checked for freshness and regenerated in CI without spurious commits.

---

The committed index describes plans in its own branch context. It is not a global inventory of every candidate. Live listings additionally discover started plans from local and fetched remote plan branches, label each target, and refuse ambiguous identities rather than combining independent candidates.

## Contents

### 1. Status table

A markdown table listing every plan (including archived ones, in a separate section):

| Column | Source |
|--------|--------|
| ID | `id` from `PLAN.md` frontmatter |
| Title | `title` from `PLAN.md` frontmatter |
| Status | Index status (see above) |
| Target | Plan-specific target, otherwise the team setting or repository default; live output uses the recorded execution target |
| Dependencies | `depends_on` IDs, rendered as links to the plan folders |
| Specs | `specs` IDs from frontmatter |

Non-archived plans (including shelved plans) appear first; non-archived does not imply actively executing. Archived plans appear in a separate section, without the Dependencies column. Rows are sorted by plan ID.

### 2. Dependency graph

A [Mermaid](https://mermaid.js.org/) directed graph showing dependencies between plans.

- Nodes are plan IDs (abbreviated to the slug portion for readability).
- Directed edges point from dependency to dependent: `A --> B` means "B depends on A".
- Node colour encodes the index status:
  - `done`: grey
  - `blocked`: red
  - `in_progress`: blue; `review`: light blue (frontmatter mode, or `--live` output)
  - `shelved`: amber, labelled `shelved`; retained branches do not make these plans active
  - `ready`: green
  - `draft`: white / default
  - `abandoned`: grey with strikethrough text (if supported by the renderer)

The graph is regenerated with every `PLANS.md` update.

---

## Generation

### What it reads

`specplane plan index` reads config and all `PLAN.md` files under its configured plans directory (including archive) from one source. `--source head` is the default and reads the checked-out commit, including detached HEAD. `--source staged` reads the proposed next commit; tracked but unstaged changes are excluded. `--source working` reads current on-disk inputs, including new non-ignored plans and tracked files even when ignore patterns match, but excluding ignored untracked files. Report excluded pending inputs and never switch sources implicitly. With `--live` (print-only), it additionally reads the git branch list and open pull requests to show effective statuses.

### Output location

`<plans.dir>/PLANS.md` (by default `plans/PLANS.md`, not the repository root).

### Conflict resolution

`PLANS.md` must be regenerated to resolve any merge conflict. During merge, rebase or cherry-pick recovery, resolve and stage plan/config inputs first, run `specplane plan index --source staged`, then stage PLANS.md and continue the operation. Unresolved source inputs refuse generation; the generated output itself may be conflicted. Default/head generation refuses to overwrite that conflicted output and directs the user to staged generation. The generated file contains no independent information to preserve by hand. A comment at the top of the file states this:

```
<!-- GENERATED FILE — do not edit by hand. Regenerate with: specplane plan index -->
```

---

## Keeping `PLANS.md` fresh

The file drifts whenever a plan file changes on the branch whose index is generated (a plan is created, edited, or merged). Branch creation and pull requests never make it stale, because they are not reflected in it. Two approaches are supported:

### Option A: CI regeneration on a selected branch

A user-configured CI job runs after pushes to the selected branch that change plan files or config, regenerates that branch's `PLANS.md`, and commits the result there if changed. `main` is an example, not a required destination.

**Advantages**:
- Always accurate on main.
- No manual regeneration needed.
- Works with protected branches (CI has write access).

**Disadvantages**:
- One extra CI commit per push that changes plans (adds noise to git log).
- Requires CI write access to main.
- Local view can be stale until CI runs.

### Option B: On-demand local regeneration

The CLI command `specplane plan index` regenerates `PLANS.md` locally. The user commits and pushes the updated file.

**Advantages**:
- No CI commit noise.
- Simple setup.

**Disadvantages**:
- Can be forgotten. `PLANS.md` may be stale on main.
- Requires a manual step after every plan change.

### Recommendation

Use **Option A** (CI) for projects with a CI pipeline. Use **Option B** for solo or offline projects.

Both options are supported; the choice is not enforced by Specplane. The framework provides the `specplane plan index` command for Option B and a CI recipe for Option A.

---

## Acceptance scenarios

### Scenario 1: PLANS.md is generated from plan frontmatter

Given three plans exist with varying statuses,
When `specplane plan index` is run,
Then `PLANS.md` is created or updated with a table listing all three plans and a Mermaid graph reflecting their dependencies.

### Scenario 2: PLANS.md conflict resolved by regeneration

Given `PLANS.md` has a merge conflict after two plan branches are merged,
When the plan/config conflicts are resolved and staged and `specplane plan index --source staged` is run,
Then `PLANS.md` is regenerated from the merged plan files, and the conflict is fully resolved.

### Scenario 3: Archived plans appear separately

Given two plans are in `plans/archive/`,
When `PLANS.md` is generated,
Then the active plans table appears first, and archived plans appear in a clearly labelled separate section.

### Scenario 4: Mermaid graph colour-coding

Given plan A is `done`, plan B is `ready` with all dependencies done, and plan C is `ready` and depends on B,
When `PLANS.md` is generated,
Then the Mermaid graph shows A in grey, B in green, and C in red (`blocked`).

### Scenario 4a: Branch state does not affect the committed file

Given `status_source: git`,
And plan B has `status: ready` and its branch `plan/<B>` exists,
When `PLANS.md` is generated,
Then plan B is shown as `ready`,
And `specplane plan list` (or `specplane plan index --print --live`) shows it as `in_progress`.

### Scenario 5: Hand edits are overwritten on generate

Given a developer edits `PLANS.md` by hand,
When `specplane plan index` is run (or CI regenerates it),
Then the manual edits are overwritten and `PLANS.md` equals the generated version.

### Scenario 5a: Validation warns when PLANS.md is stale

Given `PLANS.md` differs from the version `specplane plan index` would produce,
When `specplane validate` is run,
Then a warning is reported: "PLANS.md is stale; run `specplane plan index` to update."

### Scenario 6: CI regeneration commits only when changed

Given CI runs `specplane plan index` after a push to main,
And no plans changed since the last generation,
When `PLANS.md` is regenerated,
Then CI does not create a commit (the file is unchanged).

---

## Edge cases

- An empty `plans/` directory (no plans) produces a valid `PLANS.md` with an empty table and an empty graph.
- Plans with no dependencies are shown as isolated nodes in the graph.
- Very large dependency graphs may not render well in all Mermaid renderers. This is a display concern; the data in the table is always complete regardless.
- `PLANS.md` may be marked as generated for forges that collapse generated files in diffs and exclude them from language statistics. The recommended `.gitattributes` line is documented in `architecture/repository-layout`.

### Acceptance: explicit input sources

A plan title can differ in HEAD, the staging area and the working tree; each source renders its own version. Staged additions/deletions are reflected only in staged or matching working input. Working includes non-ignored untracked plans and excludes ignored untracked plans. Head is the default even during Git operations, with a safe refusal when it would overwrite a conflicted output. Merge, rebase and cherry-pick recovery use explicit staged generation, and regeneration after committing those same inputs is byte-identical. The optional edit hook selects working so its triggering edit appears.
