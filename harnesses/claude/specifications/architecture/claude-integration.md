---
id: architecture/claude-integration
title: Claude Code integration implementation
status: review
author: llm
implements: [claude:feature/claude-integration, feature/agent-integration]
based_on: { "claude:feature/claude-integration": "d3406ae", feature/agent-integration: "9e3a0cf" }
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
  rules/
    specplane.md                  # standing instructions (Specplane-owned; overwritten on update)
  hooks/
    specplane-pre-commit.sh       # registered by default
    specplane-policy-guard.sh     # registered by default
    specplane-session-context.sh  # registered by default
    specplane-statusline.sh       # registered only if no status line is configured
    specplane-handoff-check.sh    # optional; installed, not registered
    specplane-generate.sh         # optional; installed, not registered
  settings.json                   # hook and status line registration (merged into any existing settings)
AGENTS.md                         # managed block written by base `specplane init`
```

Skills in `.claude/skills/<name>/SKILL.md` are Claude Code's current skill format; each is invocable as `/<name>`. (The older `.claude/commands/<name>.md` location still works but is not used.) `.claude/settings.local.json` is never read or written.

**User-owned files are not edited.** Specplane never writes `CLAUDE.md`. Everything above except `AGENTS.md` and `.claude/settings.json` is a Specplane-owned file that `init` may overwrite; `AGENTS.md` changes only inside its managed block (`architecture/agent-skills#delivery`) and `settings.json` only by § Settings merge.

Everything above is plain repository content, so it also applies in Claude Code cloud sessions, which load the repository's `.claude/` hooks, rules, and skills but do not install plugins. The optional plugin (§ Live view and Specplane mode) is a local-only addition and nothing depends on it.

### Template source

The source of truth for every installed file is the harness's template directory, kept next to its overlay specs:

```
harnesses/claude/
  specifications/                 # overlay spec root (claude)
  templates/                      # installed verbatim by `specplane init --harness claude`
    settings.json                 # the default registration fragment
    rules/specplane.md
    skills/<name>/SKILL.md        # one per skill
    hooks/<script>.sh
  plugin/                         # optional Claude Code plugin (§ Live view and Specplane mode); not installed by init
  tests/
    hooks.test.sh                 # hook script tests (see § Testing)
    check-sync.sh                 # template ↔ dogfood copy check
```

Paths under `templates/` mirror their install paths under `.claude/` (`templates/skills/plan-step/SKILL.md` → `.claude/skills/plan-step/SKILL.md`; `templates/rules/specplane.md` → `.claude/rules/specplane.md`). Templates contain no placeholders: skills and hooks resolve every path from config at run time (`architecture/agent-skills#config-resolution-in-skills`), so the same bytes work in every repository.

The CLI package bundles `harnesses/<name>/templates/` at build time (see § `specplane init` output). The Specplane repository dogfoods the harness: its own `.claude/skills/`, `.claude/hooks/`, and `.claude/rules/specplane.md` are byte-identical copies of the templates, enforced by `check-sync.sh`. Its `CLAUDE.md`, if any, is the maintainers' own file.

---

## Standing instructions (`.claude/rules/specplane.md`)

Claude Code loads every file in `.claude/rules/` at session start (a rule without `paths:` frontmatter applies to the whole session), so this file delivers the standing instructions without touching `CLAUDE.md`. It has no `paths:` frontmatter: the rules must hold before Claude touches any spec file.

`templates/rules/specplane.md` is the canonical standing text (`architecture/agent-skills#standing-instructions`, `v1`) followed by a short Claude Code section, about 20 lines in all:

```markdown
<!-- specplane:standing v1 — installed by `specplane init --harness claude`; overwritten on update -->
<standing instructions text, with this Workflows line:>
- **Workflows**: `/spec-assist`, `/spec-draft-architecture`, `/plan-create`, `/plan-step`, `/plan-finish`, `/validate`.

### Claude Code
- Read spec and plan files with `Read` (offset/limit for large specs); find files with `Glob`.
- HANDOFF.md is the source of truth for plan progress; memory is only a pointer to it.
- In a plan checkout, the session start context names the plan and its next step; work only on that step.
- Commits: put `Specplane-Agent: $SPECPLANE_AGENT` and `Specplane-Session: $SPECPLANE_SESSION` in the trailers when those variables are set.
```

