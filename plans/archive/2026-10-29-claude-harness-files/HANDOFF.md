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

## Step 02: Hook scripts, settings fragment, and hook tests

**Date**: 2026-10-29
**Outcome**: done

### What changed

- `harnesses/claude/templates/hooks/specplane-pre-commit.sh`: copied verbatim from the architecture spec; mode 0755.
- `harnesses/claude/templates/hooks/specplane-handoff-check.sh`: optional PostToolUse hook; warns on stdout when a `plan/<id> step NN:` commit lacks `<plans.dir>/<id>/HANDOFF.md`; header holds the registration snippet; always exits 0.
- `harnesses/claude/templates/hooks/specplane-generate.sh`: optional PostToolUse hook; runs `specplane generate` for `*/PLAN.md` paths; header holds the registration snippet; always exits 0.
- `harnesses/claude/templates/settings.json`: the spec'd registration JSON.
- `harnesses/claude/tests/hooks.test.sh`: 22 passing cases plus 1 xfail, all temp state under `mktemp -d`.
- `plans/2026-10-29-claude-harness-files/steps/02-hooks-and-tests.md`: criteria ticked, status `done`.

### Deviations from the plan

- The test for `(git commit)` is reported as `xfail` rather than run as a pass/fail case (see Gaps). All other spec'd cases are ordinary `run_case` checks.

### Gaps found in specs

- Gap: `claude:architecture/claude-integration` § Testing lists `(git commit)` as blocked, but the spec'd pre-commit regex requires whitespace or end of line after `commit`, so the closing `)` makes it not match (exit 0, not 2). Regex left unchanged as instructed. Likely fix: `commit([[:space:]);]|$)` or similar, in the spec and script together.
- Gap: the spec does not say where `specplane generate` output goes in the generate hook; used stderr. It also does not give the exact `sed` for reading `plans.dir`; used a range `sed` on the `plans:` block with default `plans`.

### Open issues

- The `(git commit)` regex/spec mismatch above must be resolved (spec edit plus script and test promotion from `xfail_case` to `run_case`). Not marked BLOCKED because the other criteria are met.

### What the next step must know

- `dash` is not installed here, so tests were run under `sh` (bash) only; `jq` was available.
- `hooks.test.sh` prints `XPASS` if the `(git commit)` gap is ever fixed; then switch it to `run_case`.
- The handoff-check hook runs `git log`/`git show` in the hook's cwd, and reads config from `$CLAUDE_PROJECT_DIR`.
- Hook scripts and `settings.json` are in `templates/`; dogfood copies under `.claude/` and `check-sync.sh` do not exist yet. Scripts are mode 100755.
- No files outside the listed context were read.

## Step 03: CLAUDE.md template, sync check, AGENTS.md, and dogfood install

**Date**: 2026-10-29
**Outcome**: done

### What changed

- `harnesses/claude/templates/CLAUDE.md`: new template, verbatim from § CLAUDE.md structure.
- `harnesses/claude/tests/check-sync.sh`: new POSIX `sh` check; maps templates to install paths, skips `settings.json`, checks `.claude/settings.json` mentions `specplane-pre-commit.sh`; exits 1 listing differences or missing files.
- `AGENTS.md`: new repository-neutral workflow guide (82 lines) covering all seven required topics; paths come from config.
- `.claude/skills/`, `.claude/hooks/` (mode 0755), `CLAUDE.md`: byte-identical copies of the templates.
- `.claude/settings.json`: created from the template (Settings merge rule 1).
- `plans/2026-10-29-claude-harness-files/steps/03-claude-md-and-dogfood.md`: criteria ticked, status `done`.

### Deviations from the plan

- `AGENTS.md` is 82 lines, below the 100-150 line aim, to stay a short neutral guide rather than restating policy.

### Gaps found in specs

- Gap: `feature/agent-integration` does not specify the step-commit message format for `AGENTS.md`. Used the format from the `plan-step` skill template (`plan/<id> step NN: <slug>` plus bullets).

### Open issues

None.

### What the next step must know

- Both scripts pass: `check-sync.sh` exits 0; `hooks.test.sh` reports 23 passed, 0 failed. Step 02's `(git commit)` open issue is resolved by commit d0f1045.
- `.claude/settings.local.json` was not created or touched.
- `AGENTS.md` is intended to be reused as the `init` template by the reference CLI core plan; it names no repository-specific plans or specs.
- Any future edit to a template must be copied to its install path, or `check-sync.sh` fails.
- No files outside the listed context were read (plus the skill/hook templates and settings.json template).
