---
id: feature/tooling
title: CLI behaviour
status: approved
author: mixed
---

<!-- Revision 2026-11-01: extension/core separation and contribution provenance agreed in conversation; existing lifecycle status is unchanged. Implementation and integration review remain pending. -->

# CLI behaviour

This spec defines the behaviour of the Specplane CLI (`specplane`). The CLI is a convenience layer over the format; it is never required. All operations it performs can be done by hand.

This spec is **language-agnostic**: it defines inputs, outputs, exit codes, and error cases without prescribing an implementation language.

## Manual and extension interfaces

The standalone CLI supports the complete manual lifecycle without a harness: create, inspect, validate, approve, prepare a checkout, record a step, and explicitly finish through the configured gates. Approval commands remain explicit human decisions whether invoked manually or through an extension. The CLI never launches or chooses an agent runtime; `plan run` and `plan start --run` are extension automation concerns and are not standalone commands.

Extensions expose mechanical operations through deterministic handlers, reasoning workflows through deterministic preparation and validation around agent work, and human decisions through explicit confirmation followed by deterministic transitions. Unsupported native dispatch is reported as unavailable rather than represented as a prompt-only equivalent. Existing host commands, including session resume, retain their host behavior.

Contribution inspection presents all recorded human/model contributors and their revision-linked roles, with session and model details when known. It distinguishes missing historical attribution from verified records and keeps approval provenance separate. Model display labels have no policy effect.

---

## General conventions

- Repository operations read `.specplane/config.yaml` from the current repository root. Documentation commands do not require a repository or configuration. If the config is absent, defaults apply and a warning says so (see `feature/configuration`).
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
- `--harness <name>`: explicitly install or refresh the named harness integration (e.g. `claude` or `codex`). The overlay defines its files and package delivery. Without this option, initialize neutral scaffolding only, regardless of detected integrations. `--harness none` explicitly requests the same neutral behavior. Unknown names fail before any write.

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
- Re-running `init` updates shared standing instructions. Harness files are updated only when that harness is explicitly selected. Co-installed harnesses never change the shared workflow guidance by installation order.
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

### `specplane spec approve <id>...`

Approves each spec in the order given: sets `status: approved` and commits the change. Approval is the human's decision; an agent runs this command only when the user asks for it.

Before approving an extending overlay, it re-pins the overlay's bases (as `spec pin` does) when every base is approved and committed; the new pins go in the same commit.

**Output**: one line per spec, `approved <id> <commit>`, or the reasons it was refused.

**Commit**: subject `docs(specs): approve <id>`, trailer `Specplane-Workflow: approve` (see `feature/agent-integration#agent-made-changes-are-attributable`). The user stays the author.

**Error cases** (each refuses that spec, exits 1, and stops; specs approved earlier in the same run stay approved):
- Unknown spec ID → "Spec `<id>` not found."
- The spec's status is not `draft` or `review` → "Spec `<id>` is `<status>`; only `draft` or `review` specs can be approved."
- The spec file has uncommitted changes → "Commit or stash changes to `<path>` first."
- An architecture spec implements a feature spec that is not approved, under `specs.architecture.require_approved_features` → "Cannot approve `<id>`: `<feature-id>` is `<status>`, not `approved`."
- A base of an overlay is not approved, or a base pin is stale and cannot be refreshed → "Cannot approve `<id>`: base `<base-id>` is `<status>`." / "Cannot approve `<id>`: base `<base-id>` changed since it was pinned."
- Validation reports errors for the spec → the errors are listed.

### `specplane spec reopen <id>`

Sets an approved spec back to `status: review` and commits the change (subject `docs(specs): reopen <id>`), so it can be edited outside a plan branch.

**Output**: the commit, then the specs that can no longer stay approved because of it (architecture specs that implement it, overlays that extend it), each with the command that reopens it. It does not change those specs.

**Error cases**:
- Unknown spec ID → exit 1, "Spec `<id>` not found."
- The spec is not `approved` → exit 1, "Spec `<id>` is `<status>`, not `approved`."

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
- `--target <branch>`: write the plan's intended integration target.
- `--comparison-base <commit>`: resolve and record an immutable comparison commit, independently of the target.

**Error cases**:
- Plan with that ID already exists → exit 1, "Plan `<id>` already exists. Choose a different slug."

### `specplane plan list [--status <status>]`

Lists plans and their effective statuses.

