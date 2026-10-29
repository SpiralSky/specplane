# HANDOFF — 2026-10-29-feature-spec-alignment

## Step 01: Architecture spec edits for reference-cli and file-formats

**Date**: 2026-10-29
**Outcome**: done

### What changed

- `docs/specifications/architecture/file-formats.md`: §3.2 and §4.1 make the latest HANDOFF section per step authoritative (repeated sections for re-run `blocked` steps); new §4.2 `spec-gaps.md` format (entry heading `## G<n>: <case>`, six fields, kinds, statuses, unique never-reused numbers, `feature-spec-proposals.md` left unvalidated); §6.2 ADR rules with the `feature/decisions` texts (id/filename, missing or unknown `superseded_by`, `superseded_by` warning on a non-superseded ADR, cycles).
- `docs/specifications/architecture/reference-cli.md`: config spec root path checks and the `worktree_dir` message (worktree backend only); ADR checks and cycle reporting; `plan/gaps.ts` (`parseGaps`, validation messages); latest-section HANDOFF check; stack-mode `blocked` in `getIndexStatus` plus `blockedReason`; abandon from `done`/`abandoned` fails; `--no-fetch` on start and finish; finish flow lists open `spec-gaps.md` entries; restack output, errors, and `--dry-run` commit listing; `search --kind`.
- `plans/2026-10-29-feature-spec-alignment/spec-gaps.md`: created with G1.

### Deviations from the plan

Acceptance criterion 4 is not ticked: `specplane spec pin --check` exits 1, but only for `claude:architecture/claude-integration`'s stale pins on `claude:feature/claude-integration` and `feature/agent-integration`, which were stale on `main` before this plan started. No spec pins `file-formats` or `reference-cli`, and no skill contract marker names them, so this step had nothing to re-pin. Step 05 edits and re-pins `claude:architecture/claude-integration`. `specplane validate` passes (0 errors).

### Gaps found in specs

- G1 (assumption): no message text for a spec root path that is not a directory; used the Scenario 7 pattern. See `spec-gaps.md`.

### Open issues

None.

### What the next step must know

- Code changes now specified (steps 02–04): spec root path checks, `worktree_dir` message condition, ADR texts, `superseded_by` severity change to warning and cycle detection; stack-mode `blocked` in `plan/status.ts` and `blockedReason`; abandon guard; `--no-fetch` on `plan start`/`plan finish`; `search --kind` (rename from `--type`); `plan/gaps.ts`; latest-section HANDOFF check (current `handoffOutcomes` already returns outcomes per step in file order); finish-flow open-gaps listing; restack `--dry-run` commit lines.
- Behaviour change for restack: `restackPlan` currently aborts the rebase on conflict (`plan/flows.ts` ~line 619); `feature/tooling` and now `reference-cli` require leaving the checkout mid-rebase and listing the conflicting files. The finish flow still aborts.
- The stack-mode error text in code uses backticked IDs; the spec now says so.

## Step 02: Config path errors and ADR validation

**Date**: 2026-10-29
**Outcome**: done

### What changed

- `packages/cli/src/config.ts`: cross-field checks now emit the `feature/configuration` texts verbatim (duplicate root name, spec root outside/missing/not-a-directory, `worktree_dir`) and `worktree_dir` is only checked with the `worktree` backend. Spec roots are checked against the checkout root; `worktree_dir` against `mainRoot()`.
- `packages/cli/src/errors.ts`: `ConfigError` accepts a `null` key to use a whole-sentence message verbatim; schema violations keep the `Config key `<key>`` prefix.
- `packages/cli/src/commands/init.ts`: loads the config with `checkSpecRoots: false`, so `init` still scaffolds a clean repository.
- `packages/cli/src/decisions/validate.ts`: the §6.2 texts of `feature/decisions` (ID/filename, duplicate number, superseded rules, `superseded_by` warning on a non-superseded ADR, unknown target, `related_specs`), plus supersession-cycle detection that reports each cycle once from its lowest-numbered ADR.
- Tests: new `config.test.ts` cases and fixtures (`duplicate-root`, `root-missing`, `root-outside`, `root-not-dir`, `worktree-inside`, `worktree-branch`); ADR rules and a cycle scenario in `validate.test.ts`; a missing-spec-root config finding; an `init` test where the root does not exist yet.
- Test scaffolding: `makeRepo` creates the declared spec roots (or the default) unless called with `{ createSpecRoots: false }`; empty roots were previously invisible to git, so the activity clone tests now commit `specs/.gitkeep`. Existing config fixtures gained an empty `docs/specifications/`.

### Deviations from the plan

