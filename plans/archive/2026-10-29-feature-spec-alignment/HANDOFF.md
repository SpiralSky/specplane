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

## Step 04: spec-gaps.md parsing, validation, and finish-flow listing

**Date**: 2026-10-29
**Outcome**: done

### What changed

- New `packages/cli/src/plan/gaps.ts`: `parseGaps(file)` returns `{ entries, problems }` for `spec-gaps.md` per `architecture/file-formats` §4.2 (`GapEntry` with `{ n, caseTitle, kind, step, case, resolution, targets, status, line }`), plus `formatOpenGaps` for the finish listing.
- `packages/cli/src/plan/validate.ts`: the HANDOFF check now compares only the latest `## Step NN` section's `**Outcome**` with the step status for every step that has a section (repeated sections for re-run `blocked` steps are accepted); the no-section error remains for `skipped`/`blocked`. Every `<plan dir>/spec-gaps.md` is validated: heading, field order/presence, `Kind`, `Status`, ascending unique `G<n>`, `Step` being a step of the plan, and unresolved `Target spec` IDs as warnings. A `feature-spec-proposals.md` is not read.
- `packages/cli/src/plan/flows.ts`: the finish flow lists open entries before merging as `G<n> (<kind>, <target specs>): <case>` under "Open spec gaps:"; they never stop the flow and the heading is omitted when there are none.
- Tests: repeated HANDOFF sections (latest wins, earlier `blocked` accepted), valid/invalid `spec-gaps.md` (heading, missing fields, kind, status, step, target, ordering), an archived plan with only `feature-spec-proposals.md`, and the finish listing.

### Deviations from the plan

- Acceptance criterion 5 (`npm test` passes) is not ticked: 227/228 pass; the only failure is the pre-existing stale pins on `claude:architecture/claude-integration`, deferred to step 05 since step 01.
- `parseGaps` returns findings alongside entries instead of only `GapEntry[]`, so `validate` can report every problem rather than throwing on the first.

### Gaps found in specs

None. The §4.2 texts cover the new checks; the two messages the spec leaves open (invalid `Kind`/`Status`, non-numeric `Step`) follow the same `spec-gaps.md: G<n> ...` pattern.

### Open issues

None.

### What the next step must know

- Step 05 edits `architecture/agent-skills` and `claude:architecture/claude-integration`, both in `review`: it must re-pin `claude:architecture/claude-integration` (the stale pins deferred since step 01) and sync `.claude/`. `spec pin --check` is expected to go green there.
- Skills and standing instructions must write `spec-gaps.md` entries (`## G<n>: <case>` with the six fields) and must stop mentioning `feature-spec-proposals.md` as the current format.

## Step 05: Skills and standing instructions record spec-gaps.md entries

**Date**: 2026-10-29
**Outcome**: done

### What changed

- `docs/specifications/architecture/agent-skills.md`: `plan-step` step 5 now requires a numbered `spec-gaps.md` entry for every gap, assumption, or proposed spec edit (six §4.2 fields, status `open`, no number reuse; `proposal` replaces `feature-spec-proposals.md`), step 8 lists the added IDs in HANDOFF.md, and the output names them; `plan-finish` step 3/4 reports the open entries the CLI lists and says they do not block. The standing-instructions text (Precedence and Plans bullets) points at `spec-gaps.md`.
- `harnesses/claude/specifications/architecture/claude-integration.md`: records that the two plan skills write/read the same harness-neutral gap record and never create `feature-spec-proposals.md`; per-skill table updated.
- `harnesses/claude/templates/skills/plan-step/SKILL.md`, `plan-finish/SKILL.md`: same rules in the Claude wording.
- `harnesses/claude/templates/rules/specplane.md`, `packages/cli/src/agents/standing.ts`, the repo's `AGENTS.md` managed block, and `.claude/rules/specplane.md`: standing text now says to record gaps as `spec-gaps.md` entries and calls HANDOFF.md plus `spec-gaps.md` the source of truth.
- All six skill contract markers moved from `@9b59fd0` to the new `architecture/agent-skills` blob `@a8e55f4`; `specplane spec pin claude:architecture/claude-integration` re-pinned `claude:feature/claude-integration` (`d3406ae`) and `feature/agent-integration` (`9e3a0cf`).
- `.claude/skills/` and `.claude/rules/specplane.md` re-synced from the templates.