**Options**:
- `--status <status>`: filter by effective status (stored + derived)
- `--json`
- `--live`: also report each plan's activity: where it runs (local checkout or remote branch only), step progress and the next step, open blockers, and the most recent step commit with the agent session that made it. Includes plans whose branches exist only on the remote, so work from other machines and cloud sessions is visible. Fetches from the remote once unless `--no-fetch` is given.
- `--no-fetch`: with `--live`, do not fetch from the remote; use the remote-tracking refs as they are. Has no effect without `--live`.

**Output** (human-readable):
```
2026-10-28-plan-index-generator  Generate PLANS.md     in_progress
2026-10-20-frontmatter-schema    Frontmatter schema     done
```

**JSON output**: array of objects with fields `id`, `title`, `stored_status`, `effective_status`, `depends_on`, `specs`, `archived`; with `--live`, also the activity fields defined in `architecture/reference-cli` § Plan activity.

Reports include the resolved integration target and, for started plans, the exact starting commit; an optional comparison baseline is displayed separately. `--json` adds `target_branch`, `start_base` (null before start), and `comparison_base` (null when absent). Missing or conflicting target information is reported, never replaced silently with the repository default.

### `specplane plan show <id>`

Prints the PLAN.md for the given plan, together with its resolved/recorded target, starting commit when available, and optional comparison baseline. A plan absent from the current checkout can be discovered through its local or fetched remote plan branch; ambiguous identity or conflicting execution metadata refuses rather than selecting a candidate by guesswork.

### `specplane plan graph`

Prints the Mermaid dependency graph to stdout (the same graph that appears in PLANS.md).

### `specplane plan start <id>`

Executes the start flow for a plan. See `feature/plan-execution`. When resuming a stacked plan whose base plan has since merged, prints 'Base plan `<base-id>` has merged; run `specplane plan restack <id>`.' and continues; resume never rewrites history.

**Options**:
- `--target <branch>`: select the integration target for first start; must agree with a target declared in the plan. On resume it must match the recorded target. Omission uses the recorded target, or for first start the plan setting, team setting, then repository default.
- `--no-fetch`: do not fetch from the remote before starting; work from the local refs as they are.

### `specplane plan shelve <id>`

Pauses a started plan as `shelved`, preserving its branch, worktree (including uncommitted work), plan records, and step progress. Does not archive or delete anything. Refuses for unstarted, draft, already-shelved or terminal plans, or while a worker is active. See `feature/plan-execution` § Shelving and resuming a plan.

### `specplane plan resume <id>`

Resumes a shelved plan by restoring its prior stored status and reporting the resulting effective status, checkout and next step. Refuses if the plan is not shelved or its retained branch is missing. Does not execute a step or launch a session. `plan start` does not implicitly resume shelved plans.

Both commands exit 0 on completed transition and 1 on refusal or failure. They print the plan ID and resulting status. A repeated invocation refuses without changes; a partially recorded transaction reports recovery information instead of treating a retry as a new transition.

### `specplane plan retarget <id> --target <branch>`

Explicitly reconcile a managed plan's current destination as defined in `feature/plan-execution`. Preserve original start and comparison context. Support `--dry-run` and `--json`. A successful operation reports old/new destinations and changed records; it does not rebase, merge, push or change a PR base. Unresolved identity, lifecycle or dependency conflicts fail before writes.

### `specplane plan finish <id>`

Executes the finish flow for a plan. See `feature/plan-execution`.

**Options**:
- `--no-fetch`: do not fetch from the remote during the flow; work from the local refs as they are. Pushes and pull requests are not affected.

### `specplane plan restack <id>`

Restacks a stacked plan: replays only the plan's own commits onto the new base. See `feature/plan-execution` § Restacking. When the base plan has merged, the new base is the integration target and the plan is no longer stacked afterwards; when the base plan's branch has been rewritten, the new base is that branch's new tip. Conflicts stop the command and are surfaced to the human; they are never resolved automatically.

**Options**:
- `--dry-run`: print the base the plan would be replayed onto and the commits that would be replayed; change nothing.

**Exit codes**:
- `0`: the plan was restacked (or was already up to date).
- `1`: any error.

**Error cases**:
- No plan with that ID → exit 1, "Plan `<id>` not found."
- The plan is not stacked → exit 1, "Cannot restack: `<id>` is not stacked."
- Conflicts while replaying → exit 1, with the conflicting files listed and the checkout left mid-rebase for the human to resolve.

### `specplane plan abandon <id>`

Abandons a plan. See `feature/plan-execution` § Abandoning a plan.

