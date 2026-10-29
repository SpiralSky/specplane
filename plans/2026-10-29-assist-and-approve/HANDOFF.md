# HANDOFF — 2026-10-29-assist-and-approve

> **Standing user instruction (recorded 2026-10-29):** the agent decides open questions itself and verifies them at the plan merge (`/plan-finish`), rather than pausing for a decision mid-plan. After the last plan is done, the user will do a full review of the codebase and the workflow as a whole and make final amendments then; the general structure is to be treated as solid until that review. Record this note in every later HANDOFF.md as well.

## Step 01: Architecture spec edits for the review and assist roles and approval commands

**Date**: 2026-10-29
**Outcome**: done

### What changed

- `docs/specifications/architecture/agent-skills.md`: standing-instructions text now names `review`, describes refine-then-write `assist`, and states that `approved`/`ready`/`accepted` are set by the human, never by editing a file. `spec-assist` rewritten with a `review` mode (review-only) and an `assist` mode (Describe → Refine → Finalise → Write, `author: mixed`, status unchanged); `spec-draft-architecture` gained the same `assist` split. New contracts `approve`, `plan-start`, `decision-new`, `plan-status`, `plan-abandon`, each with Purpose / Policy check / Steps / Output.
- `docs/specifications/architecture/reference-cli.md`: new § Spec approval and decision commands covering `spec approve` (status, committed, `require_approved_features`, overlay re-pin in the same commit, one commit per id, stop at first refusal), `spec reopen` (report-only dependant list, not transitive), `plan approve` (regenerates PLANS.md in the same commit), `decision new` (next free `NNNN`, slug from title), `decision accept`; shared rules for refusals, `--dry-run`, and in-place `status:` rewriting. Module structure gained `commands/decision.ts` and the new subcommands. Error table gained `SpecStateError`, `ApprovalRefusedError`, `DecisionNotFoundError`, `DecisionStateError`, `UncommittedChangesError`, and the `plan approve` text on `PlanStateError`.
- `docs/specifications/architecture/file-formats.md`: §7.1 `llm_role` enums now `["review","assist","draft","none"]` for both spec types; §8.3 gained the `approve` workflow with the four subjects (`docs(specs): approve|reopen <id>`, `docs(<plan-id>): approve plan`, `docs(decisions): accept <id>`).
- `harnesses/claude/specifications/architecture/claude-integration.md`: files-produced list and the Workflows line gained the five new skills; per-skill frontmatter table gained `approve` (`<id>... [--reopen]`, `disable-model-invocation: true`), `plan-start`, `decision-new`, `plan-status` (`false`), `plan-abandon`; policy guard rewritten with an approval check that runs before the type early-return and applies under every `llm_role`, plus `review` mapped to ask.
- `plans/2026-10-29-assist-and-approve/spec-gaps.md`: G1 (`--dry-run` on the approval commands), G2 (`plan approve` regenerates PLANS.md).

### Deviations from the plan

None. No `based_on` pin references the edited specs, so the "re-pin dependants" criterion is satisfied without a re-pin commit; the skill contract markers that pin `agent-skills` are refreshed in step 05 as the task says.

### Gaps found in specs

- G1 (assumption): `--dry-run` on the approval commands. See `spec-gaps.md`.
- G2 (assumption): `plan approve` regenerates PLANS.md in the same commit. See `spec-gaps.md`.

### Open issues

- `specplane validate` now reports 12 `skill-drift` warnings (5 skill templates and their `.claude/skills/` copies pin `architecture/agent-skills` at `a8e55f4`). Expected: step 05 updates the skills and their pins. Baseline was 20 warnings; 0 errors throughout.
- `spec reopen` is specified as report-only (direct dependants only). Cascade was considered and rejected for this plan: `feature/tooling` fixes "It does not change those specs", and a `--cascade` flag would need a feature-spec edit the agent may not make (`llm_role: assist`). Raise it at the final review if wanted.

### What the next step must know

- The canonical standing-instructions text in `architecture/agent-skills` changed; `.claude/rules/specplane.md`, `AGENTS.md`, and `harnesses/claude/templates/rules/specplane.md` must match it byte-for-byte (step 02, `check-sync.sh`).
- `llm_role: review` must be accepted by the schema in `packages/cli/src/schemas.ts`; the spec now lists it in §7.1.
- The guard spec (step 05) requires the approval check to run **before** the "not a spec → exit 0" early return, and to inspect `Write.content`, `MultiEdit.edits[].new_string`, and `Edit.new_string`.
- `--dry-run` and the PLANS.md regeneration are agent-spec assumptions (G1, G2), not feature-spec text; steps 03 and 04 implement them.

