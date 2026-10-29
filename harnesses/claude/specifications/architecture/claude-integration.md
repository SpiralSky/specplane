---
id: architecture/claude-integration
title: Claude Code integration implementation
status: draft
author: llm
implements: [claude:feature/claude-integration, feature/agent-integration]
---

# Claude Code integration implementation

This spec defines the concrete files and structure that implement the Claude Code harness overlay. It is an architecture spec in the `claude` overlay root. The content of each skill (policy checks, steps, outputs) is defined harness-neutrally in `architecture/agent-skills`; this spec defines how that content is packaged for Claude Code.

---

## Files produced

Files installed into a target repository:

```
.claude/
  skills/
    spec-assist/SKILL.md
    spec-draft-architecture/SKILL.md
    plan-create/SKILL.md
    plan-step/SKILL.md
    plan-finish/SKILL.md
    validate/SKILL.md
  hooks/
    specplane-pre-commit.sh       # registered by default
    specplane-handoff-check.sh    # optional; installed, not registered
    specplane-generate.sh         # optional; installed, not registered
  settings.json                   # hook registration (merged into any existing settings)
AGENTS.md                         # tool-agnostic; created by base `specplane init`
CLAUDE.md                         # Claude Code–specific; points to AGENTS.md + lists slash commands
```

Skills in `.claude/skills/<name>/SKILL.md` are Claude Code's current skill format; each is invocable as `/<name>`. (The older `.claude/commands/<name>.md` location still works but is not used.) `.claude/settings.local.json` is never read or written.

### Template source

The source of truth for every installed file is the harness's template directory, kept next to its overlay specs:

```
harnesses/claude/
  specifications/                 # overlay spec root (claude)
  templates/                      # installed verbatim by `specplane init --harness claude`
    CLAUDE.md
    settings.json                 # the default hook registration fragment
    skills/<name>/SKILL.md        # one per skill
    hooks/<script>.sh
  tests/
    hooks.test.sh                 # hook script tests (see § Testing)
    check-sync.sh                 # template ↔ dogfood copy check
```

Paths under `templates/` mirror their install paths relative to the repository root, with `.claude/` dropped (`templates/skills/plan-step/SKILL.md` → `.claude/skills/plan-step/SKILL.md`; `templates/CLAUDE.md` → `CLAUDE.md`). Templates contain no placeholders: skills resolve every path from config at run time (`architecture/agent-skills` § Config resolution in skills), so the same bytes work in every repository.

The CLI package bundles `harnesses/<name>/templates/` at build time (see § `specplane init` output). The Specplane repository dogfoods the harness: its own `.claude/skills/`, `.claude/hooks/`, and `CLAUDE.md` are byte-identical copies of the templates, enforced by `check-sync.sh`.

---

## CLAUDE.md structure

`templates/CLAUDE.md`:

```markdown
# Specplane — Claude Code harness

This repository uses Specplane for spec and plan management.

## Workflow

See [AGENTS.md](AGENTS.md) for the full Specplane workflow. Policy lives in `.specplane/config.yaml`; read it before acting on specs or plans.

## Slash commands

| Command | Purpose |
|---------|---------|
| `/spec-assist` | Help write a feature spec (does not draft it) |
| `/spec-draft-architecture` | Draft an architecture spec from feature specs |
| `/plan-create` | Create a new plan |
| `/plan-step` | Execute the next step of the current plan |
| `/plan-finish` | Run the finish flow for the current plan |
| `/validate` | Run `specplane validate` and summarise results |

## Conventions

- Read spec and plan files with `Read` (use offset/limit for large specs); find files with `Glob`, not `ls`/`find`.
- HANDOFF.md is the source of truth for plan progress; memory is only a pointer to it.

## Permissions

The following commands require approval on first use and are safe to allow for this project:
- `Bash(specplane:*)`
- `Bash(git worktree:*)`, `Bash(git branch:*)`, `Bash(git switch:*)`
```

---

## Skill file format

Each `SKILL.md` has Claude Code skill frontmatter followed by the contract sections from `architecture/agent-skills`, in the same order:

