---
id: feature/tooling
title: CLI behaviour
status: review
author: mixed
---

# CLI behaviour

This spec defines the behaviour of the Specplane CLI (`specplane`). The CLI is a convenience layer over the format; it is never required. All operations it performs can be done by hand.

This spec is **language-agnostic**: it defines inputs, outputs, exit codes, and error cases without prescribing an implementation language.

---

## General conventions

- Every command reads `.specplane/config.yaml` from the current repository root. If the config is absent, defaults apply and a warning says so (see `feature/configuration`).
- All relative paths are resolved relative to the repository root (the directory containing `.git`), not the current working directory.
- Exit code `0` on success, non-zero on any error.
- Errors are written to stderr. Normal output is written to stdout.
- Machine-readable output (when available) is JSON on stdout. Human-readable output is plain text or markdown-like text.
- Commands that modify the filesystem describe what they changed on stdout before exiting.
- A `--dry-run` flag is supported for commands that modify files or git state. With `--dry-run`, no changes are made; the command prints what it would do.

---

## `specplane init`

Scaffolds the repository for Specplane use.

**Inputs**: none. May be run from anywhere inside a git repository.

**Options**:
- `--harness <name>`: also create the integration files for the named agent harness (e.g. `claude`). The harness's overlay specs define which files these are. Without this option, a harness is set up only if it is detected (each harness's overlay defines its detection rule).

**What it creates** (paths shown with default config; if a config file already exists, its `spec_roots`, `plans.dir`, and `decisions.dir` are used instead):
```
.specplane/config.yaml                     (default config, if absent)
docs/specifications/features/INFO.md       (if absent)
docs/specifications/architecture/INFO.md   (if absent)
plans/.gitkeep                             (if plans/ is empty, so the directory is tracked)
AGENTS.md                                  (Specplane standing instructions, as a managed block)
```

The `archive/` folder and the decisions directory are created on first use.

**Behaviour**:
- Does not overwrite existing files, except Specplane's own: the managed block in `AGENTS.md` (created, appended, or updated; text outside it is untouched) and harness files the harness's overlay declares Specplane-owned. Reports each file it creates, updates, or skips.
- Re-running `init` after upgrading Specplane updates the standing instructions and harness files.
- Does not create a `.git` directory or initialise git.

**Exit codes**:
- `0`: success
- `1`: not in a git repository

**Example output**:
```
Created .specplane/config.yaml
Created docs/specifications/features/INFO.md
Updated AGENTS.md (appended Specplane block)
```

---

## `specplane spec`

Subcommands for managing specs.

### `specplane spec new <type> <slug>`

Creates a new spec file with the required frontmatter.

**Arguments**:
- `<type>`: `feature` or `architecture`
- `<slug>`: a kebab-case slug for the spec

**Options**:
- `--root <name>`: spec root to create in (default: `base`)
- `--title <title>`: spec title (prompted interactively if absent)
- `--implements <id,...>`: for architecture specs, the feature spec IDs implemented
- `--extends <id,...>`: for overlay specs, the base spec IDs extended

The new spec has `status: draft` and `author: user`.

**What it creates**: a spec file with frontmatter at `<root-path>/features/<slug>.md` (type `feature`) or `<root-path>/architecture/<slug>.md` (type `architecture`).

**Error cases**:
- Spec with that ID already exists in the root or its extends chain → exit 1, "Spec `<type>/<slug>` already exists."
- Unknown root name → exit 1, "Unknown root `<name>`."
- Unknown type → exit 1, "Unknown spec type `<type>`: expected `feature` or `architecture`."
- Architecture spec with no `--implements` → prompts for it interactively; if still not provided, exit 1, "Architecture spec needs `--implements`."

### `specplane spec list`

Lists all specs.

**Options**:
- `--status <status>`: filter by status
- `--type feature|architecture`: filter by type
- `--root <name>`: filter by root (default: all roots)
- `--json`: output as JSON array

**Output** (human-readable):
```
feature/spec-system      Spec system              review
feature/plan-system      Plan system              approved
architecture/plan-system Plan system (arch)       draft
```

**JSON output**: array of objects with fields `id`, `title`, `status`, `author`, `root`.

### `specplane spec show <id>`

Prints the spec file for the given ID.

**Options**:
- `--root <name>`: qualify the root (for overlay specs with ambiguous IDs)

**Error cases**:
- Unknown ID → exit 1, "Spec `<id>` not found."
- Ambiguous unqualified ID (exists in multiple roots) → exit 1, "Ambiguous ID `<id>`: found in roots `base`, `claude`. Use `<root>:<id>`."