## Step 02: The review role in config, validation, init, and standing instructions

**Date**: 2026-10-29
**Outcome**: done

### What changed

- `packages/cli/src/schemas.ts`, `packages/cli/src/types.ts`: `llm_role` is now `review | assist | draft | none` for both spec types; `LlmRole` gained `review`.
- `packages/cli/src/commands/init.ts`: the generated config comments read `# review | assist | draft | none`; the defaults are unchanged (`assist` feature, `draft` architecture).
- `packages/cli/src/agents/standing.ts` and the three delivery copies (`AGENTS.md` block, `.claude/rules/specplane.md`, `harnesses/claude/templates/rules/specplane.md`): the Authorship bullet now defines `review`, describes refine-then-write `assist`, and states that approval is set by the human, never by editing a file.
- `packages/cli/src/config.test.ts` plus fixtures `review-role` and `bad-llm-role`: `review` is accepted for both types, an unknown value fails with `review, assist, draft, none` listed.

### Deviations from the plan

None.

### Gaps found in specs

None.

### Open issues

- The `llm_role: review` values are now accepted, but the policy guard still maps only `assist`; step 05 adds `review` and the approval check.

### What the next step must know

- Approved specs are still editable on a plan branch without changing `status`; the CLI commands for approval do not exist yet (step 03/04), so nothing can currently set `approved` through the CLI.
- `npm test` is 230/230 in the worktree; `packages/cli/node_modules` was installed with `npm ci` there (the fresh worktree had none).
- `specplane init --harness claude` reports every file up to date and `check-sync.sh` is OK after the standing-text change; the Workflows line still lists only the six existing commands — step 05 extends it with the five new ones.

## Step 03: spec approve and spec reopen

**Date**: 2026-10-29
**Outcome**: done

### What changed

- `packages/cli/src/commands/spec-approve.ts` (new): `specApproveCommand`/`specReopenCommand`. Approve runs per-ID checks in order (status, committed, `require_approved_features`, overlay bases), re-pins an extending overlay's bases in the same commit, rewrites only the `status:` line, validates, and commits one ID at a time; reopen sets `review`, commits, and prints the direct dependants without touching them. `--dry-run` on both.
- `packages/cli/src/errors.ts`: `SpecStateError`, `ApprovalRefusedError`, `UncommittedChangesError` with the reference-cli message patterns.
- `packages/cli/src/commands/spec-approve.test.ts` (new): Scenarios 7–9 plus the six refusal cases, restore-on-validation-error, trailers, and `--dry-run`.
- `packages/cli/src/cli.ts`: `approve <ids...>` / `reopen <id>` registration; `spec.ts` exported `load`; `spec/pins.ts` exported `matchKey`; `git/commit.ts` omits `Specplane-Plan` when the plan ID is empty.
- `docs/specifications/architecture/reference-cli.md`: `cliTrailers` now says the plan trailer is omitted when `planId` is empty (the approval commands have no plan), matching the implementation.

### Deviations from the plan

The worker's first cut gated the overlay path on `spec.root.extends` (the *root* chain) and re-pinned every reference; corrected to frontmatter `extends` only, with the pin call limited to the extends refs, so a base-root spec that only `implements` is not treated as an overlay. `--dry-run` wording (`would approve …`) is not fixed by any spec.

### Gaps found in specs

- G1 (assumption): `--dry-run` on the approval commands. See `spec-gaps.md`. (Implemented here.)

### Open issues

- `spec reopen` is report-only and non-transitive, as specified.

### What the next step must know

- `spec approve` refuses already-`approved` specs, so after this plan's specs were approved by hand it can only be exercised on a `draft`/`review` spec.
- `pinSpec(config, root, id, refs)` takes the refs to pin; passing `[]` pins every reference (use it only for whole-spec re-pins).
- Step 04 adds `plan approve` and the `decision` group; reuse `commitChange`'s pattern (trailer `approve`, `cliTrailers("approve", "")`) for them.
- `npm test` is 240/240; `spec --help` lists `approve` and `reopen`.

## Step 04: plan approve, decision new, and decision accept

**Date**: 2026-10-29
**Outcome**: done

### What changed

