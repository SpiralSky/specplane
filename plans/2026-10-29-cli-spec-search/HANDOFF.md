# HANDOFF — 2026-10-29-cli-spec-search

## Step 01: Architecture spec edits for the command surface and conventions

**Date**: 2026-10-29
**Outcome**: done

### What changed

- `architecture/reference-cli`: new section "Spec, search, and init commands" (spec new/list/show/validate, search, init: module, inputs, output, exit codes, init report lines and idempotence); `AlreadyExistsError` row; error texts aligned to `feature/tooling` (trailing full stops, `PlanStateError` uses the `feature/plan-execution` texts); message-pattern and stderr/stdout note; `DEFAULT_CONFIG` literal-copy rule with test requirement; leak guard gains "JSON Schema" and a bare-file-name heuristic (new heuristic 4, schema syntax now 5); spec validation rule 10 (deprecated `implements`/`extends` references warn, type `reference`).
- `architecture/file-formats` §1.1: ID pattern now `^(feature|architecture)/[a-z0-9](?:[a-z0-9-]|/(?!/))*[a-z0-9]$` with prose and valid/invalid examples.
- Step file ticked and set to done.

### Deviations from the plan

- CHOICE: `spec new` without a TTY defaults the title to the de-slugged slug instead of failing.
- CHOICE: bare-file-name rule covers a fixed extension list and excludes `.md` names, allow-listed Specplane names, and link text/targets.
- CHOICE: `search` is case-insensitive literal substring, max 3 snippets per file, `--root` implies `--type spec`, archived plans included.
- CHOICE: deprecated-reference warning uses type `reference`.
- Pins: `specplane spec pin --check` reported all current after the edit (no overlay or skill pins the edited sections), so no refresh was needed.

### Gaps found in specs

None. (Feature text for `PlanStateError` start/finish failures was adopted verbatim; the architecture was corrected.)

### Open issues

- The restack trigger, harness registry, and plan activity `where` field findings belong to later plans.

### What the next step must know

Step 02: write the feature-spec proposals file.

## Step 02: Feature-spec proposals for tooling, decisions, configuration, precedence

**Date**: 2026-10-29
**Outcome**: done

### What changed

- Added `plans/2026-10-29-cli-spec-search/feature-spec-proposals.md`: proposals (a1) `--no-fetch` on `plan list --live`, `plan start`, `plan finish`; (a2) `--type` difference between `spec list` and `search`; (b) ADR id/filename mismatch and `superseded_by` missing/unknown/cycle validation; (c) `worktree_dir` inside the repo and `spec_roots` missing/escaping errors; (d) numbered Rule 6 for "both silent". Each has target, current text, proposed text, reason.
- No feature spec modified.

### Deviations from the plan

- CHOICE: "both silent" proposed as Rule 6 (appended) so Rules 1-5 references stay valid.
- CHOICE: `--type` difference proposed as documentation, with `--kind` rename as an alternative.
- CHOICE: proposed severities and message texts are suggestions, marked "Needs decision" where they add behaviour.

### Gaps found in specs

None.

### Open issues

- Feature-spec proposals need user review (needs user review); nothing applied.

### What the next step must know

`feature-spec-proposals.md` needs user review before any feature spec is edited; later steps must not depend on the proposed text being applied.
