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

## Step 03: Error classes, stderr convention, DEFAULT_CONFIG, ID pattern

**Date**: 2026-10-29
**Outcome**: done

### What changed

- `errors.ts`: `AlreadyExistsError(kind, id)` (exit 1, spec/plan texts from the architecture table) and `reportError()` helper; `cli.ts` wraps `parse` and routes `SpecplaneError` to stderr with the class exit code.
- `validate` human report now goes to stderr; `--json` stays on stdout.
- `ID_PATTERN` constant in `schemas.ts` (file-formats §1.1 pattern) shared by the JSON Schema, `spec/resolve.ts`, and the body-anchor regex in `spec/validate.ts`.
- Tests: DEFAULT_CONFIG vs the yaml block parsed from `feature/configuration` (`config.test.ts`), ID edge cases and qualified IDs (`id-pattern.test.ts`), `AlreadyExistsError` (`errors.test.ts`).
- `npm test` 105/105; validate on this repo: 0 errors.

### Deviations from the plan

- CHOICE: `claude:feature/x` is accepted by the resolver (root prefix split before the ID check), not by the raw ID pattern, which covers unqualified IDs only.
- CHOICE: `AlreadyExistsError` takes `("Spec" | "Plan", id)` to select the message.
- CHOICE: existing commands keep their local catch blocks; the top-level handler is a fallback for errors they do not catch.

### Gaps found in specs

None. `DEFAULT_CONFIG` already matched the table; the test now enforces it.

### Open issues

None.

### What the next step must know

Use `reportError` and `AlreadyExistsError` in new commands; human reports go to stderr, data to stdout.

## Step 04: Leak-guard heuristics and deprecated-reference warnings

**Date**: 2026-10-29
**Outcome**: done

### What changed

- `spec/leak-guard.ts`: "JSON Schema" added to the tech-name list; bare-file-name heuristic (`path` type) with exclusions for code fences, link text and targets, allow-list, `.md` names, tech names (for example Next.js), and matches already inside a heuristic 1 path.
- `spec/validate.ts`: `implements`/`extends` entries resolving to a `deprecated` spec warn (type `reference`, "`<id>` references deprecated spec `<ref>`.").
- Tests added in `leak-guard.test.ts` and `validate.test.ts`; `npm test` 110/110.
- `specplane validate` on this repo: exit 0, 0 errors; 62 warnings against 60 before, so 2 new.

### Deviations from the plan

- CHOICE: `Node.js` is not in the built-in allow list (the spec limits it to Specplane names); it is covered by a project `leak_guard_allow` entry, otherwise it warns as a bare `.js` name.
- CHOICE: the deprecated message follows `architecture/reference-cli` rule 10, since `file-formats` §1.5 defines no such row.

### Gaps found in specs

`file-formats` §1.5 does not list the deprecated-reference finding; rule 10 of `reference-cli` is the only definition.

### Open issues

- Feature-spec proposal for the user: `feature/spec-policies` lines 180 and 182 mention "JSON Schema" (2 new `tech_name` warnings); reword or add to `leak_guard_allow`. No feature spec was edited.

### What the next step must know

Validate output now has 62 warnings on this repo; none of the new ones are errors.