- `packages/cli/src/commands/plan-approve.ts` (new): `plan approve` checks stored status, committed plan folder, `plans.require_approved_specs`, and plan validation, then writes `status: ready` and regenerates `PLANS.md` in the same commit (`docs(<plan-id>): approve plan`, trailer `approve`). `--dry-run`.
- `packages/cli/src/commands/decision.ts` (new): `decision new <title>` (next free `NNNN` from the directory listing, `slugify` name, proposed ADR with the four body headings) and `decision accept <id>...` (status, committed, per-ADR validation, `docs(decisions): accept <id>`). `--dry-run` on accept.
- `packages/cli/src/errors.ts`: `DecisionNotFoundError`, `DecisionStateError`; `AlreadyExistsError` handles decision records.
- `packages/cli/src/frontmatter.ts` (new): shared `writeStatus`, now used by the spec and plan/ADR commands.
- `packages/cli/src/commands/plan-approve.test.ts`, `decision.test.ts` (new): 14 tests (Scenario 10, refusals, PLANS.md in the same commit, `--dry-run`).

### Deviations from the plan

`decision new` numbering was corrected to read the directory listing (the spec says the highest existing `NNNN`), and its test now asserts the spec rule rather than the unreachable refusal (G3).

### Gaps found in specs

- G3 (gap): `decision new`'s "already exists" refusal is unreachable. See `spec-gaps.md`.

### Open issues

- G3 implies the documented error case should either be dropped from `feature/tooling` or the numbering rule changed to "next number not used by a valid ADR"; the user decides at the final review.

### What the next step must know

- `PLANS.md` is regenerated inside `plan approve`; the CLI `generate` command and CI use the same function, so there is no drift.
- `plan approve` refuses plans that are not `draft`; this plan is already `ready`, so it can only be exercised on a new plan.
- `npm test` is 254/254. Step 05 is the last code step: five skills, the guard, and `.claude` sync.

## Step 05: Claude skills, policy guard, and .claude sync

**Date**: 2026-10-29
**Outcome**: done

### What changed

- `harnesses/claude/templates/skills/spec-assist/SKILL.md` and `spec-draft-architecture/SKILL.md`: `assist` runs Describe -> Refine -> Finalise -> Write (file written only after the user approves the text, `author: mixed`, `status` unchanged); `review` is review-only; `draft` may draft on request; `none` declines.
- Five new skills: `approve` (`<id>... [--reopen]`, model invocation disabled), `plan-start`, `decision-new`, `plan-status` (model-invocable), `plan-abandon`; each with the shared preamble, the contract sections, and a contract pin.
- `templates/hooks/specplane-policy-guard.sh`: an approval check runs before the type-based early return. A spec, `PLAN.md`, step file, or ADR whose edited text sets `approved`/`ready`/`accepted` is denied, except when the file already has that status (an unchanged status is not an approval); `review` now maps to `ask` like `assist`.
- `templates/rules/specplane.md` and `AGENTS.md`: the Workflows line lists all eleven commands.
- All eleven contract pins re-pinned to `a94912d`, the committed blob of `architecture/agent-skills` at step 04.
- `.claude/` re-synced from the templates; `packages/cli/src/harness/claude.ts` and `pack.test.ts` updated for the new skill list and Workflows line.

### Deviations from the plan

The worker's guard matched a `status:` line without comparing it to the existing file, so rewriting an already-approved spec with `Write` would have been denied. Corrected to read the existing status and allow an unchanged value, as `claude:architecture/claude-integration` requires. `AGENTS.md` was updated by me rather than the worker, because the plan-step contract gives the agent that file and the worker was told not to touch it.

### Gaps found in specs

None.

### Open issues

- The guard cannot see `Bash` edits (`sed -i`, redirection); unchanged from the spec, and the standing instructions cover them.
- `NotebookEdit` has no `new_string`, so the approval check cannot see notebook content; the role check still applies through the file read.

### What the next step must know

- Checks at this point: `npm test` 254/254, `hooks.test.sh` 73/73, `check-sync.sh` OK, `validate` 0 errors / 21 warnings (the 21st is the worktree lacking `.claude/settings.local.json`; the main checkout has 20), `spec pin --check` clean, no `skill-drift` warnings remain.
- Step 06 updates READMEs/`--help`/the maintainers' slash-command table and lists the still-`review` specs for the user; all specs are currently `approved`, so that list will be empty unless something is reopened.