### Deviations from the plan

- None. The standing text changed without a version bump: `checkStanding` compares the text, not only `vN`, and `validate` reports `AGENTS.md` as OK.

### Gaps found in specs

None.

### Open issues

None. `specplane validate` has 0 errors (22 warnings: the pre-existing leak-guard findings and the out-of-date `PLANS.md`); `spec pin --check` is now clean, closing the failure deferred since step 01.

### What the next step must know

- Step 06 covers README/help text and the final checks. `plans/PLANS.md` must be regenerated (`specplane generate`) as part of the final check; it is the only validation warning that is a real to-do.
- The `spec-gaps.md` list of this plan has G1–G4; step 06 should not need new entries.

## Step 06: Docs and final check

**Date**: 2026-10-29
**Outcome**: done

### What changed

- `README.md`: plan folders list `spec-gaps.md`; a gap-records bullet explains `gap`/`assumption`/`proposal` entries and that finish lists open ones; Node.js 22+; CLI table now shows `--no-fetch`, `--kind spec|plan`, and `restack --dry-run`.
- `packages/cli/README.md`: Node.js 22+, Apache-2.0 licence link, quick-start examples for `search --kind` and `restack --dry-run`, and a note that plans keep `spec-gaps.md` next to `HANDOFF.md`.
- `packages/cli/src/cli.ts`: `plan finish` help says it lists open `spec-gaps.md` entries.
- `plans/PLANS.md` regenerated (it now shows this plan as `in_progress` with the stack-mode status rules).

### Deviations from the plan

- None beyond doc accuracy fixes found while updating the README (Node version and licence were stale from earlier decisions).

### Gaps found in specs

None new. This plan's `spec-gaps.md` still has four open entries, listed under "Open issues".

### Open issues

Open `spec-gaps.md` entries for human review (they do not block the finish flow):

- G1 (assumption): no message text for a spec root path that is not a directory.
- G2 (assumption): `init` opts out of the missing-spec-root check so it can scaffold a clean repository.
- G3 (assumption): cross-field config errors use the feature texts verbatim; `ConfigError` accepts a `null` key.
- G4 (gap): no CLI route deletes the branch of an already-abandoned plan.

### What the next step must know

- All six steps are done and every check is green: `npm test` 228/228, `check-sync.sh` OK, `hooks.test.sh` 62/62, `specplane validate` 0 errors (21 warnings: reviewed leak-guard hits), `specplane spec pin --check` clean.
- Run `specplane plan finish 2026-10-29-feature-spec-alignment` next. After it merges, plan `2026-10-29-assist-and-approve` (currently `draft`, depends on this plan) needs its `status` set to `ready` by the user before it can start.

## Step 06: Docs and final check (gap dispositions)

**Date**: 2026-10-29
**Outcome**: done

### What changed

- Resolved the four `spec-gaps.md` entries after human review. G1, G2, and G3 are `applied`; G4 is `rejected`.
- `architecture/reference-cli` § Config loading now records that `init` loads the config with `checkSpecRoots: false`, so it can scaffold a clean repository (G2).
- `architecture/reference-cli` § Error classes now records that a `ConfigError` with a `null` key uses the reason as the whole message for cross-field rules whose text `feature/configuration` fixes verbatim (G3).
- G1 needed no further edit: `architecture/reference-cli` already defines "Spec root `<name>`: path `<path>` is not a directory." for the feature scenario that left the text open.
- G4 is declined: no CLI route is added for the branch or worktree of an already-abandoned plan. `feature/plan-execution` deliberately keeps `plan/<id>` after abandon and `plan cleanup` only deletes a `done` plan's branch; the documented route is `git branch -D` (and `--force` on the first abandon for the worktree). Removing that branch is a manual git operation.

### Deviations from the plan

None.

### Gaps found in specs

None new. No entry is left `open`.

### Open issues

- None blocking. G4 is an accepted limitation with a manual workaround.

### What the next step must know

- `spec-gaps.md` has no open entries, so the finish flow will not print an "Open spec gaps" notice.
- Run `specplane plan finish 2026-10-29-feature-spec-alignment` next (the CLI in this worktree, not the stale global install).
