---
id: feature/configuration
title: Configuration schema and defaults
status: review
author: mixed
---

<!-- Revision 2026-11-01: extension/core separation and contribution provenance agreed in conversation; existing lifecycle status is unchanged. Implementation and integration review remain pending. -->

<!-- Experimental development amendment 2026-11-01. Existing status records prior approval only; these branch changes await human final review. -->

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
  pin_bases: warn             # off | warn | require — base pins (based_on)
  feature:
    authorship: user          # user | llm | either
    llm_role: assist          # review | assist | draft | none
    forbid_architecture: true # enable the architecture-leak guard
    leak_guard_allow: []      # terms that are part of this project's user-visible interface

  architecture:
    authorship: either        # user | llm | either
    llm_role: draft           # review | assist | draft | none
    require_approved_features: true  # block approval until feature specs are approved

# ── Plan settings ─────────────────────────────────────────────────────────────
plans:
  dir: plans                  # directory for all plan folders, relative to repo root
  require_approved_specs: feature   # none | feature | feature_and_architecture
  status_source: git          # git | frontmatter
  merge: pull_request         # pull_request | local_merge
  dependency_mode: wait_for_merge   # wait_for_merge | stack
  archive_done: true          # move completed plan folders to <plans.dir>/archive/
  setup_hook: ""              # shell command run after worktree creation; empty = skip
  test_command: ""            # shell command run by the finish flow; empty = skip
  forge: auto                 # auto | github | none

# ── Execution backend ─────────────────────────────────────────────────────────
execution:
  backend: worktree           # worktree | branch | external
  worktree_dir: ../.specplane-worktrees   # where worktrees are created; relative to the main checkout
  session_mode: auto         # auto | unattended; never forces attended
  notify:
    on: [blocked, consideration, finish_ready, failed]
    transport: none          # none | harness | command
    command: ""
    dedupe: true
  max_parallel: 1
  max_budget_usd: null

# ── Verification ──────────────────────────────────────────────────────────────
verification:
  mode: auto                  # auto | manual
  suites: {}                  # name -> { command: [argv...], format: node-tap-v13 | junit-xml }
  text_paths: ["**/*.md", "docs/**"]   # changes limited to these need no tests
  risk_paths: [".specplane/**", ".claude/**", ".agents/**", ".github/**", "AGENTS.md", "CLAUDE.md", "**/SKILL.md"]   # changes here need a separate or human check

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

Two roots with the same `name` are a validation error. A root that `extends` an undeclared root, or a cycle of `extends` links, is a validation error. A root whose `path` does not exist or is not a directory is a validation error. A root whose `path` resolves outside the repository root (an absolute path, or one containing `..` that leaves the repository) is a validation error.

---

### `specs.llm_review`

**Type**: boolean  
**Default**: `false`

When `true`, agents running the `validate` workflow integration add an LLM review stage to the checks that heuristics cannot settle: the architecture-leak guard (see `feature/spec-policies` §3) and overlay contradiction detection (see `feature/spec-overlays`). LLM review is performed by the agent, never by the CLI; its findings are warnings. The review is skipped for spec types whose `llm_role` is `none`.

---

### `specs.pin_bases`

**Type**: `off` | `warn` | `require`  
**Default**: `warn`

Controls base pins (`based_on`; see `feature/spec-overlays#base-pins`). Stale pins are always reported and block approval; this key only sets how missing pins are reported.

| Value | Missing pin |
|-------|-------------|
| `off` | Not reported. |
| `warn` | Warning for an overlay spec whose `extends` entries are not pinned. |
| `require` | Error for any unpinned `extends` or `implements` entry. |

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
**Allowed values**: `review` | `assist` | `draft` | `none`

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
**Allowed values**: `review` | `assist` | `draft` | `none`

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

### `plans.target_branch`

**Type**: string (optional)
**Default**: repository default branch when omitted