**Interaction with `AGENTS.md`.** Claude Code reads `AGENTS.md` only when the repository has no `CLAUDE.md` (or when the user imports it). In that case Claude sees the standing text twice (rules file and `AGENTS.md` block); the duplicate is a few lines and is accepted. `validate` counts `.claude/rules/specplane.md` as a delivery file for the standing instructions (`architecture/reference-cli#standing-instructions-agentsstandingts`).

Permission notes that used to live in `CLAUDE.md` move to `settings.json`: § Settings merge adds `Bash(specplane:*)` to `permissions.allow`.

---

## Skill file format

Each `SKILL.md` has Claude Code skill frontmatter, then a contract comment on the first line after the frontmatter, then the contract sections from `architecture/agent-skills`, in the same order:

```markdown
---
name: <skill-name>
description: <one sentence: what it does and when to use it>
argument-hint: <optional; see table>
disable-model-invocation: <true|false; see table>
---

<!-- specplane-contract: architecture/agent-skills#<skill-name>@<blob7> -->

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

The body restates the contract from `architecture/agent-skills` and adds only Claude Code–specific detail. It must not change policy. `$ARGUMENTS` in the body receives the text the user typed after the command. Skills split `$ARGUMENTS` on whitespace; tokens starting with `--` are flags (`--unattended`), and the first remaining token is the positional argument (`plan-id`, `topic`, or `goal`; for `spec-draft-architecture`, all remaining tokens are spec IDs). Skills whose contract has no policy check write "None." under `## Policy check`.

The `plan-step` and `plan-finish` skills write and read `<plans.dir>/<plan-id>/spec-gaps.md` exactly as `architecture/agent-skills` defines it; the gap record is harness-neutral, so no Claude-specific file or command is involved, and a proposal is a `spec-gaps.md` `proposal` entry rather than a `feature-spec-proposals.md` file.

### Per-skill frontmatter and Claude Code detail

`disable-model-invocation: true` means Claude never runs the skill on its own initiative; only the user's `/<name>` invokes it. Every skill that writes files, commits, or runs a plan flow sets it.

| Skill | `argument-hint` | `disable-model-invocation` | Claude Code detail |
|-------|-----------------|----------------------------|--------------------|
| `spec-assist` | `[topic]` | `false` | Never uses `Write`/`Edit` on a feature spec without the user's explicit approval of the exact change. |
| `spec-draft-architecture` | `[feature-spec-id ...]` | `true` | Writes the draft with `Write`; lists GAP markers in the output. |
| `plan-create` | `[goal]` | `true` | Uses `AskUserQuestion` for the slug, spec, and dependency choices when available. |
| `plan-step` | `[plan-id] [--unattended]` | `true` | Session-mode detection (below); subagent execution when the step sets `use_subagent: true`; writes `spec-gaps.md` entries with `Write`/`Edit` and lists their IDs in HANDOFF.md. |
| `plan-finish` | `[plan-id]` | `true` | Confirms with `AskUserQuestion` in attended sessions; reports the open `spec-gaps.md` entries the CLI lists. |
| `validate` | — | `false` | Read-only; may run whenever validation results are relevant. |

### Shared preamble (`## Preconditions`)

Every skill begins with the same two checks:

1. **Specplane configured**: if `.specplane/config.yaml` does not exist at the repository root (an `AGENTS.md` alone does not count; many repositories have one without Specplane), say "This repository is not set up for Specplane. Run `specplane init --harness claude`." and stop (`feature/agent-integration`: skills are no-ops without Specplane).
2. **CLI availability**: run `command -v specplane`. If present, use the CLI for resolution, validation, and plan flows. If absent, follow the same rules by hand from the format and flow specs (`architecture/agent-skills#config-resolution-in-skills`) and say once that the CLI was not found. For `/validate` without the CLI, check frontmatter and IDs by hand against `architecture/file-formats` and label the result "manual check". `/plan-finish` without the CLI stops and tells the user to install it.

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
printf '%s\n' "$cmd" | grep -Eq '(^|[;&|(])[[:space:]]*git([[:space:]]+-[Cc][[:space:]]+[^[:space:]]+|[[:space:]]+-[^[:space:]]+)*[[:space:]]+commit([[:space:];&|)]|$)' || exit 0
specplane validate >&2 && exit 0
echo "specplane validate reported errors; fix them before committing." >&2
exit 2
```

How it works:

- Claude Code passes the tool call to the hook as JSON on stdin; the script reads the Bash command from `.tool_input.command`.
- It matches `git commit` at the start of any line of the command or after `;`, `&`, `|`, or `(` (so `cd x && git commit` is covered), allowing global git options before `commit`: flags such as `--no-pager` or `--git-dir=<d>`, and the two-token options `-C <dir>` and `-c <key>=<value>`. `commit` must be followed by whitespace, `;`, `&`, `|`, `)`, or the end of the line. Other git commands (including `git commit-tree`), and commands that merely mention "commit", do not match.
- Exit code `2` blocks the tool call, and the stderr text (the validation report) is shown to Claude. Exit `0` allows it. Validation warnings do not block (`specplane validate` exits 0 on warnings).
- Validation runs in the hook's working directory (the session's current directory). Known limitation: a command that changes into another checkout first (`cd <worktree> && git commit`) is validated against the session directory, not the target checkout. Plan steps run with the session inside the plan's checkout, so this does not affect the step flow.

### Policy guard (enabled by default)

`.claude/hooks/specplane-policy-guard.sh` enforces `specs.<type>.llm_role` at the moment Claude edits a spec, so authorship policy does not depend on the model remembering an instruction. PreToolUse, matcher `Edit|MultiEdit|Write|NotebookEdit`.

1. No-op (exit 0) without `.specplane/config.yaml` or `jq`.
2. Spec type: read the frontmatter `id:` of the target — from `.tool_input.content` for `Write`, else from the file at `.tool_input.file_path` (`.tool_input.notebook_path` for `NotebookEdit`; first `---` block only). The type is the ID's prefix when it is `feature/` or `architecture/` (an optional `<root>:` qualifier is stripped). Anything else (plans, ADRs, code, files without frontmatter) → exit 0. A spec's type comes from its own ID, so no spec root needs resolving.
3. `llm_role`: read `specs.<type>.llm_role` from the config with `awk` (the `llm_role:` key inside the `<type>:` block inside the top-level `specs:` block, comments stripped); default `assist` for `feature`, `draft` for `architecture`.
4. Decision, printed as PreToolUse JSON on stdout with exit 0:
   - `none` → `permissionDecision: "deny"`, reason `Policy (specs.<type>.llm_role: none) forbids editing <type> specs. Tell the user instead.`
   - `assist` → `permissionDecision: "ask"`, reason `Policy (specs.<type>.llm_role: assist): the user must approve this exact edit.` The user sees the edit and decides; in a non-interactive session the ask cannot be granted, which blocks the edit as intended.
   - `draft`, or any other value → exit 0 with no output (normal permission handling).

The guard does not see edits made through `Bash` (`sed -i`, redirection); the standing instructions cover those. It complements `spec-assist`'s rule (approve the exact change) rather than replacing it.

### Session context (enabled by default)

`.claude/hooks/specplane-session-context.sh` gives a session that starts in a plan checkout its scope, so a fresh session in a worktree or a cloud run knows which plan and step it is on without loading anything else. SessionStart (all sources).

1. No-op without `.specplane/config.yaml`.
2. If `CLAUDE_ENV_FILE` is set, append `export SPECPLANE_AGENT=claude-code` (with `/<model>` when the hook input has a `model` field) and `export SPECPLANE_SESSION=<session_id>`, so the CLI and the agent's commits carry the `architecture/file-formats` §8.2 trailers.
3. If the current branch is `plan/<id>`: find the plan folder (`<plans.dir>/<id>`, plans dir read as in the handoff check), read each step file's `step`, `title`, and `status`, and print `hookSpecificOutput.additionalContext`:
   `Specplane: this checkout is plan <id> (branch plan/<id>). Steps done: <d>/<n>. Next step: <NN> <title> (<status>). Run /plan-step to execute it; work on that step only. Open blockers: <count of BLOCKED: lines in HANDOFF.md>.`
   When every step is done: `… All steps are done; run /plan-finish.`
4. Otherwise print nothing.

### Status line (registered if none is configured)

`.claude/hooks/specplane-statusline.sh` is a `statusLine` command. It reads `workspace.current_dir` from the stdin JSON and prints one line, or nothing outside a plan checkout:

`◆ <plan slug> · step <NN>/<n> <title, truncated to 30> · <status>` with `⚠ blocked` appended when the next step is `blocked`.

It reads only the step files in the checkout (no git network calls, no CLI), so it stays fast under Claude Code's refresh rate. Users who already have a status line keep it; the script header shows how to call it from their own.

Registration (`templates/settings.json`):

```json
{
  "permissions": {
    "allow": ["Bash(specplane:*)"]
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/specplane-pre-commit.sh" }
        ]
      },
      {
        "matcher": "Edit|MultiEdit|Write|NotebookEdit",
        "hooks": [
          { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/specplane-policy-guard.sh" }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/specplane-session-context.sh" }
        ]
      }
    ]
  },
  "statusLine": {
    "type": "command",
    "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/specplane-statusline.sh"
  }
}
```

### Optional hooks (installed, not registered)

`init` installs these scripts but does not register them. To enable one, the user adds its registration to `.claude/settings.json`.

| Script | Event / matcher | Action |
|--------|-----------------|--------|
| `specplane-handoff-check.sh` | `PostToolUse` / `Bash` | If the command was a `git commit` (same pattern as the pre-commit hook) and the new commit's trailers (`git log -1 --format='%(trailers:only,unfold)'`) include `Specplane-Workflow: step`, take `<id>` from its `Specplane-Plan` trailer and check `git show --name-only --format= HEAD` for `<plans.dir>/<id>/HANDOFF.md` (plans dir from `.specplane/config.yaml`: the first `dir:` key inside the top-level `plans:` block, read with `sed`; default `plans`). If absent, print `Warning: step commit did not update <path>.` to stdout. Always exits 0. |
| `specplane-generate.sh` | `PostToolUse` / `Edit\|Write` | If `.tool_input.file_path` ends in `/PLAN.md` and `specplane` is installed, run `specplane generate`, sending its output to stderr. Always exits 0. |

Registration snippets (documented in each script's header comment):

```json
{ "matcher": "Bash", "hooks": [ { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/specplane-handoff-check.sh" } ] }
{ "matcher": "Edit|Write", "hooks": [ { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/specplane-generate.sh" } ] }
```

each placed in the `hooks.PostToolUse` array.

### Settings merge

`init` merges `templates/settings.json` into `.claude/settings.json`:

1. If the file is absent, write the template as-is (2-space indent, trailing newline).
2. If present, parse it. If it is not valid JSON, do not touch it; print `Skipped .claude/settings.json (invalid JSON; add the Specplane registration by hand)`.
3. For each template matcher group under `hooks.<Event>`: skip it if any `hooks.<Event>[*].hooks[*].command` already contains its script name; otherwise append it (creating `hooks` and the array as needed).
4. `permissions.allow`: add each template entry not already present.
5. `statusLine`: set only if the key is absent; otherwise report `Kept existing statusLine (see specplane-statusline.sh to combine)`.
6. Preserve all other keys and their order. Write the file back only if something changed, reporting `Updated .claude/settings.json (<n> entries added)`; else `Skipped .claude/settings.json (already registered)`.

---

## Worktree and cloud sessions

An agent session works on **one plan, and within it one step at a time**. The harness is built around that unit:

| Where the session runs | How it is scoped | How others see its progress |
|------------------------|------------------|-----------------------------|
| Local worktree (`execution.backend: worktree`) | Started in `<worktree_dir>/<repo>/<plan-id>/`; § Session context names the plan and next step; `/plan-step` refuses to run off the plan branch | Shared local refs: the main checkout sees `plan/<id>` immediately |
| Subagent (`use_subagent: true`) | Gets only the step's paths (§ Subagent step execution) | Its commit on the plan branch |
| Cloud session or other machine (`external`, or any session with an `origin/plan/<id>` upstream) | Checks out `plan/<id>`; same hooks, rules, and skills (cloud sessions load the repository's `.claude/`) | `plan-step` pushes `plan/<id>` after each step commit (`architecture/agent-skills` § plan-step, step 10) |

Rules:

- **One writer per plan.** Steps are sequential, so two sessions never work on the same plan at once. `plan-step` fetches the plan branch first and stops if it has diverged (`architecture/agent-skills` § plan-step, step 1). Parallel work happens across plans, each in its own checkout.
- **Fresh context per step.** Prefer a new session (or a subagent) per step over one long session: the step file, HANDOFF.md, and § Session context carry everything the next step needs.
- **Commits identify the run.** Every step commit carries `Specplane-Agent` and, from § Session context, `Specplane-Session`, so the live view and `git log` show which session made which step even when several machines push to the same repository.
- **Cloud sessions are unattended** (§ Session mode): the policy guard's `ask` cannot be granted there, so feature-spec edits under `assist` are blocked, and contradictions become `BLOCKED:` items.

---

## Live view and Specplane mode (optional plugin)

`harnesses/claude/plugin/` is a Claude Code plugin with a hooks module (Claude Code's plugin hook API), published from the Specplane repository's marketplace. It is opt-in and local-only: cloud sessions do not install plugins, and everything in this section is a convenience on top of files that already work without it. A repository may recommend it through `.claude/settings.json` (`extraKnownMarketplaces`, `enabledPlugins`); `init` does not add these entries.

### Data source

The plugin never keeps its own copy of plan state. It runs `specplane plan list --json --live` (`architecture/reference-cli` § Plan activity) every 60 s, with `--no-fetch` except on every fifth run, and immediately after a `git commit` or `git push` tool call in the session. Without the CLI it shows only the current checkout's plan, read from its step files.

### Plans pane

A pane titled **Specplane** beside the chat, opened with `/specplane`:

- One row per plan that is `in_progress` or `review`, or that has a branch: plan slug; where it runs (worktree path, `remote` when only `origin/plan/<id>` exists, `external`); `step <done>/<total>` and the next step's title; age of the last step commit with its `Specplane-Agent` and a short `Specplane-Session`; `⚠ <n> blocked` from `blocked_issues`; `↑<n>` when `ahead_of_remote` > 0.
- Selecting a row expands its blocked issues and the next step's acceptance criteria. Buttons copy the command to continue in that checkout (`cd <checkout> && claude /plan-step`), or put `Read <HANDOFF.md path>` into the prompt. In a non-interactive session (`claude -p`), where the prompt cannot be filled, the second button is labelled "Copy HANDOFF path" and copies the path instead.
- The pane is read-only: it never starts, finishes, or edits plans.

### Specplane mode

The plugin keeps a session mode, shown in the status area and switched with `/specplane-mode <step|spec|off>`:

| Mode | Set automatically when | Effect |
|------|------------------------|--------|
| `step` | the session starts on a `plan/<id>` branch | Adds a system-prompt section scoping the session to the next step (plan, step file, HANDOFF.md path, acceptance criteria). Denies `Edit`/`Write` outside the checkout, and on other steps' files and `PLAN.md` (the CLI changes plan status, not the agent). A band above the prompt shows `step NN: <title> · criteria <checked>/<total>`, refreshed when the step file changes. |
| `spec` | never | Adds a system-prompt section with the authorship policy for each spec type from the config and the spec templates (`architecture/file-formats` §1.3–1.4). Status shows `spec · feature: <llm_role> · architecture: <llm_role>`. |
| `off` | otherwise | No changes. |

The mode only tightens what the hooks and skills already enforce; with the plugin absent, the same rules apply through § Policy guard, § Session context, and `/plan-step`.

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

The prompt passes **paths**, not file contents; the subagent reads them itself, so the parent never loads them. The parent performs steps 1–2 of the contract and resolves the step's context items to paths before launching; the subagent loads them (step 3). The subagent commits and appends to HANDOFF.md as normal, and returns a summary with the outcome (`done` or `blocked`). It does not push: the parent performs the push (`plan-step` step 10) after the subagent returns, when `execution.backend` is `external` or the branch has an upstream. The parent reports the summary and does not re-read the step's diff. The parent runs one subagent at a time: steps of a plan are sequential.

A subagent cannot ask the user questions mid-step, so subagent steps always run in unattended mode for contradiction handling (see `feature/spec-precedence`).

---

## Memory integration

The memory names are recommendations from `claude:feature/claude-integration` (OQ-5, resolved); Specplane never enforces or validates them.

Skills never read or write Claude Code memory; HANDOFF.md and the plan files remain the source of truth. When a user or agent chooses to record Specplane state in memory, the recommended entries are:

| Memory name | Type | Content |
|-------------|------|---------|
| `specplane-active-plan` | project | Active plan ID, checkout path, and the last completed step number. Points to HANDOFF.md for details. |
| `specplane-open-questions` | project | Open questions found during steps and not yet recorded in the plan's HANDOFF.md. |
| `specplane-spec-gaps` | project | Spec gaps found during steps and not yet filed in a spec or `OPEN-QUESTIONS.md`. |

A memory entry that disagrees with the plan files is stale; the plan files win.

---

## `specplane init` output for Claude Code

The Claude harness is set up when `specplane init` is run with `--harness claude`, or when a `.claude/` directory already exists (the detection rule for this harness). In that case `init` additionally writes:

- `.claude/skills/<name>/SKILL.md` for each skill, `.claude/rules/specplane.md`, and `.claude/hooks/*.sh` (mode `0755`). These are Specplane-owned: `init` creates them if absent and overwrites them if they differ from the bundled templates (`Updated <path>`), so re-running `init` after upgrading the CLI updates the harness.
- The registrations via § Settings merge.

It never creates or edits `CLAUDE.md`. It prints one `Created`/`Updated`/`Skipped` line per file (as base `init` does), followed by "Claude Code integration files written to `.claude/`."

If the harness is neither requested nor detected, `init` creates only the base files and prints: "No `.claude/` directory found. To enable Claude Code integration, run `specplane init --harness claude`."

### CLI implementation

Implemented by a plan that depends on the reference CLI core plan (not by the plan that produces the templates):

- `src/harness/index.ts`: a registry of harnesses, each `{ name, detect(root): boolean, install(root, report): void, skillDirs(root): string[], rulesFile: string }` (`skillDirs` feeds `architecture/reference-cli` § Skill contract drift; `rulesFile` feeds its standing-instructions freshness check). `init --harness <name>` with an unknown name exits 1 listing the known names.
- `src/harness/claude.ts`: `detect` = `.claude/` exists; `install` copies the bundled templates (creating absent files and overwriting Specplane-owned files that differ, as above), sets hook scripts executable, and performs § Settings merge.
- The package build copies `harnesses/claude/templates/` to the package's `dist/templates/claude/`; `install` resolves templates relative to the compiled module.

---

## Testing

- `harnesses/claude/tests/hooks.test.sh` (POSIX `sh`, no framework; exits non-zero on any failure) feeds fixture JSON to each hook script with a stub `specplane` placed first on `PATH` (exit code chosen per case) and a temp `CLAUDE_PROJECT_DIR` containing `.specplane/config.yaml`. Pre-commit cases:
  - Blocked (exit 2) when the stub exits 1: `git commit -m x`; `cd a && git commit -am x`; `git -C dir commit`; `git -c user.name=x commit`; `git --no-pager commit`; a two-line command whose second line is `git commit`; `(git commit)`.
  - Allowed (exit 0) when the stub exits 1: `git commit-tree abc`; `echo commit`; `git log --grep commit`; `git status`.
  - Allowed when the stub exits 0; allowed when `specplane` is absent from `PATH`; allowed when `CLAUDE_PROJECT_DIR` has no `.specplane/config.yaml`.
  - Policy guard: for `Write` content and for an existing file with `id: feature/x`, `id: claude:feature/x`, and `id: architecture/x`, under config `llm_role` values `none`, `assist`, `draft`, and the key absent (defaults): `deny`, `ask`, no output respectively. No output for a plan step file, an ADR (`id: decision/0001`), a file without frontmatter, a missing config, and missing `jq`. Every case exits 0.
  - Session context: on branch `plan/x` in a temp git repo with two step files (one `done`), the context names step 02 and `1/2`; all done → mentions `/plan-finish`; off a plan branch → no output; with `CLAUDE_ENV_FILE` set, the file gains the two `export` lines.
  - Status line: the expected line in a plan checkout; empty output elsewhere.
  - Optional hooks: the generate hook runs the stub only for a `PLAN.md` path; the handoff check warns for a commit with `Specplane-Workflow: step` trailers that lacks HANDOFF.md (in a temp git repo), and is silent for other commits. Both always exit 0.
- Settings merge is tested with the CLI (`src/harness/claude.ts`): absent file, invalid JSON, already registered, partial registration, existing `statusLine`.
- The plugin has its own tests (`harnesses/claude/plugin/`, run with `claude plugin test`): mode switching, the `step`-mode edit denials, and pane rows built from a fixture `plan list --json` output.
- `harnesses/claude/tests/check-sync.sh` diffs each file under `templates/` against its installed path in the Specplane repository (per § Template source) and exits 1 listing any difference or missing file. The `settings.json` comparison is a subset comparison, not byte-identical: every registration in the template must be present in the installed `.claude/settings.json`, which may contain further user entries.
- Skill content is checked for drift by `specplane validate` through the contract comment (`architecture/agent-skills#keeping-skills-in-sync-with-specs`); the content itself is still reviewed by hand when a pin goes stale.
