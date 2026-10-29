---
id: feature/configuration
title: Configuration schema and defaults
status: review
author: mixed
---

# Configuration schema and defaults

Specplane is configured by a single file: `.specplane/config.yaml` at the repository root. This spec defines the full schema, the default value for every key, and the behaviour each key controls.

---

## File location and format

- Path: `.specplane/config.yaml`
- Format: YAML
- Required: no. If the file is absent, all defaults apply.
- Partial configs are valid: any key omitted uses its default.
- Unknown keys produce a validation warning (not an error), to allow forward-compatibility.

---

## Full schema with defaults

```yaml
# ── Spec roots ───────────────────────────────────────────────────────────────
spec_roots:
  - name: base
    path: docs/specifications
    # extends: <root-name>    # omit for the base root; set for overlays

# ── Spec policies ─────────────────────────────────────────────────────────────
specs:
  llm_review: false           # agents add LLM review to leak-guard and overlay checks
  feature:
    authorship: user          # user | llm | either
    llm_role: assist          # assist | draft | none
    forbid_architecture: true # enable the architecture-leak guard
    leak_guard_allow: []      # terms that are part of this project's user-visible interface

  architecture:
    authorship: either        # user | llm | either
    llm_role: draft           # assist | draft | none
    require_approved_features: true  # block approval until feature specs are approved

# ── Plan settings ─────────────────────────────────────────────────────────────
plans:
  dir: plans                  # directory for all plan folders, relative to repo root
  require_approved_specs: feature   # none | feature | feature_and_architecture
  status_source: git          # git | frontmatter
  merge: pull_request         # pull_request | local_merge
  dependency_mode: wait_for_merge   # wait_for_merge | stack
  archive_done: true          # move completed plan folders to plans/archive/
  setup_hook: ""              # shell command run after worktree creation; empty = skip
  test_command: ""            # shell command run by the finish flow; empty = skip
  forge: auto                 # auto | github | none

# ── Execution backend ─────────────────────────────────────────────────────────
execution:
  backend: worktree           # worktree | branch | external
  worktree_dir: ../.specplane-worktrees   # where worktrees are created; relative to repo root

# ── Decision records ──────────────────────────────────────────────────────────
decisions:
  dir: docs/decisions         # directory holding ADRs
```

---

## Key reference

### `spec_roots`

**Type**: list of objects  
**Default**: one entry: `{name: base, path: docs/specifications}`

Declares every spec root. At least one root must be declared. The first root in the list whose name is `base` is the base root; if no root is named `base`, the first root is the base root.

Each entry:

| Sub-key | Type | Required | Description |
|---------|------|----------|-------------|
| `name` | string | yes | Unique identifier for this root. Used in qualified IDs: `<name>:<type>/<slug>`. |
| `path` | string | yes | Path to the root directory, relative to the repository root. |
| `extends` | string | no | Name of the root this root overlays. See `feature/spec-overlays`. Omit for standalone roots. |

Two roots with the same `name` are a validation error. A root that `extends` an undeclared root, or a cycle of `extends` links, is a validation error.

---

### `specs.llm_review`

**Type**: boolean  
**Default**: `false`

When `true`, agents running the `validate` workflow integration add an LLM review stage to the checks that heuristics cannot settle: the architecture-leak guard (see `feature/spec-policies` §3) and overlay contradiction detection (see `feature/spec-overlays`). LLM review is performed by the agent, never by the CLI; its findings are warnings. The review is skipped for spec types whose `llm_role` is `none`.

---

### `specs.feature.authorship`

**Type**: enum  
**Default**: `user`  
**Allowed values**: `user` | `llm` | `either`

Controls who is expected to author feature specs. See `feature/spec-policies` §1.

---

### `specs.feature.llm_role`

**Type**: enum  
**Default**: `assist`  
**Allowed values**: `assist` | `draft` | `none`

Controls what role an LLM agent may play in writing feature specs. See `feature/spec-policies` §1.

---

### `specs.feature.forbid_architecture`