The team's default integration branch for new plans, such as `dev`. A plan may declare its own `target_branch`, and first start may explicitly select a target when the plan has none. The branch must exist when starting; no branch is silently created. An explicit start selection must agree with a target already declared in the plan. Started plans retain their recorded target when this setting changes. Selecting a branch neither approves its specs nor authorizes a merge. See `feature/plan-execution` § Integration target and comparison baseline.

---

### `plans.status_source`

**Type**: enum  
**Default**: `git`  
**Allowed values**: `git` | `frontmatter`

Controls how the derived statuses `in_progress` and `review` are determined. See `feature/plan-status` for the full trade-off discussion.

| Value | Behaviour |
|-------|-----------|
| `git` | `in_progress` is derived from whether branch `plan/<id>` exists. `review` is derived from whether an open PR exists for that branch (requires forge integration, see `plans.forge`; falls back to `in_progress` if unavailable). |
| `frontmatter` | `in_progress` and `review` are stored in the frontmatter explicitly and updated by claim commits on the integration target. |

---

### `plans.merge`

**Type**: enum  
**Default**: `pull_request`  
**Allowed values**: `pull_request` | `local_merge`

Controls the finish flow for plans. See `feature/plan-execution`.

| Value | Behaviour |
|-------|-----------|
| `pull_request` | Finish flow opens a pull request. A human reviews and merges. |
| `local_merge` | After the human confirms, the finish flow merges the plan branch into the integration target in a checkout of the selected target and cleans up immediately. No pull request is opened. With `plans.forge: none` this is the fully local mode: no remote or forge is needed. See `feature/plan-execution` § Local merge. |

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

When `true`, the plan folder is moved to `<plans.dir>/archive/<id>/` when the plan's status becomes `done` or `abandoned`. Shelved plans are not archived. Archiving changes record location, not lifecycle status or checkout retention.

---

### `plans.setup_hook`

**Type**: string  
**Default**: `""` (empty, no hook)

A shell command run in a fresh worktree after it is created, before any step begins. Typical use: install dependencies (for example, with the project's package manager). See `feature/plan-execution`.

If the command exits non-zero, the worktree creation fails and the error is reported.

---

### `plans.test_command`

**Type**: string  
**Default**: `""` (empty, no test run)

A shell command run in the plan's checkout by the finish flow to verify the plan (for example, the project's test suite). A non-zero exit stops the finish flow. When empty, the finish flow reports that no test command is configured and continues. See `feature/plan-execution`.

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
| `none` | No forge integration. `review` is never derived; with `merge: pull_request`, the finish flow pushes the branch and asks the human to open the pull request; with `merge: local_merge`, no forge is needed. |

With `merge: local_merge`, the finish flow never opens a pull request, whatever the forge setting; a forge is still used to derive `review` if a pull request for the plan branch was opened by hand.

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

A `worktree_dir` that resolves inside the main checkout is a hard error when the worktree backend is used.

---

### `verification.mode`

**Type**: enum
**Default**: `auto`

`auto` sets a minimum check for each step from the files it changed (`feature/plan-steps` § Verification). `manual` sets no minimum.

---

### `verification.suites`

**Type**: map of suite name to `{command, format}`
**Default**: empty

The test commands Specplane may run as proof. `command` is an argument list, never a shell string. `format` is the report format the command prints: `node-tap-v13` or `junit-xml`. Only the committed version counts, so an uncommitted edit cannot add a command. A step cannot edit the configuration, and if the `verification` settings changed after the plan started, the step needs a `human` check, so an agent cannot quietly change what proves its own work. This key is separate from `plans.test_command`, which belongs to the finish flow.

---

### `verification.text_paths`

**Type**: list of glob patterns
**Default**: `["**/*.md", "docs/**"]`

A step whose changes all match these patterns needs no tests.

---

### `verification.risk_paths`

**Type**: list of glob patterns
**Default**: `[".specplane/**", ".claude/**", ".agents/**", ".github/**", "AGENTS.md", "CLAUDE.md", "**/SKILL.md"]`

