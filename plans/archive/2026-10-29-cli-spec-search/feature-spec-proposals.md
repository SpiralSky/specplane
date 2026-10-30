# Feature-spec proposals — 2026-10-29-cli-spec-search

**Applied 2026-10-29** (user-approved, pasted verbatim): (a1); (a2) as the `--kind` rename; (b) with the proposed severities; (c); (d) with a user change: records go to a per-plan `spec-gaps.md` instead of HANDOFF.md.

This file is the applied proposal record: these edits are in the approved feature specs. The sections below are kept for traceability, not as pending suggestions.

## (a) `feature/tooling`: `--no-fetch` and the two `--type` options

### (a1) `--no-fetch` missing on fetching commands

**Target**: `feature/tooling`, `### specplane plan list [--status <status>]` (options), `### specplane plan start <id>`, `### specplane plan finish <id>`.

**Problem**: `plan list --live` documents `--no-fetch` in the `--live` description only, not as an option. `plan start` and `plan finish` fetch from the remote (see `architecture/reference-cli`: start flow runs `git fetch origin <default>`, "skipped when there is no remote") but list no options, so the user cannot suppress the fetch.

**Current text** (`plan start`): "Executes the start flow for a plan. See `feature/plan-execution`." (`plan finish` is the same with "finish".)

**Proposed text**:

In `plan list` options, add after `--live`:
> - `--no-fetch`: with `--live`, do not fetch from the remote; use the remote-tracking refs as they are. Has no effect without `--live`.

Replace the `plan start` body with:
> Executes the start flow for a plan. See `feature/plan-execution`.
>
> **Options**:
> - `--no-fetch`: do not fetch from the remote before starting; work from the local refs as they are.

Replace the `plan finish` body with:
> Executes the finish flow for a plan. See `feature/plan-execution`.
>
> **Options**:
> - `--no-fetch`: do not fetch from the remote during the flow; work from the local refs as they are.

**Reason**: Offline use and speed; the option already exists for `--live` and the same need applies to every command that touches the network. **Needs decision**: whether `plan finish` should honour `--no-fetch` for the push/PR steps too (proposed: it suppresses fetches only, not pushes).

### (a2) Two different `--type` options

**Target**: `feature/tooling`, `### specplane spec list` and `## specplane search <text>`.

**Problem**: `spec list --type feature|architecture` filters by spec type; `search --type spec|plan` filters by kind of file. Same flag name, different value sets, and `search --type feature` is an error a user would reasonably try.

**Current text**: `spec list`: "`--type feature|architecture`: filter by type". `search`: "`--type spec|plan`: restrict to spec or plan files".

**Proposed text** (document the difference, keep the flag names):

`search`:
> - `--type spec|plan`: restrict to spec files or plan files. Unlike `spec list --type` (which takes `feature|architecture`), this selects the kind of file searched. To restrict to feature or architecture specs, search with `--type spec` and filter on the `id` prefix.

Alternative if the user prefers distinct names: rename the `search` option to `--kind spec|plan` and keep `--type` only for `spec list`. This changes the CLI surface and `architecture/reference-cli`.

**Reason**: Removes a likely user error without a breaking change. **Needs decision**: document-only (proposed) versus rename to `--kind`.

## (b) `feature/decisions`: ADR validation cases

**Target**: `feature/decisions`, `## ADR frontmatter` (add a validation list after the field table) and `## Acceptance scenarios` (new scenarios 6 and 7).

**Problem**: Validation covers duplicate numbers and unknown `related_specs`, but not: an `id` that disagrees with the filename's number, or a `superseded_by` that is missing, unknown, or cyclic.

**Current text**: "Each file is named `<NNNN>-<slug>.md`, where `NNNN` is the ADR's number." and the field table entry "`superseded_by` | string | no | ID of the ADR that replaces this one, if any."

**Proposed text** (new subsection after the field table):
> ### Frontmatter validation
>
> - The `id` must equal `decision/<NNNN>` where `<NNNN>` is the number in the filename. A mismatch is an error: "ADR file `0003-cache-policy.md` has id `decision/0004`; the id number must match the filename."
> - An ADR with `status: superseded` must have a `superseded_by` that names an existing ADR. A missing value is an error: "ADR `decision/0002` is superseded but has no `superseded_by`." An unknown target is an error: "ADR `decision/0002` is superseded by unknown ADR `decision/0009`."
> - `superseded_by` on an ADR whose status is not `superseded` is a warning: "ADR `decision/0002` has `superseded_by` but status `accepted`."
> - A chain of `superseded_by` links that returns to an ADR already in the chain (including an ADR superseded by itself) is an error: "Supersession cycle: `decision/0002` -> `decision/0005` -> `decision/0002`."