**Type**: boolean  
**Default**: `true`

Enables the architecture-leak guard for feature specs. When `true`, feature specs are checked for architecture details. See `feature/spec-policies` §3.

---

### `specs.feature.leak_guard_allow`

**Type**: list of strings  
**Default**: `[]`

Terms that belong to the project's user-visible interface and must not be flagged by the architecture-leak guard heuristics — for example the names of files a user must create, command names, or product names. A term matches case-sensitively as a whole word or path. See `feature/spec-policies` §3.

---

### `specs.architecture.authorship`

**Type**: enum  
**Default**: `either`  
**Allowed values**: `user` | `llm` | `either`

Controls who is expected to author architecture specs. See `feature/spec-policies` §1.

---

### `specs.architecture.llm_role`

**Type**: enum  
**Default**: `draft`  
**Allowed values**: `assist` | `draft` | `none`

Controls what role an LLM agent may play in writing architecture specs. See `feature/spec-policies` §1.

---

### `specs.architecture.require_approved_features`

**Type**: boolean  
**Default**: `true`

When `true`, an architecture spec cannot be set to `approved` unless all specs in its `implements` list are `approved`. See `feature/spec-policies` §2.

---

### `plans.dir`

**Type**: string  
**Default**: `plans`

The directory (relative to repository root) where all plan folders are stored. Completed plans are archived under `<plans.dir>/archive/` when `archive_done: true`.

---

### `plans.require_approved_specs`

**Type**: enum  
**Default**: `feature`  
**Allowed values**: `none` | `feature` | `feature_and_architecture`

Controls which specs must be approved before a plan may start.

| Value | Behaviour |
|-------|-----------|
| `none` | No spec approval required. Plans may start at any time. |
| `feature` | Every feature spec in the plan's `specs` list must be `approved`. |
| `feature_and_architecture` | Both feature and architecture specs in the plan's `specs` list must be `approved`. |

---

### `plans.status_source`

**Type**: enum  
**Default**: `git`  
**Allowed values**: `git` | `frontmatter`

Controls how the derived statuses `in_progress` and `review` are determined. See `feature/plan-status` for the full trade-off discussion.

| Value | Behaviour |
|-------|-----------|
| `git` | `in_progress` is derived from whether branch `plan/<id>` exists. `review` is derived from whether an open PR exists for that branch (requires forge integration, see `plans.forge`; falls back to `in_progress` if unavailable). |
| `frontmatter` | `in_progress` and `review` are stored in the frontmatter explicitly and updated by claim commits on the default branch. |

---

### `plans.merge`

**Type**: enum  
**Default**: `pull_request`  
**Allowed values**: `pull_request` | `local_merge`

Controls the finish flow for plans. See `feature/plan-execution`.

| Value | Behaviour |
|-------|-----------|
| `pull_request` | Finish flow opens a pull request. A human reviews and merges. |
| `local_merge` | Finish flow requests a local merge (e.g. `git merge`). Suitable for teams without a forge or for trusted automation. |

---

### `plans.dependency_mode`

**Type**: enum  
**Default**: `wait_for_merge`  
**Allowed values**: `wait_for_merge` | `stack`

Controls how plans with dependencies behave. See `feature/plan-execution`.

| Value | Behaviour |
|-------|-----------|
| `wait_for_merge` | A plan cannot start until all plans in its `depends_on` list are `done` (merged). |
| `stack` | A plan may start from the tip of its dependency's branch, before it is merged. At most one dependency may be unmerged at start time. |

---

### `plans.archive_done`

**Type**: boolean  
**Default**: `true`

When `true`, the plan folder is moved to `<plans.dir>/archive/<id>/` when the plan's status becomes `done`.

---

### `plans.setup_hook`

**Type**: string  
**Default**: `""` (empty, no hook)

A shell command run in a fresh worktree after it is created, before any step begins. Typical use: install dependencies (e.g. `npm install`). See `feature/plan-execution`.