A step that changes a matching file needs a `separate` or `human` check against the spec. Files inside a configured spec root always count as risky. A file matching both this key and `verification.text_paths` counts as risky.

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

### Scenario 6: Worktree directory inside the repository

Given `execution.worktree_dir: .worktrees` and `execution.backend: worktree`,
When Specplane reads the config,
Then a hard error is reported: "`execution.worktree_dir` must be outside the repository. `.worktrees` resolves to `<path>` inside it."

### Scenario 7: Spec root does not exist

Given `spec_roots` contains `{name: docs, path: docs/missing}` and that directory does not exist,
When Specplane validates,
Then an error is reported: "Spec root `docs`: path `docs/missing` does not exist."

### Scenario 8: Spec root escapes the repository

Given `spec_roots` contains `{name: shared, path: ../shared-specs}`,
When Specplane reads the config,
Then an error is reported: "Spec root `shared`: path `../shared-specs` is outside the repository."

---

## Edge cases

- The **repository root** is the root of the checkout the command runs in: the main checkout, or a plan worktree. The config file is always read from the repository root, regardless of the current working directory, so a plan worktree uses the config committed on its plan branch.
- Relative paths in the config are relative to the repository root, except `execution.worktree_dir`, which is relative to the main checkout's root (see above).
- `execution.worktree_dir` may be an absolute path. It must not be inside the main checkout.

## Experimental conductor configuration

`execution.session_mode` is `auto` (use interaction availability reported by the invoking extension) or `unattended` (forces unattended). Unknown interaction availability is unattended. This setting never selects a harness. Neither value permits downgrading an unattended session to attended or bypassing approval policy.

Execution backend, isolation, limits, and notification preferences are shared policy consumed by manual operations or extensions as applicable. Extensions supply their host context and capabilities explicitly. The core has no configured or detected default runtime and no external provider registration. Unsupported capabilities are reported before execution, without rewriting configuration or choosing a different host.

`execution.notify.on` selects `blocked`, `consideration`, `finish_ready`, `done`, or `failed`. The default selects all except `done`. `consideration` groups gap decisions, restack, divergence, dirty worktrees, and execution limits. Ordinary progress is not an alert. `transport` is `none` (default, no delivery/cache), `harness` (adapter callback only), or `command` (the user's configured command). Command transport requires a nonblank command. `dedupe` defaults true. Delivery failures are logged without failing the run. With dedupe enabled, the attempt is recorded before delivery, because an error or crash cannot prove non-delivery; uncertain attempts are not automatically resent. A malformed cache suppresses delivery until inspected. Resolved considerations are removed so recurrence alerts again.

Command transport receives `SPECPLANE_PLAN`, `SPECPLANE_KIND`, `SPECPLANE_DETAIL`, `SPECPLANE_COMMAND`, `SPECPLANE_SESSION`, and `SPECPLANE_CHECKOUT`. Specplane never enables a transport or external notification channel itself.

`execution.max_parallel` is a positive integer, default 1, limiting distinct concurrent plans. `execution.max_budget_usd` is a positive finite number or null (default, no configured bound). The conductor reserves the bound in equal shares across its maximum session attempts. Unsupported budget enforcement is a refusal; reservations include uncertain launch attempts and are not a measurement of cost.

## Scope of policy and managed workflows

Configuration describes explicit repository policies and defaults for operations users elect to run; installing Specplane does not require plans or prescribed branches for ordinary development. Approval requirements for managed start apply to that start operation, not all Git activity. Ordinary commits do not require Specplane trailers. Review authority and agent authorship settings remain separate from implementation completion and cannot be inferred from completion metadata.

Alignment, completion-freshness and instruction-freshness findings are advisory by default. Existing format errors and concrete safety failures of a requested mutation remain errors. Teams may explicitly enforce selected findings in their CI; no implicit Git hook or new blanket enforcement mode is installed by this change.