**Options**:
- `--delete-branch`: also delete branch `plan/<id>` (kept by default).
- `--force`: remove the worktree even if it has uncommitted changes.

### `specplane plan cleanup <id>`

Removes the worktree and deletes branch `plan/<id>` after the plan has merged (finish flow step 7). Refuses to delete the branch unless the plan is `done` on the integration target. Idempotent.

**Options**:
- `--force`: remove the worktree even if it has uncommitted changes.

### `specplane plan archive <id>`

Moves a `done` or `abandoned` plan's folder into `<plans.dir>/archive/` — for plans that ended while `plans.archive_done` was `false`. Errors if the plan is not `done` or `abandoned`, or is already archived. Does not touch branches or worktrees. `archived` is a location flag, not a plan status; shelved plans cannot be archived.

### `specplane plan approve <id>...`

Approves each plan in the order given: sets `status: ready` and commits the change (subject `docs(<plan-id>): approve plan`, trailer `Specplane-Workflow: approve`). An agent runs this command only when the user asks for it.

**Error cases** (each refuses that plan, exits 1, and stops; plans approved earlier in the same run stay approved):
- No plan with that ID → "Plan `<id>` not found."
- The plan is not `draft` → "Plan `<id>` is `<status>`; only `draft` plans can be approved."
- The plan folder has uncommitted changes → "Commit or stash changes to `<path>` first."
- A spec the plan names is not approved as `plans.require_approved_specs` requires → "Cannot approve `<id>`: `<spec-id>` is `<status>`, not `approved`."
- Validation reports errors for the plan → the errors are listed.

---

## `specplane decision`

Subcommands for decision records (see `feature/decisions`).

### `specplane decision new <title>`

Creates `<decisions.dir>/<NNNN>-<slug>.md` with the next free number, `status: proposed`, and the body sections from `feature/decisions#adr-body-structure`. The slug is derived from the title.

**Output**: the path of the created file.

**Error cases**:
- A file with that number and slug already exists → exit 1, "Decision `<path>` already exists."

### `specplane decision accept <id>...`

Accepts each ADR in the order given: sets `status: accepted` and commits the change (subject `docs(decisions): accept <id>`, trailer `Specplane-Workflow: approve`). An agent runs this command only when the user asks for it.

**Error cases** (each refuses that ADR, exits 1, and stops; ADRs accepted earlier in the same run stay accepted):
- Unknown ADR ID → "Decision `<id>` not found."
- The ADR is not `proposed` → "Decision `<id>` is `<status>`; only `proposed` decisions can be accepted."
- The ADR file has uncommitted changes → "Commit or stash changes to `<path>` first."
- Validation reports errors for the ADR → the errors are listed.

---

## `specplane search <text>`

Full-text search over spec and plan files, plus frontmatter filtering.

**Arguments**: `<text>` — text to search for.

**Options**:
- `--kind spec|plan`: restrict to spec files or plan files
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
- PLANS.md freshness (warning if it differs from what `specplane plan index` would write).
- Standing-instructions freshness (warning if the Specplane standing instructions are missing, malformed, or older than the installed Specplane; see `feature/agent-integration`).

**Options**:
- `--json`

**Exit codes**:
- `0`: valid (no errors)
- `1`: one or more errors

---

## `specplane plan index`

Rebuilds only the plans index `PLANS.md`, including its dependency graph (see `feature/plan-index`). The same selected inputs produce identical non-live output. This command replaces `specplane generate`; the old name is removed without an alias and reports migration guidance.

**Output**: `<plans.dir>/PLANS.md` is written (or updated).

**Options**:
- `--source head|staged|working`: select plan/config inputs; default `head`. Head reads the currently checked-out commit, including detached HEAD. Staged reads the proposed next commit, including staged additions/deletions but excluding unstaged changes. Working reads current files, including tracked edits and new non-ignored plans; ignored untracked files are excluded, while tracked files remain included even if an ignore pattern matches. Report the selected source and excluded pending changes. Sources never switch implicitly.
- `--print`: print the generated content to stdout instead of writing the file.
- `--live`: use live effective statuses (git branches and pull requests) instead of index statuses. Only allowed with `--print`, so the committed file never contains live state; `--live` alone exits 1 with "`--live` requires `--print`."

An unborn HEAD refuses the default source with guidance to select staged or working explicitly. Unknown sources and unresolved selected plan/config inputs fail before writes. Config and plan discovery use the same selected source. The command writes only the generated index; it never stages, commits, approves or changes plan records. During merge, rebase or cherry-pick conflict recovery, resolve and stage the source records, run `specplane plan index --source staged`, then stage the generated output and continue. Default/head generation refuses to overwrite a conflicted index during recovery and names the staged command.

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