```markdown
---
name: <skill-name>
description: <one sentence: what it does and when to use it>
argument-hint: <optional; see table>
disable-model-invocation: <true|false; see table>
---

# <skill-name>

<Purpose paragraph.>

## Preconditions

<Shared preamble — see below.>

## Policy check

<Config keys to check; what to do when policy forbids the action.>

## Steps

1. <Step>
2. <Step>

## Output

<What the agent says or produces.>
```

The body restates the contract from `architecture/agent-skills` and adds only Claude Code–specific detail. It must not change policy. `$ARGUMENTS` in the body receives the text the user typed after the command.

### Per-skill frontmatter and Claude Code detail

`disable-model-invocation: true` means Claude never runs the skill on its own initiative; only the user's `/<name>` invokes it. Every skill that writes files, commits, or runs a plan flow sets it.

| Skill | `argument-hint` | `disable-model-invocation` | Claude Code detail |
|-------|-----------------|----------------------------|--------------------|
| `spec-assist` | `[topic]` | `false` | Never uses `Write`/`Edit` on a feature spec without the user's explicit approval of the exact change. |
| `spec-draft-architecture` | `[feature-spec-id ...]` | `true` | Writes the draft with `Write`; lists GAP markers in the output. |
| `plan-create` | `[goal]` | `true` | Uses `AskUserQuestion` for the slug, spec, and dependency choices when available. |
| `plan-step` | `[plan-id] [--unattended]` | `true` | Session-mode detection (below); subagent execution when the step sets `use_subagent: true`. |
| `plan-finish` | `[plan-id]` | `true` | Confirms with `AskUserQuestion` in attended sessions. |
| `validate` | — | `false` | Read-only; may run whenever validation results are relevant. |

### Shared preamble (`## Preconditions`)

Every skill begins with the same two checks:

1. **Specplane configured**: if neither `.specplane/config.yaml` nor `AGENTS.md` exists at the repository root, say "This repository is not set up for Specplane. Run `specplane init --harness claude`." and stop (`feature/agent-integration`: skills are no-ops without Specplane).
2. **CLI availability**: run `command -v specplane`. If present, use the CLI for resolution, validation, and plan flows. If absent, follow the same rules by hand from the format and flow specs (`architecture/agent-skills` § Config resolution in skills) and say once that the CLI was not found. For `/validate` without the CLI, check frontmatter and IDs by hand against `architecture/file-formats` and label the result "manual check". For `/plan-finish` without the CLI, perform `feature/plan-execution` § Finish flow by hand, in its stated order.

### Session mode (attended vs. unattended)

`feature/spec-precedence` leaves the attended/unattended decision to the harness. In Claude Code a session is **unattended** when any of the following holds, and **attended** otherwise:

- The skill was invoked with `--unattended` in `$ARGUMENTS`.
- The agent is running as a subagent (it was launched through the Agent tool).
- The session is non-interactive: headless (`claude -p`), a scheduled or cloud routine, or CI.
- The `AskUserQuestion` tool is not available.

When unsure, the agent treats the session as unattended. `/plan-step` states the detected mode at the start of its output.

---

## Hooks

All hook scripts are POSIX `sh`, executable, and exit `0` (allow) whenever they cannot do their job, so a missing tool never blocks work. They are no-ops in repositories without `.specplane/config.yaml`.

### Pre-commit validation (enabled by default)

`.claude/hooks/specplane-pre-commit.sh`:

```sh
#!/bin/sh
# PreToolUse hook (matcher: Bash): block `git commit` while specplane validation reports errors.
[ -f "${CLAUDE_PROJECT_DIR:-.}/.specplane/config.yaml" ] || exit 0
command -v specplane >/dev/null 2>&1 || exit 0
if ! command -v jq >/dev/null 2>&1; then
  echo "specplane pre-commit hook: jq not found; skipping validation." >&2
  exit 0
fi
cmd=$(jq -r '.tool_input.command // empty')
printf '%s\n' "$cmd" | grep -Eq '(^|[;&|(])[[:space:]]*git([[:space:]]+-[Cc][[:space:]]+[^[:space:]]+|[[:space:]]+-[^[:space:]]+)*[[:space:]]+commit([[:space:]]|$)' || exit 0
specplane validate >&2 && exit 0
echo "specplane validate reported errors; fix them before committing." >&2
exit 2
```

