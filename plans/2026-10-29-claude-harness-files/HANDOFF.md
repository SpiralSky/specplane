# HANDOFF — 2026-10-29-claude-harness-files

> **Start note (2026-10-29)**: Started at the user's explicit direction while every feature spec in `specs` was still `status: review`. This overrides `plans.require_approved_specs: feature`; spec statuses were not changed. Before starting, `claude:architecture/claude-integration` was completed and reviewed. The CLI is not yet built: skills and hooks must work without `specplane` on `PATH`, and validation is by hand. Steps run as fresh subagents (`use_subagent: true`), unattended, in the worktree `../.specplane-worktrees/specs-framework/2026-10-29-claude-harness-files/`.

## Step 01: Skill templates

**Date**: 2026-10-29
**Outcome**: done

### What changed

- `harnesses/claude/templates/skills/spec-assist/SKILL.md`: new skill template; refuses to produce a feature spec body under `llm_role: assist`.
- `harnesses/claude/templates/skills/spec-draft-architecture/SKILL.md`: new skill template.
- `harnesses/claude/templates/skills/plan-create/SKILL.md`: new skill template.
- `harnesses/claude/templates/skills/plan-step/SKILL.md`: new skill template with session-mode detection, `$ARGUMENTS` handling, and the `use_subagent: true` Agent call.
- `harnesses/claude/templates/skills/plan-finish/SKILL.md`: new skill template.
- `harnesses/claude/templates/skills/validate/SKILL.md`: new skill template (no `argument-hint`).
- `plans/2026-10-29-claude-harness-files/steps/01-skill-templates.md`: criteria ticked, status `done`.

### Deviations from the plan

None.

### Gaps found in specs

- Gap: `claude:architecture/claude-integration` does not say where the "Policy check" for `plan-finish` and `validate` goes, since `architecture/agent-skills` gives them no policy check. Used "None." per the step file.
- Gap: the architecture spec does not say how `plan-step` should split `$ARGUMENTS`. Used: strip `--unattended`, treat the remaining token as the plan ID.
- Gap: the shared preamble has no instruction on path resolution; added one closing sentence (resolve all paths from config) to the shared `## Preconditions` text, identical in all six files.

### Open issues

None.

### What the next step must know

- Only the six `SKILL.md` templates exist under `harnesses/claude/templates/skills/`; `CLAUDE.md`, `settings.json`, hooks, tests, and dogfood copies are not yet created.
- The `## Preconditions` text is byte-identical across all six files (the two checks plus one path-resolution sentence); `check-sync.sh` or any later edit must keep them identical.
- Frontmatter `argument-hint` values are quoted YAML strings (e.g. `"[plan-id] [--unattended]"`) because they start with `[`.
- No files outside the listed context were read.