### Scenario 7: Approving a base spec and its overlay in one command

Given `feature/spec-policies` and its overlay `claude:feature/claude-integration` are both `review` and committed,
When `specplane spec approve feature/spec-policies claude:feature/claude-integration` is run,
Then two commits are made: the first approves `feature/spec-policies`; the second re-pins the overlay's base and approves it.

### Scenario 8: Approval refused

Given `architecture/search` implements `feature/search`, which is `review`,
When `specplane spec approve architecture/search` is run,
Then exit code is 1, stderr contains "Cannot approve `architecture/search`: `feature/search` is `review`, not `approved`.", and nothing is committed.

### Scenario 9: Reopening a spec reports the cascade

Given `feature/configuration` is `approved` and `architecture/reference-cli` (approved) implements it,
When `specplane spec reopen feature/configuration` is run,
Then `feature/configuration` is committed as `review`,
And the output lists `architecture/reference-cli` with the command to reopen it, which is left unchanged.

### Scenario 10: Creating a decision record

Given `decision/0003` is the highest-numbered ADR,
When `specplane decision new "Cache policy"` is run,
Then `<decisions.dir>/0004-cache-policy.md` is created with `id: decision/0004` and `status: proposed`.

---

## Edge cases

- Running any `specplane` command outside a git repository exits with code 1 and the message "Not in a git repository."
- `specplane spec new` with a slug containing uppercase letters normalises it to lowercase.
- `specplane plan start` run twice on the same plan (branch already exists) resumes the plan rather than failing.
- Commands behave the same in the main checkout and in a plan worktree; paths derived from `execution.worktree_dir` always resolve against the main checkout (see `feature/configuration`).
- `--dry-run` is not supported for `plan index` (it only reads and writes one file; `--print` is the equivalent).

## Implementation completion commands and reporting

### `specplane spec complete <id>`

Record `implementation.status: complete` and the assessed fingerprint of the current working-tree definition and its declared requirement dependencies. This is an explicit declaration, not a test runner or proof of correctness. Repeating the command after a definition change acknowledges the new definition. It does not change review status, create a plan, commit, push, or merge. It works on any branch and with uncommitted spec edits. Validate inputs and resolve dependencies before writing; on failure preserve prior metadata and unrelated edits. Support `--dry-run` and `--json`.

### `specplane spec implementation <id> --status incomplete|partial|complete`

Set implementation status without requiring a plan. `complete` has the same semantics as `spec complete`. Incomplete and partial do not record a current complete assessment; any retained historical assessment is labelled historical. Manual edits to the same fields are valid. No command infers test results or approval from the status value.

Spec list/show and spec/repository validation report stored implementation status and derived assessment separately, including dependency reasons. JSON includes `implementation_status` (null when absent), `assessment_status`, and `assessment_reasons`. Reassessment and unverifiable findings are warnings by default; they do not make validation fail solely because an assessment is stale. Format errors remain errors. Command JSON receipts identify the spec, the declaration, the fingerprint and changed file; they never report checks that were not run.

## `specplane docs [<topic>]`

Read bundled Specplane documentation; without a topic show the orientation and topic index. This command works offline, outside a repository, and without configuration. It does not initialize or mutate a repository. Documentation describes the installed core release; project specification lookup remains `spec show` and `search`.

Stable initial topic IDs: `getting-started`, `concepts`, `completion`, `workflows/plans`, and `commands/spec-complete`. Cross-references resolve within the bundled documentation. Unknown topics return exit 1 with discovery guidance. Successful lookup returns exit 0.

### `specplane docs search <text>`

Search bundled documentation, returning matching topic IDs and excerpts. No matches returns exit 0 with an empty result. Empty queries fail with exit 1. Search is separate from repository search and requires no embeddings, network service or account.

Both documentation commands support `--json`. A topic result includes topic ID, title, release version, documentation version, source references, related topic IDs and content. Index/search output contains a versioned envelope and ordered items. Harness documentation commands call the same documentation operation in their compatible bundled core and identify that core's version; they may add host invocation details without changing shared semantics. Documentation does not imply host capabilities absent from the active integration.

Acceptance: a fresh user outside Git reads orientation and completion guidance offline; CLI and a harness using the same core return the same topic content; unknown topics fail without writes; searching docs never returns project requirements as though they were product documentation.