### `specplane spec validate [<id>...]`

Validates one, several, or all specs.

**Arguments**: zero or more spec IDs. If none given, validates all specs in all roots.

**Checks performed**:
- Frontmatter schema (all required fields present, valid values).
- ID matches file path.
- `implements`, `supersedes`, and `extends` references resolve; overlay rules (see `feature/spec-overlays`).
- Authorship consistency (warnings; see `feature/spec-policies` §1).
- Ordering policy: an `approved` architecture spec whose `implements` list contains a non-approved spec is an error.
- `architecture_reason` is present when `allow_architecture: true` (error).
- References to `deprecated` specs (warnings) and unresolved `#section` anchors (warnings).
- `INFO.md` files with frontmatter (error; see `feature/spec-system`).
- Base pins (`based_on`): stale pins warn (`base-changed`) and block approval; missing pins per `specs.pin_bases` (see `feature/spec-overlays#base-pins`).
- Architecture-leak guard heuristics (if enabled; warnings).
- Overlay contradiction heuristics (warnings).

All rules defined in the referenced feature specs are checked, whether or not listed here.

The CLI runs only deterministic checks. LLM review stages (`specs.llm_review`) are performed by agents through the `validate` workflow integration (see `feature/agent-integration`).

**Output**: human-readable report of warnings and errors.

**Options**:
- `--json`: machine-readable JSON output (see format below).

**JSON output format**:
```json
{
  "valid": false,
  "errors": [
    {"spec": "feature/search", "message": "ID does not match path-derived ID", "severity": "error"}
  ],
  "warnings": [
    {"spec": "feature/search", "message": "Possible architecture detail: 'JSON Schema'", "severity": "warning"}
  ]
}
```

Each finding may also carry a `type` naming the rule that produced it (for example `base-changed`), so tools can filter findings without parsing messages.

**Exit codes**:
- `0`: valid (no errors; warnings do not affect exit code)
- `1`: one or more errors

### `specplane spec pin <id> [<ref-id>...]`

Writes or refreshes the spec's base pins (`based_on`) to the current committed versions of the named references, or of all its `extends` and `implements` entries when none are named. See `feature/spec-overlays#base-pins`.

**Options**:
- `--check`: change nothing; list stale pins (and missing pins under `specs.pin_bases: require`) for all specs, and exit 1 if there are any.

**Output**: one line per pin written, `pinned <ref-id> <hash>`.

**Error cases**:
- Unknown spec ID → exit 1, "Spec `<id>` not found."
- A named reference is not in the spec's `extends` or `implements` → exit 1, "`<ref-id>` is not extended or implemented by `<id>`."
- A referenced file has uncommitted changes → exit 1, "Commit or stash changes to `<path>` first."

---

## `specplane plan`

Subcommands for managing plans.

### `specplane plan new`

Prompts for plan fields and creates a new plan folder with `PLAN.md` and a `steps/` directory.

**Options**:
- `--id <id>`: full plan ID (skips the date+slug prompt)
- `--title <title>`
- `--specs <id,...>`
- `--depends-on <id,...>`

**Error cases**:
- Plan with that ID already exists → exit 1, "Plan `<id>` already exists. Choose a different slug."

### `specplane plan list [--status <status>]`

Lists plans and their effective statuses.

**Options**:
- `--status <status>`: filter by effective status (stored + derived)
- `--json`
- `--live`: also report each plan's activity: where it runs (local checkout or remote branch only), step progress and the next step, open blockers, and the most recent step commit with the agent session that made it. Includes plans whose branches exist only on the remote, so work from other machines and cloud sessions is visible. Fetches from the remote once unless `--no-fetch` is given.

**Output** (human-readable):
```
2026-10-28-plan-index-generator  Generate PLANS.md     in_progress
2026-10-20-frontmatter-schema    Frontmatter schema     done
```

**JSON output**: array of objects with fields `id`, `title`, `stored_status`, `effective_status`, `depends_on`, `specs`, `archived`; with `--live`, also the activity fields defined in `architecture/reference-cli` § Plan activity.

### `specplane plan show <id>`

Prints the PLAN.md for the given plan.

### `specplane plan graph`

Prints the Mermaid dependency graph to stdout (the same graph that appears in PLANS.md).

### `specplane plan start <id>`

Executes the start flow for a plan. See `feature/plan-execution`.

### `specplane plan finish <id>`

Executes the finish flow for a plan. See `feature/plan-execution`.

