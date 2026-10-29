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