If the command exits non-zero, the worktree creation fails and the error is reported.

---

### `plans.test_command`

**Type**: string  
**Default**: `""` (empty, no test run)

A shell command run in the plan's checkout by the finish flow to verify the plan (e.g. `npm test`). A non-zero exit stops the finish flow. When empty, the finish flow reports that no test command is configured and continues. See `feature/plan-execution`.

---

### `plans.forge`

**Type**: enum  
**Default**: `auto`  
**Allowed values**: `auto` | `github` | `none`

Selects the forge (code-hosting service) used to open pull requests and to derive the `review` status.

| Value | Behaviour |
|-------|-----------|
| `auto` | Use a supported forge if one is detected for the repository's remote and its tooling is available; otherwise behave as `none`. |
| `github` | Use GitHub. If it is unavailable, forge operations fail with an error. |
| `none` | No forge integration. `review` is never derived; with `merge: pull_request`, the finish flow pushes the branch and asks the human to open the pull request. |

---

### `execution.backend`

**Type**: enum  
**Default**: `worktree`  
**Allowed values**: `worktree` | `branch` | `external`

Controls how plan execution is backed. See `feature/plan-execution`.

| Value | Behaviour |
|-------|-----------|
| `worktree` | Each active plan gets its own git worktree. Multiple plans may run in parallel on the same machine. |
| `branch` | Plans run on branches without worktrees; one checkout is used and switched. Serial only. |
| `external` | Plans run in external environments (cloud agents, remote machines) that manage their own checkouts. |

---

### `execution.worktree_dir`

**Type**: string  
**Default**: `../.specplane-worktrees`

Base directory (relative to repository root) where git worktrees are created. Must be outside the repository to avoid nesting. Only used when `execution.backend: worktree`.

The actual worktree for a plan is created at `<worktree_dir>/<repo-name>/<plan-id>/`, where `<repo-name>` is the name of the main checkout's root directory. The `<repo-name>` level prevents plan ID collisions when sibling repositories both use Specplane (they share the same `../.specplane-worktrees` parent but have different repo-name subdirectories).

`worktree_dir` and `<repo-name>` are always resolved against the **main checkout**, even when a command runs inside a plan worktree, so every worktree of a repository computes the same paths.

---

### `decisions.dir`

**Type**: string  
**Default**: `docs/decisions`

The directory (relative to the repository root) holding architecture decision records. See `feature/decisions`.

---

## Acceptance scenarios

### Scenario 1: Config absent — all defaults apply

Given no `.specplane/config.yaml` exists,
When Specplane initialises,
Then all settings use the defaults defined in this spec, and a warning is emitted: "No `.specplane/config.yaml` found; using defaults."

### Scenario 2: Partial config — missing keys use defaults

Given `.specplane/config.yaml` contains only `plans.merge: local_merge`,
When Specplane reads the config,
Then `plans.merge` is `local_merge` and all other settings use their defaults.

### Scenario 3: Unknown key

Given `.specplane/config.yaml` contains a key not in this schema,
When Specplane reads the config,
Then a warning is emitted: "Unknown config key `<key>`; ignoring."

### Scenario 4: Invalid value

Given `.specplane/config.yaml` contains `plans.status_source: automatic` (not a valid enum value),
When Specplane reads the config,
Then a hard error is reported: "`plans.status_source` must be one of: `git`, `frontmatter`. Got: `automatic`."

### Scenario 5: Two roots with the same name

Given `spec_roots` contains two entries both named `base`,
When Specplane reads the config,
Then a hard error is reported: "Duplicate spec root name `base`."

---

## Edge cases

- The **repository root** is the root of the checkout the command runs in: the main checkout, or a plan worktree. The config file is always read from the repository root, regardless of the current working directory, so a plan worktree uses the config committed on its plan branch.
- Relative paths in the config are relative to the repository root, except `execution.worktree_dir`, which is relative to the main checkout's root (see above).
- `execution.worktree_dir` may be an absolute path. It must not be inside the main checkout.