New scenarios:
> ### Scenario 6: ID does not match filename
> Given `0003-cache-policy.md` has `id: decision/0004`,
> When `specplane validate` runs,
> Then an error is reported: "ADR file `0003-cache-policy.md` has id `decision/0004`; the id number must match the filename."
>
> ### Scenario 7: Supersession cycle
> Given `decision/0002` has `superseded_by: decision/0005` and `decision/0005` has `superseded_by: decision/0002`,
> When `specplane validate` runs,
> Then an error is reported: "Supersession cycle: `decision/0002` -> `decision/0005` -> `decision/0002`."

**Reason**: These are deterministic, cheap checks that protect the "never deleted, only superseded" history; `architecture/file-formats` §ADR rules would then gain matching checks. **Needs decision**: severities (above) and the exact message texts.

## (c) `feature/configuration`: path validation errors

**Target**: `feature/configuration`, `### spec_roots` (error sentence), `### execution.worktree_dir`, and `## Acceptance scenarios` (new scenarios 6-8).

**Problem**: `worktree_dir` "must be outside the repository" and `spec_roots` paths are "relative to the repository root", but no error is specified when a `worktree_dir` resolves inside the repository, or when a `spec_roots` path does not exist or escapes the repository (for example `../other`).

**Current text**: "`execution.worktree_dir` may be an absolute path. It must not be inside the main checkout." and "Two roots with the same `name` are a validation error. A root that `extends` an undeclared root, or a cycle of `extends` links, is a validation error."

**Proposed text** (`spec_roots`, append):
> A root whose `path` does not exist or is not a directory is a validation error. A root whose `path` resolves outside the repository root (an absolute path, or one containing `..` that leaves the repository) is a validation error.

(`execution.worktree_dir`, append):
> A `worktree_dir` that resolves inside the main checkout is a hard error when the worktree backend is used.

New scenarios:
> ### Scenario 6: Worktree directory inside the repository
> Given `execution.worktree_dir: .worktrees` and `execution.backend: worktree`,
> When Specplane reads the config,
> Then a hard error is reported: "`execution.worktree_dir` must be outside the repository. `.worktrees` resolves to `<path>` inside it."
>
> ### Scenario 7: Spec root does not exist
> Given `spec_roots` contains `{name: docs, path: docs/missing}` and that directory does not exist,
> When Specplane validates,
> Then an error is reported: "Spec root `docs`: path `docs/missing` does not exist."
>
> ### Scenario 8: Spec root escapes the repository
> Given `spec_roots` contains `{name: shared, path: ../shared-specs}`,
> When Specplane reads the config,
> Then an error is reported: "Spec root `shared`: path `../shared-specs` is outside the repository."

**Reason**: Without these the failure surfaces later as a confusing git or file error. **Needs decision**: whether a missing root is an error or a warning (a fresh `specplane init` may precede creating the directory; proposed: error at `validate`, not at config read), and whether a config-read error for `worktree_dir` should apply when `backend` is not `worktree` (proposed: no, matching "Only used when `execution.backend: worktree`").

## (d) `feature/spec-precedence`: a numbered rule for "both silent"

**Target**: `feature/spec-precedence`, new `### Rule 4` inserted before the contradiction rule, with renumbering, or appended as a Rule 6 to avoid renumbering (proposed: Rule 6, so existing references to Rules 1-5 stay valid).

**Problem**: The summary table row "Both specs silent | Make a reasonable default; record the assumption in HANDOFF.md" and Scenario 5 describe the case, but no numbered rule defines it, while the other rows map to Rules 1-5. Rule 3 only covers gaps filled from the feature spec.

**Current text** (table): "| Both specs silent | Make a reasonable default; record the assumption in HANDOFF.md |"

**Proposed text** (new section after Rule 5):
> ### Rule 6: Cases neither spec covers
>
> When neither the architecture spec nor the feature spec addresses a case, the implementer chooses the most reasonable default and proceeds; this is not blocking. The choice must be recorded in the step's `HANDOFF.md` as an assumption, naming the case, the default chosen, and the spec the case should be added to. If the choice is user-visible and cannot be undone without data loss, an attended implementer asks the human first; an unattended implementer picks the least destructive option and records it.

And in the summary table, change the row to:
> | Both specs silent | Rule 6: make a reasonable default; record the assumption in HANDOFF.md |

**Reason**: Gives the case a citable rule parallel to Rules 3 and 4, and states the attended/unattended behaviour that Rule 4 states for contradictions. **Needs decision**: the "irreversible user-visible choice" clause is new behaviour; drop it to keep the rule identical to the current table.
