# HANDOFF — 2026-10-29-cli-claude-harness-init

## Step 01: Architecture spec edits for agent skills, Claude harness, registry

**Date**: 2026-10-29
**Outcome**: done

### What changed

- `docs/specifications/architecture/agent-skills.md`: self-checks added to `spec-assist` (step 5) and `spec-draft-architecture` (step 7) and to `validate` (step 4, LLM-review findings); ordering checks in `plan-create` (step 4, step dependencies) and `plan-step` (step 2, lower steps done first); CLI-unavailable fallbacks in `plan-create` step 6, `plan-finish` and `validate`; new `Policy check` sections for `plan-finish` and `validate`. Later steps in affected skills were renumbered (spec-assist 5-6, spec-draft-architecture 7-8, validate 4-5).
- `harnesses/claude/specifications/architecture/claude-integration.md`: subagent does not push, the parent does (plan-step step 10); check-sync `settings.json` comparison is a subset comparison; registry shape now includes `skillDirs` and `rulesFile`.
- `docs/specifications/architecture/reference-cli.md`: `harness/index.ts` and `harness/claude.ts` in module structure; skill drift directories come from each harness's `skillDirs(root)`; rules-file freshness is a byte-compare with the bundled template (`freshness` warning).
- `plans/2026-10-29-cli-claude-harness-init/steps/01-architecture-spec-edits.md`: status done, criteria ticked.

### Deviations from the plan

None.

### Gaps found in specs

None.

### Open issues

- CHOICE: the leak self-check is specified for spec-assist (own suggestions), spec-draft-architecture (own draft coverage/contradiction check) and validate (own LLM-review findings); the ordering check for plan-create and plan-step; fallbacks for plan-create, plan-finish (stop), validate.
- CHOICE: registry fields are named `skillDirs(root): string[]` and `rulesFile: string`.
- CHOICE: no overlay or file-formats pins went stale, so `spec pin` changed nothing; only skill markers are stale.
- Expected `skill-drift` warnings (12 total: .claude copy and template for each) for plan-create, plan-finish, plan-step, spec-assist, spec-draft-architecture, validate, pinned at `21e5329`; the agent-skills blob is now `9b59fd0`. `validate` reports 0 errors.

### What the next step must know