### `specplane plan abandon <id>`

Abandons a plan. See `feature/plan-execution` § Abandoning a plan.

**Options**:
- `--delete-branch`: also delete branch `plan/<id>` (kept by default).
- `--force`: remove the worktree even if it has uncommitted changes.

### `specplane plan cleanup <id>`

Removes the worktree and deletes branch `plan/<id>` after the plan has merged (finish flow step 7). Refuses to delete the branch unless the plan is `done` on the default branch. Idempotent.

**Options**:
- `--force`: remove the worktree even if it has uncommitted changes.

### `specplane plan archive <id>`

Moves a `done` or `abandoned` plan's folder into `<plans.dir>/archive/` — for plans that ended while `plans.archive_done` was `false`. Errors if the plan is not `done` or `abandoned`, or is already archived. Does not touch branches or worktrees.

---

## `specplane search <text>`

Full-text search over spec and plan files, plus frontmatter filtering.

**Arguments**: `<text>` — text to search for.

**Options**:
- `--type spec|plan`: restrict to spec or plan files
- `--status <status>`: filter by status
- `--root <name>`: restrict to a spec root
- `--json`

**Output**: list of matching files with a snippet of the matching line.

---

## `specplane validate`

Validates the entire repository: all specs, all plans, config, and cross-references.

**What it checks**:
- Config schema (unknown keys are warnings; see `feature/configuration`).
- All spec validation (per `spec validate`).
- All plan and step frontmatter schemas, and step rules (numbering, `context` references, HANDOFF.md entries for skipped/blocked steps; see `feature/plan-steps`).
- Plan dependency cycles, dangling plan IDs in `depends_on`, and dependencies on abandoned plans.
- Dangling or deprecated spec IDs in plans.
- ADR rules: IDs, duplicate numbers, `superseded_by`, `related_specs` (see `feature/decisions`).
- PLANS.md freshness (warning if it differs from what `specplane generate` would write).
- Standing-instructions freshness (warning if the Specplane standing instructions are missing, malformed, or older than the installed Specplane; see `feature/agent-integration`).

**Options**:
- `--json`

**Exit codes**:
- `0`: valid (no errors)
- `1`: one or more errors

---

## `specplane generate`

Regenerates `PLANS.md` from the committed plan files (see `feature/plan-index`). The output is deterministic.

**Output**: `<plans.dir>/PLANS.md` is written (or updated).

**Options**:
- `--print`: print the generated content to stdout instead of writing the file.
- `--live`: use live effective statuses (git branches and pull requests) instead of index statuses. Only allowed with `--print`, so the committed file never contains live state; `--live` alone exits 1 with "`--live` requires `--print`."

---

## Acceptance scenarios

### Scenario 1: `specplane init` in a clean repo

Given an empty git repository,
When `specplane init` is run,
Then the expected directories and files are created, and the command reports each created file.

### Scenario 2: `specplane spec validate` with errors

Given a spec file with `id: feature/wrong-name` but path `features/search.md`,
When `specplane spec validate feature/search` is run,
Then exit code is 1 and stderr contains "ID `feature/wrong-name` does not match path-derived ID `feature/search`".

### Scenario 3: `specplane spec validate --json`

Given the above error,
When `specplane spec validate --json` is run,
Then stdout contains a JSON object with `"valid": false` and an `errors` array.

### Scenario 4: `specplane plan list --status blocked`

Given one plan is `blocked` and two are `ready`,
When `specplane plan list --status blocked` is run,
Then only the blocked plan is listed.

### Scenario 5: `specplane search "architecture-leak"` returns spec matches

Given the text "architecture-leak" appears in `feature/spec-policies.md`,
When `specplane search "architecture-leak"` is run,
Then the output includes `feature/spec-policies` with a snippet.

### Scenario 6: `specplane validate` on a clean repo

Given all specs are valid, all plans have valid frontmatter, and no cycles exist,
When `specplane validate` is run,
Then exit code is 0 and output is "All checks passed."

---

## Edge cases

- Running any `specplane` command outside a git repository exits with code 1 and the message "Not in a git repository."
- `specplane spec new` with a slug containing uppercase letters normalises it to lowercase.
- `specplane plan start` run twice on the same plan (branch already exists) resumes the plan rather than failing.
- Commands behave the same in the main checkout and in a plan worktree; paths derived from `execution.worktree_dir` always resolve against the main checkout (see `feature/configuration`).
- `--dry-run` is not supported for `generate` (it only reads and writes one file; `--print` is the equivalent).