- Acceptance criterion 3 is not ticked: `npm test` is 219/220. The only failure is `spec pin --check exits 0 on the specs-framework repository`, the pre-existing stale pins on `claude:architecture/claude-integration` already deferred to step 05 in step 01. Everything else passes.
- Cross-field errors match the feature texts exactly instead of the generic `Config key` prefix (G2/G3), because `init` must run before the roots exist and the feature scenarios fix whole sentences.

### Gaps found in specs

- G2 (assumption): `init` opts out of the missing-spec-root check so it can scaffold a clean repository. See `spec-gaps.md`.
- G3 (assumption): `ConfigError` uses feature texts verbatim for cross-field rules; the `Config key` prefix stays for schema violations. See `spec-gaps.md`.

### Open issues

None in this step. The stale-pin integration failure remains, deferred to step 05.

### What the next step must know

- Spec root existence is now checked by every `loadConfig` caller, not only `validate`. New repositories/tests must have the root directories on disk; `makeRepo` handles it, and `init` is the only command that skips the check.
- `activity.test.ts` commits `specs/.gitkeep` because git cannot track an empty spec root; a fresh clone of a repository with an empty root would otherwise fail validation.
- ADR findings now carry the exact `feature/decisions` texts, and supersession cycles add one `adr` error per cycle (file = lowest-numbered ADR).
- Step 03 changes `plan/status.ts`, `plan/flows.ts`, `cli.ts`, and `commands/search.ts`; nothing in this step touches them.

## Step 03: Stack-mode blocked, abandon, --no-fetch, --kind, restack dry run

**Date**: 2026-10-29
**Outcome**: done

### What changed

- `packages/cli/src/plan/status.ts`: `getIndexStatus` blocks a `ready` plan in `stack` mode only when two or more dependencies are not `done`; new `blockedReason` returns "Cannot stack on more than one unmerged dependency: `<a>`, `<b>`." in stack mode and `null` in wait-for-merge mode.
- `packages/cli/src/commands/plan.ts`: `plan list` prints the `blockedReason` after a `blocked` status (`planList` returns a `blockedReasons` map; `--json` is unchanged); `plan restack --dry-run` prints one `<short sha> <subject>` line per commit that would be replayed.
- `packages/cli/src/plan/flows.ts`: `startPlan` and `finishPlan` take `fetch` (`--no-fetch`) and skip the `origin` fetch; `abandonPlan` fails for `done` **and** `abandoned` with "Cannot abandon plan: `<id>` is `<status>`." and no longer treats a re-run as cleanup; `restackPlan` returns the replay commit list and leaves a conflict mid-rebase; `finishPlan`'s rebase still aborts.
- `packages/cli/src/git/branch.ts`: `rebaseOnto` gains `onConflict: "abort" | "leave"` (default abort) and reports conflicting files.
- `packages/cli/src/errors.ts`: `RebaseConflictError` keeps its fixed first line and appends a "Conflicting files:" list.
- `packages/cli/src/commands/search.ts`, `cli.ts`: `search --type` renamed to `--kind` (error "Unknown kind ..."); the `SearchHit.type` JSON field is unchanged.
- Tests: stack-mode cases in `generate.test.ts` and `plan.test.ts` (index status, PLANS.md, human `plan list` reason), `abandon` re-run failure, `--no-fetch` on start and finish, restack dry-run commit listing, and the restack conflict now asserts the mid-rebase state.
- `plans/2026-10-29-feature-spec-alignment/spec-gaps.md`: added G4.

### Deviations from the plan

- Acceptance criterion 6 (`npm test` passes) is not ticked: 223/224 pass; the only failure is the pre-existing stale pins on `claude:architecture/claude-integration`, deferred to step 05 since step 01.
- Beyond the listed tasks, the restack conflict behaviour required by `architecture/reference-cli` § Restack (left mid-rebase with conflicting files listed, unlike finish) was implemented here because it lives in the same code path; the old lifecycle test asserted the abort behaviour and was updated.

### Gaps found in specs

- G4 (gap): no CLI route deletes the branch of an already-abandoned plan. See `spec-gaps.md`.

### Open issues

- `architecture/reference-cli` § `search` also describes grouped output (one block per file, at most 3 snippets) and a `{id, kind, path, root, status, matches}` JSON shape; the CLI still emits one hit per line with `type`. This is pre-existing drift from `2026-10-29-cli-spec-search`, outside this step's task list (rename only), so it is left for a later plan.

### What the next step must know

- Step 04 (`spec-gaps.md` in the CLI) has no code overlap with this step: it adds `plan/gaps.ts`, the latest-section HANDOFF check, and the finish-flow listing.
- Rebase behaviour split: `rebaseOnto(..., { onConflict: "leave" })` is used only by restack; finish relies on the default abort.
- `abandonPlan` no longer cleans up on a second run; any code that re-ran abandon for cleanup must use `git branch -D` (see G4).