How it works:

- Claude Code passes the tool call to the hook as JSON on stdin; the script reads the Bash command from `.tool_input.command`.
- It matches `git commit` at the start of any line of the command or after `;`, `&`, `|`, or `(` (so `cd x && git commit` is covered), allowing global git options before `commit`: flags such as `--no-pager` or `--git-dir=<d>`, and the two-token options `-C <dir>` and `-c <key>=<value>`. Other git commands (including `git commit-tree`), and commands that merely mention "commit", do not match.
- Exit code `2` blocks the tool call, and the stderr text (the validation report) is shown to Claude. Exit `0` allows it. Validation warnings do not block (`specplane validate` exits 0 on warnings).
- Validation runs in the hook's working directory (the session's current directory). Known limitation: a command that changes into another checkout first (`cd <worktree> && git commit`) is validated against the session directory, not the target checkout. Plan steps run with the session inside the plan's checkout, so this does not affect the step flow.

Registration (`templates/settings.json`):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/specplane-pre-commit.sh" }
        ]
      }
    ]
  }
}
```

### Optional hooks (installed, not registered)

`init` installs these scripts but does not register them. To enable one, the user adds its registration to `.claude/settings.json`.

| Script | Event / matcher | Action |
|--------|-----------------|--------|
| `specplane-handoff-check.sh` | `PostToolUse` / `Bash` | If the command was a `git commit` (same pattern as the pre-commit hook) and `git log -1 --format=%s` matches `^plan/[^ ]+ step [0-9]+:`, take `<id>` from that subject and check `git show --name-only --format= HEAD` for `<plans.dir>/<id>/HANDOFF.md` (plans dir from `.specplane/config.yaml`, default `plans`, read with a `grep`/`sed` on the `dir:` key under `plans:`). If absent, print `Warning: step commit did not update <path>.` to stdout. Always exits 0. |
| `specplane-generate.sh` | `PostToolUse` / `Edit\|Write` | If `.tool_input.file_path` ends in `/PLAN.md` and `specplane` is installed, run `specplane generate`. Always exits 0. |

Registration snippets (documented in each script's header comment):

```json
{ "matcher": "Bash", "hooks": [ { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/specplane-handoff-check.sh" } ] }
{ "matcher": "Edit|Write", "hooks": [ { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/specplane-generate.sh" } ] }
```

each placed in the `hooks.PostToolUse` array.

### Settings merge

`init` merges `templates/settings.json` into `.claude/settings.json`:

1. If the file is absent, write the template as-is (2-space indent, trailing newline).
2. If present, parse it. If it is not valid JSON, do not touch it; print `Skipped .claude/settings.json (invalid JSON; add the hook registration by hand)`.
3. If any `hooks.PreToolUse[*].hooks[*].command` already contains `specplane-pre-commit.sh`, report `Skipped .claude/settings.json (hook already registered)`.
4. Otherwise append the template's matcher group to `hooks.PreToolUse` (creating `hooks` and the array as needed), preserve all other keys and their order, write it back, and report `Updated .claude/settings.json`.

---

## Subagent step execution

When a step declares `use_subagent: true`, the `/plan-step` skill runs steps 3–9 of the `plan-step` contract in a **fresh subagent** (the Agent tool with a general-purpose subagent type), not a `fork`. A fork inherits the parent session's full context, which defeats the purpose of a clean per-step session; a fresh subagent starts with only what it is given.

```
Agent({
  subagent_type: "general-purpose",
  description: "Execute plan step NN: <title>",
  prompt: "<plan-step contract steps 3–9>\n\nPlan: <plan-id>, checkout: <path>\nStep file: <path>\nHANDOFF.md: <path>\nContext items: <resolved paths, with heading anchors>\nSession mode: unattended"
})
```

The prompt passes **paths**, not file contents; the subagent reads them itself, so the parent never loads them. The parent performs steps 1–2 of the contract and resolves the step's context items to paths before launching; the subagent loads them (step 3). The subagent commits and appends to HANDOFF.md as normal, and returns a summary with the outcome (`done` or `blocked`). The parent session reports that summary and does not re-read the step's diff. The parent runs one subagent at a time: steps of a plan are sequential.

A subagent cannot ask the user questions mid-step, so subagent steps always run in unattended mode for contradiction handling (see `feature/spec-precedence`).

---

## Memory integration

Pending OQ-5; this section follows its proposed default (recommended, never enforced or validated).

Skills never read or write Claude Code memory; HANDOFF.md and the plan files remain the source of truth. When a user or agent chooses to record Specplane state in memory, the recommended entries are:

| Memory name | Type | Content |
|-------------|------|---------|
| `specplane-active-plan` | project | Active plan ID, checkout path, and the last completed step number. Points to HANDOFF.md for details. |
| `specplane-open-gaps` | project | Spec gaps or open questions found during steps and not yet filed in a spec or `OPEN-QUESTIONS.md`. |

A memory entry that disagrees with the plan files is stale; the plan files win.

---

## `specplane init` output for Claude Code

The Claude harness is set up when `specplane init` is run with `--harness claude`, or when a `.claude/` directory already exists (the detection rule for this harness). In that case `init` additionally creates, if absent:

- `.claude/skills/<name>/SKILL.md` for each skill.
- `.claude/hooks/*.sh` (mode `0755`), and the pre-commit registration via § Settings merge.
- `CLAUDE.md`.

and prints one `Created`/`Skipped` line per file (as base `init` does), followed by "Claude Code integration files created in `.claude/`."

If the harness is neither requested nor detected, `init` creates only the base files and prints: "No `.claude/` directory found. To enable Claude Code integration, run `specplane init --harness claude`."

### CLI implementation

Implemented by a plan that depends on the reference CLI core plan (not by the plan that produces the templates):

- `src/harness/index.ts`: a registry of harnesses, each `{ name, detect(root): boolean, install(root, report): void }`. `init --harness <name>` with an unknown name exits 1 listing the known names.
- `src/harness/claude.ts`: `detect` = `.claude/` exists; `install` copies the bundled templates (skip if the target exists), sets hook scripts executable, and performs § Settings merge.
- The package build copies `harnesses/claude/templates/` to `packages/cli/dist/templates/claude/`; `install` resolves templates relative to the compiled module.

---

## Testing

- `harnesses/claude/tests/hooks.test.sh` (POSIX `sh`, no framework; exits non-zero on any failure) feeds fixture JSON to each hook script with a stub `specplane` placed first on `PATH` (exit code chosen per case) and a temp `CLAUDE_PROJECT_DIR` containing `.specplane/config.yaml`. Pre-commit cases:
  - Blocked (exit 2) when the stub exits 1: `git commit -m x`; `cd a && git commit -am x`; `git -C dir commit`; `git -c user.name=x commit`; `git --no-pager commit`; a two-line command whose second line is `git commit`; `(git commit)`.
  - Allowed (exit 0) when the stub exits 1: `git commit-tree abc`; `echo commit`; `git log --grep commit`; `git status`.
  - Allowed when the stub exits 0; allowed when `specplane` is absent from `PATH`; allowed when `CLAUDE_PROJECT_DIR` has no `.specplane/config.yaml`.
  - Optional hooks: the generate hook runs the stub only for a `PLAN.md` path; the handoff check warns for a step commit without HANDOFF.md (in a temp git repo) and is silent otherwise. Both always exit 0.
- `harnesses/claude/tests/check-sync.sh` diffs each file under `templates/` against its installed path in the Specplane repository (per § Template source) and exits 1 listing any difference or missing file.
- Skill content is reviewed by hand against `architecture/agent-skills` (`architecture/agent-skills` § Keeping skills in sync with specs).