Step 02 must update the six skill templates to the new contract (each skill's section in agent-skills changed, except `validate` and `plan-finish` gained Policy check sections), set the markers to `architecture/agent-skills#<skill>@<new blob7>` (take it from `git rev-parse --short=7 HEAD:docs/specifications/architecture/agent-skills.md` after the last agent-skills commit; currently `9b59fd0`), copy to `.claude/skills/`, and run `sh harnesses/claude/tests/check-sync.sh`. Do not edit agent-skills again without re-pinning.

## Step 02: Update skill templates and dogfood copies

**Date**: 2026-10-29
**Outcome**: done

### What changed

- `harnesses/claude/templates/skills/*/SKILL.md` (all six): amended per agent-skills (self-checks in spec-assist, spec-draft-architecture, validate; ordering checks in plan-create and plan-step; plan-create no-CLI validation fallback; `## Policy check` for plan-finish and validate; plan-step subagent runs steps 3-9 and the parent pushes). Markers now `@9b59fd0`.
- `.claude/skills/*/SKILL.md`: byte-identical copies.
- `harnesses/claude/tests/check-sync.sh`: comments already describe the settings comparison as a subset; no change needed.

### Deviations from the plan

None.

### Gaps found in specs

None.

### Open issues

- CHOICE: plan-finish Policy check is rendered as bullets under a `Read config.plans and config.execution` line, mirroring the spec's code block content.
- CHOICE: the subagent prompt in plan-step covers steps 3-9; the parent does step 10.

### What the next step must know

`skill-drift` warnings are resolved; check-sync and hook tests pass. Do not edit agent-skills without re-pinning markers.

## Step 03: Harness registry and template bundling

**Date**: 2026-10-29
**Outcome**: done

### What changed

- `packages/cli/src/harness/index.ts`: `Harness` interface, `Report` helper (Created/Updated/Skipped lines), registry with a stub `claude` entry (detect = `.claude/` exists, `install` no-op), `selectHarnesses`, `UnknownHarnessError`, `templatesDir(name)` resolved from the compiled module.
- `packages/cli/src/commands/init.ts`: `runInit(root, opts?)` takes `{ harness, registry }`, installs selected harnesses, prints the "No `.claude/` directory found" hint otherwise; `initCommand` passes options.
- `packages/cli/src/cli.ts`: `init --harness <name>` option (3-line change).
- `packages/cli/package.json`: build copies `harnesses/claude/templates` to `dist/templates/claude`.
- `packages/cli/src/harness/harness.test.ts` (fake harness tests) and one assertion adjusted in `generate.test.ts` (hint line is not a Skipped line).

### Deviations from the plan

None.

### Gaps found in specs

None.

### Open issues

- CHOICE: `UnknownHarnessError` lives in `harness/index.ts`, not `errors.ts`, to avoid conflicts with the concurrent cli-spec-search plan.
- CHOICE: `--harness` selects only that harness; detection runs only when the flag is absent.
- CHOICE: the build copy is an inline `node -e fs.cpSync` in the npm script (no extra script file).

### What the next step must know

Step 04 replaces the stub `install` in `claude` (ideally moving it to `src/harness/claude.ts`), using `templatesDir("claude")` and the `Report` helper, and appends "Claude Code integration files written to `.claude/`." after the lines.

## Step 04: Claude installer and settings merge

**Date**: 2026-10-29
**Outcome**: done

### What changed

- `packages/cli/src/harness/claude.ts` (new): `claude` harness with `install` (template copy: Created/Updated/Skipped lines, hooks chmod 0755, final "Claude Code integration files written to `.claude/`." line) and exported `mergeSettings` implementing § Settings merge.
- `packages/cli/src/harness/index.ts`: stub removed, imports `claude`; `Harness` gains optional `workflowsLine`.
- `packages/cli/src/commands/init.ts`: AGENTS.md block uses the selected harness's Workflows line.
- `packages/cli/src/commands/validate.ts`: freshness check accepts the neutral line or any harness line.
- `packages/cli/src/harness/harness.test.ts`: tests for absent, invalid, already registered, partial, kept statusLine, idempotence, mode, CLAUDE.md untouched.

### Deviations from the plan

None.

### Gaps found in specs

- Spec does not say how `validate` freshness treats an AGENTS.md block with the Claude Workflows line; handled below.

### Open issues

- CHOICE: freshness check passes if AGENTS.md matches the neutral line or any registered harness's line.
- CHOICE: unchanged template files report `Skipped <path> (up to date)`; mode is enforced on hooks even when content matches.
- CHOICE: a settings file with unexpected structure (non-object `hooks`/`permissions`, non-array event lists) is treated like invalid JSON (skipped, untouched).
- CHOICE: an added `statusLine` counts as an entry in `(<n> entries added)`; "Kept existing statusLine" line precedes the Updated/Skipped line.

### What the next step must know

`HARNESSES` now contains the full claude harness; `workflowsLine` is the hook for other harnesses.

## Step 05: Replace skillDirs stand-in; rules freshness check

**Date**: 2026-10-29
**Outcome**: done

### What changed

- `packages/cli/src/spec/skill-drift.ts`: stand-in `skillDirs()` replaced by a registry-based one (installed harnesses' `skillDirs(root)` plus `harnesses/*/templates/skills/*`); `checkSkillDrift` takes an optional registry.
- `packages/cli/src/harness/index.ts`: `skillDirsIn` helper, optional `rulesTemplate` field; `claude.ts` returns per-skill dirs `.claude/skills/<name>` and sets `rulesTemplate`.
- `packages/cli/src/commands/validate.ts`: `checkFreshness` adds the rules-file byte-compare (warning `freshness` on the rules file) and accepts a fresh rules file as delivering the standing block.
- Tests in `validate.test.ts` and `spec/pins.test.ts`.

### Deviations from the plan

None.

### Gaps found in specs

- The spec gives `rulesFile` but not where the bundled template lives; added `rulesTemplate`.

### Open issues

- CHOICE: `rulesTemplate` is an optional Harness field (path relative to `templatesDir(name)`); harnesses without it skip the rules check.
- CHOICE: `skillDirs(root)` returns repo-relative POSIX per-skill dirs (previously absolute base dir stub).
- CHOICE: the standing check is satisfied by AGENTS.md or a byte-fresh rules file of a detected harness; a stale rules file warns on itself, and AGENTS.md only warns if neither delivers.
- `validate` on this repo: 0 errors, no freshness or skill-drift warnings.

### What the next step must know

Step 06 can rely on `validate` flagging stale `.claude/rules/specplane.md`.

## Step 06: End-to-end init and dogfood check

**Date**: 2026-10-29
**Outcome**: done

### What changed

- `packages/cli/src/harness/pack.test.ts` (new): `npm pack`s the package, installs the tarball into a temp prefix, runs `init --harness claude` in a fresh git repo with pre-existing settings; asserts the file list, hook modes 0755, merged settings (user permission and statusLine kept, hooks registered), the AGENTS.md block, no CLAUDE.md, and a second run with no Created/Updated lines.
- `AGENTS.md`: Workflows line refreshed by `init --harness claude` (it still said no slash commands were installed). A second run is then a no-op.

### Deviations from the plan

None.

### Gaps found in specs

None.

### Open issues

- CHOICE: the test installs with `--prefer-offline` and needs the npm cache or network for the dependencies.
- CHOICE: the only dogfood drift was the AGENTS.md managed block; `.claude/` was already in sync.
- check-sync, hooks.test.sh (62 passed), `validate` (0 errors) and `spec pin --check` pass; `npm test` 113 pass.

### What the next step must know

This is the last step; the finish flow ticks PLAN.md.
