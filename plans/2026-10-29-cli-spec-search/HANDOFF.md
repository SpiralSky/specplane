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
