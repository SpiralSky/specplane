---
id: architecture/claude-integration
title: Claude Code integration implementation
status: review
author: mixed
implements: [claude:feature/claude-integration, feature/agent-integration]
based_on: { "claude:feature/claude-integration": "99b0d17", feature/agent-integration: "7720f2a" }
---

<!-- Plan index proposal 2026-11-02: user agreed naming/source semantics and approved the companion feature patch, now applied. Architecture revision awaits review; not implemented behavior. -->


<!-- Architecture reconciliation 2026-11-02: current feature contracts govern this draft revision. Stored lifecycle status and dependency pins are preserved; this edit is not approval or evidence of implementation. -->

<!-- Draft revision 2026-11-02: reconciles the user-approved optional-workflows feature text, completion assessment and shared docs. Existing lifecycle status describes prior approval, not approval or implementation of this architecture revision. -->

<!-- Revision 2026-11-01: extension/core separation and contribution provenance agreed in conversation; existing lifecycle status is unchanged. Implementation and integration review remain pending. -->

<!-- Experimental development amendment 2026-11-01. Existing status records prior approval only; these branch changes await human final review. -->

# Claude Code integration implementation

This spec defines the concrete files and structure that implement the Claude Code harness overlay. It is an architecture spec in the `claude` overlay root. The content of each skill (policy checks, steps, outputs) is defined harness-neutrally in `architecture/agent-skills`; this spec defines how that content is packaged for Claude Code.

---

## Files produced

The extension package is a Claude plugin containing a mod, a bundled copy of the compatible shared core, a plugin MCP server that owns the writer lease (`## Workflow server and writer lease`), shared workflow procedures/contract snapshots, reasoning skills, and policy hooks. `harnesses/claude/plugin/` is the source of the plugin root, not merely an optional pane; `specplane init --harness claude` installs it as `.claude/specplane/`. Repository files below are supporting assets and reasoning fallbacks; a mechanical workflow must not also install a prompt skill under its native command's name. Detect and report legacy name collisions during explicit upgrade rather than silently shadowing one implementation.

Files installed into a target repository:

```
.claude/
  skills/
    specplane-reason-<workflow>/SKILL.md  # reasoning only; distinct from public commands
  rules/
    specplane.md                  # standing instructions (Specplane-owned; overwritten on update)
  hooks/
    specplane-pre-commit.sh       # registered by default
    specplane-policy-guard.sh     # registered by default
    specplane-session-context.sh  # registered by default
    specplane-statusline.sh       # registered only if no status line is configured
    specplane-handoff-check.sh    # optional; installed, not registered
    specplane-generate.sh         # optional; installed, not registered
  specplane/                      # the plugin root; the host loads it as plugin `specplane`
    .claude-plugin/plugin.json    # host manifest; declares the `specplane` MCP server
    hooks/                        # the mod: hooks.json, register.tsx, commands.ts, handlers.ts
    types/index.d.ts              # the host mod declarations the mod is written against
    core/                         # bundled compatible core: specplane-extension.json, inventory,
                                  #   host-evidence/claude-code.json, dist/ (incl. harness/claude-mcp-main.js)
    tsconfig.json                 # written by the host when it loads the plugin; never shipped (see below)
  settings.json                   # hook and status line registration (merged into any existing settings)
.gitignore                        # gains one line, `.claude/specplane/tsconfig.json` (added once; existing lines kept)
AGENTS.md                         # managed block written by base `specplane init`
```

Skills in `.claude/skills/<name>/SKILL.md` provide the reasoning procedures used by the extension. Native handlers own mechanical public commands. The installed set excludes conflicting prompt commands; keep reasoning assets under distinct internal names where necessary. `.claude/settings.local.json` is never read or written.

**User-owned files are not edited.** Specplane never writes `CLAUDE.md`. The paths above except `AGENTS.md` and `.claude/settings.json` are managed assets; refresh replaces unmodified owned bytes. Customized or unrecognized assets are preserved under `architecture/reference-cli#explicit-upgrade-transaction`. `AGENTS.md` changes only inside its managed block (`architecture/agent-skills#delivery`) and `settings.json` only by § Settings merge and the upgrade transaction's removal of recognized obsolete registrations. The host rewrites `.claude/specplane/tsconfig.json` each time it loads the plugin. The installer therefore does not ship that file and adds it to the repository's `.gitignore`, so the host's rewrite cannot dirty the checkout baseline that workflow requests are bound to. `.gitignore` is otherwise user-owned: the installer appends its one line when missing and reports `Updated .gitignore (ignores .claude/specplane/tsconfig.json)`.

Repository content can deliver fallback skills and settings hooks. A cloud/headless session must separately verify that the extension package, mod, core, and required APIs are available. Do not infer extension availability from `.claude/`. A missing mod disables native command dispatch, not manual CLI operations; UI features are optional and surface-dependent.

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
  plugin/                         # source of the installed plugin root (`.claude/specplane/`)
    .claude-plugin/plugin.json    #   host manifest and MCP server declaration
    hooks/                        #   the mod (hooks.json, register.tsx, commands.ts, handlers.ts)
    types/index.d.ts              #   host mod declarations
                                  #   The bundled core is not stored here: the CLI build copies it from
                                  #   `packages/cli` into the package it stages as `.claude/specplane/core/`.
  tests/
    hooks.test.sh                 # hook script tests (see § Testing)
    check-sync.sh                 # template ↔ dogfood copy check
```

Paths under `templates/` mirror their install paths under `.claude/` (`templates/skills/specplane-reason-plan-step/SKILL.md` → `.claude/skills/specplane-reason-plan-step/SKILL.md`; `templates/rules/specplane.md` → `.claude/rules/specplane.md`). Templates contain no placeholders: skills and hooks resolve every path from config at run time (`architecture/agent-skills#config-resolution-in-skills`), so the same bytes work in every repository.

The CLI package bundles `harnesses/<name>/templates/` at build time (see § `specplane init` output). The Specplane repository dogfoods the harness: its own `.claude/skills/`, `.claude/hooks/`, and `.claude/rules/specplane.md` are byte-identical copies of the templates, enforced by `check-sync.sh`. Its `CLAUDE.md`, if any, is the maintainers' own file.

---

## Standing instructions (`.claude/rules/specplane.md`)

Claude Code loads every file in `.claude/rules/` at session start (a rule without `paths:` frontmatter applies to the whole session), so this file delivers the standing instructions without touching `CLAUDE.md`. It has no `paths:` frontmatter: the rules must hold before Claude touches any spec file.

`templates/rules/specplane.md` is the canonical standing text (`architecture/agent-skills#standing-instructions`, the release contract version) followed by a short Claude Code section. Advance managed-text metadata when delivering the revised orientation; keep it compact without omitting the conceptual distinctions:

```markdown
<!-- specplane:standing v<N> — installed by `specplane init --harness claude`; overwritten on update -->
<standing instructions text, with this Workflows line:>
- **Workflows**: `/spec-assist`, `/spec-draft-architecture`, `/plan-create`, `/plan-step`, `/plan-finish`, `/validate`, `/approve`, `/plan-start`, `/decision-new`, `/plan-status`, `/plan-abandon`.

### Claude Code
- Read spec and plan files with `Read` (offset/limit for large specs); find files with `Glob`.
- HANDOFF.md is the source of truth for plan progress; memory is only a pointer to it.
- In a plan checkout, session context names the plan and next step; when managed plan execution is invoked, work only on that step. Ordinary work remains available.
- Managed workflow commits: include reported `Specplane-Agent` and `Specplane-Session` context when available. Ordinary commits require no Specplane trailers; environment variables do not opt a task into a workflow.
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

The body restates the reasoning phase of the contract from `architecture/agent-skills` and adds only Claude Code–specific detail. It must not change policy. Native handlers parse arguments with a defined token grammar (quoted strings and explicit flag values, no shell evaluation), reject unknown flags and missing values, and pass validated arguments in the structured request. Free text and paths are never reconstructed by whitespace splitting. A reasoning-only fallback receives `$ARGUMENTS`, applies the same grammar through the bundled runner or CLI, and never treats prompt text as a human confirmation. Skills whose contract has no policy check write "None." under `## Policy check`.

The `plan-step` and `plan-finish` skills write and read `<plans.dir>/<plan-id>/spec-gaps.md` exactly as `architecture/agent-skills` defines it; the gap record is harness-neutral, so no Claude-specific file or command is involved, and a proposal is a `spec-gaps.md` `proposal` entry rather than a `feature-spec-proposals.md` file.

### Workflow reasoning frontmatter and Claude Code detail

The table names workflow contracts, not a requirement to install public prompt commands. Only reasoning phases get an internal `specplane-reason-<workflow>` skill. Native handlers own all public workflow command names; mechanical workflows have no reasoning skill. Confirmation is collected by host code, not delegated to a model. Historical skill-specific invocation flags below apply only to reasoning assets and fallback delivery.

Invocation controls apply to the delivered reasoning assets, not native commands. A user-only fallback skill may use `disable-model-invocation: true`. An internal reasoning asset invoked by the extension's agent workflow must remain accessible through that supported invocation path; do not hide it from the very agent expected to load it. The native handler enforces user authorization and mechanical preconditions independently of skill visibility.

| Skill | `argument-hint` | `disable-model-invocation` | Claude Code detail |
|-------|-----------------|----------------------------|--------------------|
| `spec-assist` | `[topic]` | `false` | Never uses `Write`/`Edit` on a feature spec without the user's explicit approval of the exact change. |
| `spec-draft-architecture` | `[feature-spec-id ...]` | `true` | Writes the draft with `Write`; lists GAP markers in the output. |
| `plan-create` | `[goal]` | `true` | Uses `AskUserQuestion` for the slug, spec, and dependency choices when available. |
| `plan-step` | `[plan-id] [--unattended]` | `true` | Session-mode detection (below); subagent execution when the step sets `use_subagent: true`; writes `spec-gaps.md` entries with `Write`/`Edit` and lists their IDs in HANDOFF.md. |
| `plan-finish` | `[plan-id]` | `true` | Agent assesses acceptance evidence and explains gaps; the native handler collects confirmation and executes the validated finish operation. |
| `validate` | — | `false` | Read-only; may run whenever validation results are relevant. |
| `approve` | `<id>... [--reopen]` | `true` | Runs `spec approve`, `plan approve`, or `decision accept` by resolved kind; shows each refusal with its fix; never edits `status` itself. |
| `plan-start` | `[plan-id]` | `true` | Runs the start flow; when the backend is a worktree, tells the user to open a new session in the checkout it reports. |
| `decision-new` | `[title]` | `true` | Creates the record with `specplane decision new`; writes the body only from the user's description; leaves `status: proposed`. |
| `plan-status` | — | `false` | Read-only (`specplane plan list --live`); may run whenever plan state is relevant. |
| `plan-abandon` | `[plan-id]` | `true` | Confirms with `AskUserQuestion`; asks before deleting the branch. |

**Invocation rule.** The table's flags describe user-only fallback skills; internal reasoning assets use the visibility needed by their supported host invocation. Neither flag grants permission to mutate, approve, finish, merge, or spend quota. Mechanical `approve`, `plan-start`, `plan-status`, and `plan-abandon` contracts have native handlers and no reasoning skill; their table rows describe operation behavior only. Hiding a fallback skill does not hide the manual CLI.

### Shared preamble (`## Preconditions`)

Repository workflow skills begin with the following checks. Documentation handlers and conceptual docs lookup bypass repository/config checks and access their bundled core directly:

1. **Specplane configured**: if `.specplane/config.yaml` does not exist at the repository root (an `AGENTS.md` alone does not count; many repositories have one without Specplane), say "This repository is not set up for Specplane. Run `specplane init --harness claude`." and stop (`feature/agent-integration`: skills are no-ops without Specplane).
2. **Core availability**: native handlers use their bundled compatible core, independently of a global `specplane` on PATH. Missing/incompatible core disables the handler before mutation; never hand-edit plan records as an emulation of deterministic dispatch. Reasoning-only fallback sessions may use a verified standalone CLI. If neither is available, report the limitation and offer explicitly labeled manual instructions without claiming that checks or native commands ran.

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

`.claude/hooks/specplane-policy-guard.sh` enforces `specs.<type>.llm_role` at the moment Claude edits a spec, and keeps approval with the human, so policy does not depend on the model remembering an instruction. PreToolUse, matcher `Edit|MultiEdit|Write|NotebookEdit`.

1. No-op (exit 0) without `.specplane/config.yaml` or `jq`.
2. Spec type: read the frontmatter `id:` of the target — from `.tool_input.content` for `Write`, else from the file at `.tool_input.file_path` (`.tool_input.notebook_path` for `NotebookEdit`; first `---` block only). The type is the ID's prefix when it is `feature/` or `architecture/` (an optional `<root>:` qualifier is stripped).
3. **Approval check**, before the type-based early return, comparing parsed preimage and reconstructed postimage top-level status only: when the target is a spec, a `PLAN.md` or step file (`<plans.dir>/<id>/PLAN.md`, `<plans.dir>/<id>/steps/*.md`), or an ADR (`<decisions.dir>/NNNN-*.md`), and the edit sets `status: approved`, `status: ready`, or `status: accepted`, deny: `permissionDecision: "deny"`, reason `Approval is the user's decision: run /approve <id> instead of editing status.` The new text is `.tool_input.content` for `Write`, each `.edits[].new_string` for `MultiEdit`, and `.tool_input.new_string` for `Edit`; a new file written with one of those statuses is denied the same way, and an edit that leaves the status unchanged is not affected. This check applies under every `llm_role`, including `draft`.
4. Targets that are not specs, plans, or ADRs → exit 0. A spec's type comes from its own ID, so no spec root needs resolving.
5. `llm_role`: obtain `specs.<type>.llm_role` from the shared config loader; default `assist` for `feature`, `draft` for `architecture`. Invalid config produces a diagnostic rather than being treated as a permissive unknown role.
6. First reconstruct the complete proposed document and compare parsed top-level lifecycle status and body with the preimage. Nested `implementation.status` is not review status. A metadata-only implementation declaration leaves body authorship unchanged and does not require spec-body approval; preserve normal host permissions and explicit user intent. Unknown/invalid structures are reported rather than guessed. For body edits, apply the configured role, printed as PreToolUse JSON on stdout with exit 0:
   - `none` → `permissionDecision: "deny"`, reason `Policy (specs.<type>.llm_role: none) forbids editing <type> spec bodies. Tell the user instead.`
   - `review` or `assist` → `permissionDecision: "ask"`, reason `Policy (specs.<type>.llm_role: <role>): the user must approve this exact edit.` The user sees the edit and decides; in a non-interactive session the ask cannot be granted, which blocks the edit as intended.
   - `draft` → exit 0 with no output (normal permission handling); unknown roles are config errors, not permission to write.

Use the compatible core's parser and policy evaluator for document reconstruction, configured roots and defaults; do not mistake a regex match of a nested status for a lifecycle transition. A whole-file Write preserving `status: approved` is not a new approval. The guard does not see edits made through `Bash` (`sed -i`, redirection); the standing instructions cover those. It complements `spec-assist`'s approval rule rather than replacing it.

### Session context (enabled by default)

`.claude/hooks/specplane-session-context.sh` gives a session that starts in a plan checkout its scope, so a fresh session in a worktree or a cloud run knows which plan and step it is on without loading anything else. SessionStart (all sources).

1. No-op without `.specplane/config.yaml`.
2. If `CLAUDE_ENV_FILE` is set, append shell-quoted `export SPECPLANE_AGENT=claude-code` and, only when actually reported, `export SPECPLANE_SESSION=<session_id>`, so the CLI and the agent's commits carry the `architecture/file-formats` §8.2 context trailers. These variables describe session context only; they are not the contribution ledger and a startup model never identifies every later action.
3. If the current branch is `plan/<id>`: find the plan folder (`<plans.dir>/<id>`, plans dir read as in the handoff check), read each step file's `step`, `title`, and `status`, and print `hookSpecificOutput.additionalContext`:
   `Specplane: this checkout is plan <id> (branch plan/<id>). Steps done: <d>/<n>. Next step: <NN> <title> (<status>). Run the available plan-step entry point to execute it; managed execution works on that step only. This context does not prohibit ordinary work. Open blockers: <count of BLOCKED: lines in HANDOFF.md>.`
   When every step is done: `… All steps are recorded done/skipped; request plan-finish to verify readiness.` Resolve target lifecycle through the core before recommending execution; shelved, abandoned, pending-retarget and ambiguous contexts show recovery/inspection guidance instead. No startup hook starts or finishes a plan.
4. Otherwise print nothing.

The mod's action capture supplies `architecture/file-formats#capture-and-event-transport`: correlate each spec edit/review with the host's action-time model and native session evidence, including subagent observations. Use the installed host declarations to verify the relevant tool/turn/session fields; `$.session.model` queried at the end of a turn alone cannot prove which model made an earlier edit. When action-time identity is unavailable or switches cannot be correlated, emit unknown identity and an incomplete-capture notice. The startup hook must not overwrite prior events. Capture/deduplication, corrections, and commit trailer emission run through the shared core.

### Status line (registered if none is configured)

`.claude/hooks/specplane-statusline.sh` is a `statusLine` command. It reads `workspace.current_dir` from the stdin JSON and prints one line, or nothing outside a plan checkout:

`◆ <plan slug> · step <NN>/<n> <title, truncated to 30> · <status>` with `⚠ blocked` appended when the next step is `blocked`.

It uses a read-only bundled-core query over local/fetched refs, without network calls, so it stays fast under Claude Code's refresh rate and honors target-side shelving/abandonment. Show a freshness/unavailable-context label rather than promising that stale step files are executable. Users who already have a status line keep it; the script header shows how to call it from their own.

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
| `specplane-generate.sh` | `PostToolUse` / `Edit\|Write` | If `.tool_input.file_path` ends in `/PLAN.md` and `specplane` is installed, run `specplane plan index --source working`, sending its output to stderr. Always exits 0. |

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

When managed plan execution is invoked, an agent session works on **one plan, and within it one step at a time**. The following rules scope that workflow; other sessions and ordinary work on arbitrary branches need no plan:

| Where the session runs | How it is scoped | How others see its progress |
|------------------------|------------------|-----------------------------|
| Local worktree (`execution.backend: worktree`) | Started in `<worktree_dir>/<repo>/<plan-id>/`; § Session context names the plan and next step; `/plan-step` refuses to run off the plan branch | Shared local refs: the main checkout sees `plan/<id>` immediately |
| Subagent (`use_subagent: true`) | Gets only the step's paths (§ Subagent step execution) | Its commit on the plan branch |
| Cloud session or other machine (`external`, or any session with an `origin/plan/<id>` upstream) | Checks out `plan/<id>`; follows the shared procedure through the extension or reasoning fallback supported on that surface. Verify package, hook, and native-command availability separately. | `plan-step` pushes `plan/<id>` after each step commit (`architecture/agent-skills` § plan-step, step 10) |

Rules:

- **One writer per plan.** Steps are sequential, so two sessions never work on the same plan at once. `plan-step` fetches the plan branch first and stops if it has diverged (`architecture/agent-skills` § plan-step, step 1). Parallel work happens across plans, each in its own checkout.
- **Fresh context per step.** Prefer a new session (or a subagent) per step over one long session: the step file, HANDOFF.md, and § Session context carry everything the next step needs.
- **Commits identify the run.** Every step commit carries `Specplane-Agent` and, from § Session context, `Specplane-Session`, so the live view and `git log` show which session made which step even when several machines push to the same repository.
- **Cloud sessions are unattended** (§ Session mode): a new body edit under `assist` requires valid exact-text human authorization; without it the edit is blocked. Metadata-only completion declarations remain distinct. Contradictions during managed execution become `BLOCKED:` items.

---

## Live view and Specplane mode (optional plugin)

This historical heading is retained for existing plan anchors. Optionality refers to the UI features below; the mod is the primary command-dispatch mechanism.

`harnesses/claude/plugin/` is the extension package with a mod hooks module. Its pane and mode display are optional conveniences; deterministic commands do not require a pane. A repository may recommend the package through `.claude/settings.json` (`extraKnownMarketplaces`, `enabledPlugins`); installation/enablement is explicit and never inferred from a directory. Cloud/headless support follows the host's actual package delivery and API availability, with text output when drawing is unavailable.

### Data source

The plugin never keeps its own copy of plan state. It invokes its bundled core's equivalent of `specplane plan list --json --live` (`architecture/reference-cli` § Plan activity) every 60 s, with `--no-fetch` except on every fifth run, and immediately after a `git commit` or `git push` tool call in the session. Without the CLI it shows only the current checkout's plan, read from its step files.

### Plans pane

A pane titled **Specplane** beside the chat, opened with `/specplane`:

- One row per plan that is `in_progress` or `review`, or that has a branch (shelved plans remain visible with a `shelved` label and are excluded from active-execution counts): plan slug and recorded target; starting commit and optional comparison baseline on expansion; stored/effective status and integration evidence (including done awaiting merge); where it runs (worktree path, `remote` when only `origin/plan/<id>` exists, `external`); `step <done>/<total>` and the next step's title; age of the last step commit with its `Specplane-Agent` and a short `Specplane-Session`; `⚠ <n> blocked` from `blocked_issues`; `↑<n>` when `ahead_of_remote` > 0.
- Selecting a row expands its blocked issues and the next step's acceptance criteria. For a shelved plan, show the explicit `specplane plan resume <id>` command instead of an execute-step action; no selection or refresh resumes work. Buttons copy the command to continue in that checkout (`cd <checkout> && claude /plan-step`), or put `Read <HANDOFF.md path>` into the prompt. In a non-interactive session (`claude -p`), where the prompt cannot be filled, the second button is labelled "Copy HANDOFF path" and copies the path instead.
- The pane is read-only: it never starts, finishes, or edits plans.

### Specplane mode

The plugin keeps a session mode, shown in the status area and switched with `/specplane-mode <step|spec|off>`:

| Mode | Set automatically when | Effect |
|------|------------------------|--------|
| `step` | the session starts on a `plan/<id>` branch | Shows the next managed step (plan, target, step file, HANDOFF.md path, acceptance criteria). During an invoked managed step, scope enforcement denies edits outside that checkout or to other steps' administrative files; core owns recording. Automatic mode display alone does not require all work to be a plan step or prohibit explicitly requested manual declarations. Return to off for ordinary work. A band above the prompt shows `step NN: <title> · criteria <checked>/<total>`, refreshed when the step file changes. |
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

The prompt passes **paths**, not file contents; the subagent reads them itself, so the parent never loads them. The parent performs preparation and resolves context before launching; the worker receives the structured request and loads its named context (step 3). The subagent returns structured acceptance, gap, expansion and contribution evidence to the worker-side extension/core, which validates and records the step's HANDOFF/status/commit. It returns a recording receipt plus summary to the parent, rather than asking the parent model to infer success. The worker does not push: the parent extension publishes that receipt's commit (`plan-step` step 10), when required. A failed publication is retried without redoing implementation. The parent reports the summary without loading the step's diff; deterministic validators still inspect actual changes. The parent runs one subagent at a time. Cancellation must stop the worker before another writer acquires its lease.

A subagent cannot ask the user questions mid-step, so subagent steps always run in unattended mode for contradiction handling (see `feature/spec-precedence`).

---

## Memory integration

The memory names are recommendations from `claude:feature/claude-integration` (OQ-5, resolved); Specplane never enforces or validates them.

Skills never read or write Claude Code memory; HANDOFF.md and the plan files remain the source of truth. When a user or agent chooses to record Specplane state in memory, the recommended entries are:

| Memory name | Type | Content |
|-------------|------|---------|
| `specplane-active-plan` | project | Active plan ID, checkout path, and the last completed step number. Points to HANDOFF.md for details. |
| `specplane-open-questions` | project | Open questions found during steps and not yet recorded in the plan's HANDOFF.md. |
| `specplane-spec-gaps` | project | Spec gaps found during steps and not yet recorded in the plan's `spec-gaps.md`. Memory is only a pointer and never replaces the required gap record. |

A memory entry that disagrees with the plan files is stale; the plan files win.

---

## `specplane init` output for Claude Code

The Claude harness is set up only when `specplane init --harness claude` is explicitly requested. Detection of `.claude/` is inventory/validation evidence, not installation or execution selection. That explicit operation prepares the versioned extension package and reports the separate host installation/enablement steps; it never enables a global host package as a side effect. It writes supporting repository assets:

- Internal reasoning skills, `.claude/rules/specplane.md`, and `.claude/hooks/*.sh` (mode `0755`). Refresh uses `architecture/reference-cli#explicit-upgrade-transaction`: replace unmodified owned assets, preserve customized files, and retire recognized legacy public prompt skills only when the replacement is ready. Conflicts are reported with exact paths and disable the affected native name until resolved.
- The plugin root `.claude/specplane/` (manifest, `hooks/`, `types/`) and the bundled core at `.claude/specplane/core/`, staged through the same transaction. Preserved core files that no longer match the package inventory make the MCP server refuse preparation until they are reconciled; the manual CLI remains available.
- The `.claude/specplane/tsconfig.json` line in `.gitignore` (`### Files produced`).
- The registrations via § Settings merge.

It never creates or edits `CLAUDE.md`. It prints one `Created`/`Updated`/`Skipped` line per file (as base `init` does), followed by "Claude Code integration files written to `.claude/`."

Without explicit selection, `init` creates only base files and reports neutral initialization, regardless of detected harnesses.

### CLI implementation

Implemented by a plan that depends on the reference CLI core plan (not by the plan that produces the templates):

- `src/harness/index.ts`: a registry of harnesses, each `{ name, detect(root): boolean, install(root, report): void, skillDirs(root): string[], rulesFile: string }` (`skillDirs` feeds `architecture/reference-cli` § Skill contract drift; `rulesFile` feeds its standing-instructions freshness check). `init --harness <name>` with an unknown name exits 1 listing the known names.
- `src/harness/claude.ts`: `detect` = `.claude/` exists (inventory only); `install` validates and stages the selected package/templates through the shared upgrade transaction, sets hook scripts executable, and performs § Settings merge. No adapter is selected by this inventory.
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
  - Optional hooks: the generate hook passes `plan index --source working` to the stub only for a `PLAN.md` path; the handoff check warns for a commit with `Specplane-Workflow: step` trailers that lacks HANDOFF.md (in a temp git repo), and is silent for other commits. Both always exit 0.
- Settings merge is tested with the CLI (`src/harness/claude.ts`): absent file, invalid JSON, already registered, partial registration, existing `statusLine`.
- The plugin has its own tests (`harnesses/claude/plugin/`, run with `claude plugin test`): mode switching, the `step`-mode edit denials, and pane rows built from a fixture `plan list --json` output.
- The workflow server is tested without a host: `claude-mcp.test` (bind and nonce rules; compact `prepare`; `detail` paging; `validate` by `requestId`; `close` with and without `requestId`; the 16 KB bound asserted per reply on a realistic fixture; cancellation of an undeliverable `prepare`; the test-requirement refusal), `claude-handlers.test` (origin gate allow and deny; completion tool attempt limit; result template validates against `workflowResultSchema`; the interim rule appears only for the four writing workflows; close on lost prepare, unreadable detail or unreadable result; the `close` wording), `claude-package.test` and `harness.test` (plugin root staging; the `.gitignore` entry). Added with D17 A: parked-challenge confirmation cases (confirm, decline, dismissed, expired, mismatched id, replay). Added with D16 A: unknown `suiteId` refusal, and a check that no model-supplied executable reaches the runner. Added with the recovery command: dead and live owner, mismatched records, no terminal, `--dry-run`.
- Live checks are separate from these tests and each needs the user's fresh approval (`### Host evidence`).
- `harnesses/claude/tests/check-sync.sh` diffs each file under `templates/` against its installed path in the Specplane repository (per § Template source) and exits 1 listing any difference or missing file. The `settings.json` comparison is a subset comparison, not byte-identical: every registration in the template must be present in the installed `.claude/settings.json`, which may contain further user entries.
- Skill content is checked for drift by `specplane validate` through the contract comment (`architecture/agent-skills#keeping-skills-in-sync-with-specs`); the content itself is still reviewed by hand when a pin goes stale.

## Deterministic command dispatch

The installed plugin root (`.claude/specplane/`) contains `.claude-plugin/plugin.json`, `hooks/hooks.json` with `modules: ["./register.tsx"]`, and `hooks/register.tsx` exporting `register(on, options)`, plus `types/` with the host mod declarations. The manifest also declares the `specplane` MCP server (`## Workflow server and writer lease`). The bundled core at `.claude/specplane/core/` carries `specplane-extension.json`, its build inventory and the procedure and contract snapshots. The host manifest identifies the plugin; the separate Specplane manifest validates core/procedure compatibility before registration. Host installation/enablement is an explicit plugin operation; repository initialization reports prepared assets and remaining host steps instead of claiming the mod is loaded.

Use the supported Claude mod API, rather than prompt interception, for public command dispatch. In `session.start`, call `$.command.register`; handle each name with a filtered `command.run` handler. Mechanical handlers parse arguments, call the bundled core, and return `{ text }` without a model call or delegation to the default prompt path. Register only non-built-in names, report collisions, and keep handlers unavailable if required APIs are missing. Stateful operations use the shared locks and revalidate plan state; optional immediate execution must not race a plan writer.

Reasoning commands call the server's `prepare` through the mod, read the request in `detail` pages, and explicitly invoke the installed reasoning procedure through the verified host turn/tool mechanism. The commands are registered only when the native reasoning path is enabled; while it is disabled, the reasoning commands and the completion tool are not registered and the legacy reasoning skills keep their names. After agent work, core validators check the structured outcome and actual repository state before step recording. Human approvals use the host's explicit user interaction and the core's approval transition; model-generated text is never approval evidence. Agent-invoked tools call the same validated operations but cannot manufacture a user command or an approval.

The delegation path is `$.prompt.submit({text})` with the prepared request and the internal reasoning asset's path, followed by the mod-registered completion tool `specplane_result`, which accepts `{requestId, result}` with `WorkflowResult`. Never use `asUser: true`: extension-origin input must retain its origin and cannot confer human authorization. The command hook schedules the submit with `$.clock.after`, with `turn.complete` as a backstop, because a hook cannot submit and a command that raises no model turn raises no `turn.complete`; the procedure therefore starts from the command alone. Do not await submission while a host turn is active; retain request state and validate the matching result when the turn completes. A refused submission, abandoned event, or missing completion capability closes the request and its lease rather than falling through to the default prompt handler. Wire `next.signal` and host interruption to shared cancellation; stop unacknowledged workers before releasing locks. Exact tool registration and prompt/result signatures are compiled against the installed declarations and tested per surface before enabling this path.

**The prompt.** The prompt is extension-origin text, not an approval. It carries the prepared request and the completion tool's name. It also carries a schema-valid `WorkflowResult` built from the request: its `requestId`, `baseDigest` and one `criterionEvidence` entry per criterion filled in, `outcome: "blocked"` and every assessment `unmet`, so a template sent back unchanged claims nothing. It tells the model to replace the template's text, to give a `BLOCKED:` line in `openIssues` for a blocked outcome, and to call the completion tool even when it cannot finish, so the request always closes. The core's schema refusal names the first failing field and never echoes its value.

**Interim rule for workflows that would write text.** While finalised content cannot be confirmed through the mod (`### Confirming finalised content` is not delivered and live-checked), the prompts for `spec-assist`, `spec-draft-architecture`, `plan-create` and `decision-new` carry this rule, and this overrides any procedure step that returns a body: *"This request cannot create a file or bind finalized text, and this overrides any procedure step that returns a body: leave out `creation` and `finalizedEdits`, give the user the approved text in your reply, report `blocked`, and name the manual command."* The implementation constant is `MANUAL_WRITE_RULE`. The rule is removed when the confirmation path lands.

**Attempt limit.** A request accepts at most 3 result submissions. A refusal with code `INVALID_EVIDENCE` is correctable and changes nothing in the core, so the request stays open and the reply says how many attempts are left. Any other refusal, a lost call, a `record` refusal, or the third `INVALID_EVIDENCE` ends the request, releases its lease, and tells the model to rerun the command. The completion tool's reply says the requests were closed only when `close` succeeded.

**Recording.** `record` is live-checked for a blocked result only: validate, record, receipt and lease release ran. A `done` result, a commit and a written spec have not been run live.

The interaction port is the mod's direct human UI operation, `$.ui.ask` with the core challenge's exact summary and the choices `Confirm` and `Cancel`. If that operation is unavailable, or the ask is dismissed or rejected (for example under `claude -p`, where no one can answer), mechanical read-only commands still work, confirmation-requiring transitions refuse with manual CLI instructions, and a request that needs confirmation ends as `blocked`. Agent tool calls cannot submit confirmation responses: the server accepts a confirmation only through the mod's authenticated, origin-checked call. Query the command inventory before registering; if a built-in or customized prompt owns a name (including `/approve` on any surface where it is host-owned), leave that Specplane handler unavailable and report the manual command. Catch each registration failure separately so one collision does not skip unrelated registrations. Do not silently introduce aliases or shadow built-ins. The full confirmation protocol is in `### Confirming finalised content`.

`PreToolUse`/mod tool hooks enforce policy around agent tools; they are not command dispatchers. Direct user slash commands and agent Skill invocations have different paths and are tested independently. Capture model identity at each contributing action, preserving all models across switches instead of attributing all edits to the final model.

**Origin gate.** The mod's `tool.check` handler is the gate for the workflow server's tools. It answers `allow` for a call the host reports as originating from this plugin (`next.origin.plugin` is `specplane`) and `deny` for every other caller, even one that holds the nonce, with the reason that Specplane workflow tools are reserved for Specplane commands. A model's call reads `engine`/`core` origin. The completion tool `specplane_result` is the model's and passes through to the host's normal permission handling. The gate fails closed: a throwing check refuses. Answering `allow` itself also avoids two host behaviors seen live: under auto mode the classifier refused the mod's own call with no verdict, and in default mode every mod call showed a permission prompt carrying all arguments, including the nonce.

Compatibility is checked against the installed host's mod declarations and named tested versions. Documentation establishes the design, not live implementation compatibility. Tests must assert zero model calls for mechanical handlers, direct text results, explicit reasoning delegation, collision handling, missing-API refusal, approval interaction, and headless behavior.

Design sources inspected 2026-11-01: [Mods overview](https://code.claude.com/docs/en/plugins/mods/overview), [Add a command](https://code.claude.com/docs/en/plugins/mods/api#add-a-command), and [Mods reference](https://code.claude.com/docs/en/plugins/mods/reference). These sources informed the target mod design; current host support still requires the installed-declaration and live-version checks above. No source citation certifies an active dispatcher.

**Host evidence.** Recorded runs against Claude Code 2.1.317 are under `harnesses/claude/host-evidence/2.1.317/`: the plugin loaded and its server started from `.claude/specplane/core` with `${CLAUDE_PLUGIN_ROOT}` expanded; an interactive check showed the lease held across calls by the server and released by `close`; the origin gate ran `bind`, `prepare` and `detail` in auto and default mode with no classifier refusal and no prompt; a blocked result was validated, recorded and closed. Not shown live: a `done` result, a commit, a written spec (D17), the D24 prompt, and native macOS or Windows. Each live run is a separate, user-approved operation and is never retried.

## Workflow server and writer lease

The plugin manifest declares one MCP server, `specplane`. The host starts it from the bundled core with `node ${CLAUDE_PLUGIN_ROOT}/core/dist/harness/claude-mcp-main.js`, and lists it as `plugin:specplane:specplane`. Its tools appear to the model as `mcp__plugin_specplane_specplane__<tool>`. The server hosts one persistent protocol-1 workflow runner (`architecture/reference-cli`). **The runner, not the mod and not the model, owns the writer lease** from `prepare` until the request is recorded, cancelled or closed. The lease is held across tool calls for the life of the server process; the mod never takes, adopts or releases a lease itself.

The checkout is `SPECPLANE_CHECKOUT` when set, else the working directory, and must be an absolute path. Compatibility comes only from the installed package: its `specplane-extension.json` and `host-evidence/claude-code.json`. If either is missing or unreadable, every `prepare` is refused as incompatible and the manual CLI remains available.

**Binding.** The mod generates a nonce of at least 16 characters and calls `bind` once per session. Every other tool call repeats it; a second `bind`, a missing nonce or a mismatching nonce is refused. The nonce is a second check behind the origin gate (`## Deterministic command dispatch`, origin gate), never the only one.

**Tools.** Every tool except `bind` needs the nonce.

| Tool | Effect |
| --- | --- |
| `bind` | Binds the session once. |
| `inspect` | Reports a prepared or recorded request. |
| `prepare` | Prepares a request and takes the writer lease. The reply is compact: `requestId`, `workflow`, `status`, `detailChars`. The full request stays in the server. |
| `detail` | Returns one page of the prepared request, selected by `requestId` and `offset`. A page is at most 2048 characters of the serialized request; the reply gives `total`, `next` and `done`. |
| `executeTest` | Runs the reviewed suite for a prepared request with a host-fixed command (`### Reviewed test suites`). |
| `validate` | Takes `requestId` and the `WorkflowResult`. The server validates against the request it holds for that id; the request is never sent back. A request that is not open is refused. |
| `record` | Records a validated result. When the core needs the user's confirmation, see `### Confirming finalised content`. |
| `capture` | Captures a proposed contribution. |
| `cancel` | Cancels one request by `requestId` and releases its lease when the workers are proven stopped. |
| `close` | With `requestId`, releases that request's lease. Without it, closes every open request of the session and reports `closed` and `failed` ids; none is dropped silently. |

**Reply bound.** No reply exceeds 16 KB, the host's MCP result limit. A reply that would is not delivered; for `prepare` the server also cancels the request and releases its lease, because nobody could close a request they never received.

**Closing.** `close` releases the lease. The mod closes a request when the result is recorded, when the result or a later refusal ends the request, when the prepare reply or its `detail` pages cannot be read, and when the completion result cannot be read. A request ended by an `INVALID_EVIDENCE` refusal that is still correctable stays open (`## Deterministic command dispatch`, attempt limit). A released request leaves no lease behind, which a live run confirmed for a blocked result (host evidence, `origin-gate-check.txt`, "Recording check").

**Session end.** On disconnect the server cancels pending work and releases every lease it can prove released. A worker that is not proven stopped keeps its lease and the server exits non-zero. That state needs `### Recovering a lease left by an ended session`.

**Plugin hooks and managed settings (D11).** Under `allowManagedHooksOnly` a user-tier plugin loads no hooks, so the mod would not run. The accepted position is that the plugin ships at user tier and that this limitation is documented rather than worked around. The alternative, shipping as a managed plugin, was not chosen.

### Reviewed test suites

A plan step whose criteria carry `testRequirements` needs the reviewed suite to run. The server never runs an executable or arguments that the model, or any text from a prepared request, supplies. `executeTest` takes only `requestId` and `criterionIds`. The server resolves each required `suiteId` to a command in a suite table bundled in the extension package and installed with the core (`.claude/specplane/core/`), runs it with the checkout as working directory and without a shell, and passes the report back to the core for assertion matching exactly as `architecture/reference-cli` defines. An unknown `suiteId` is refused, and the request is cancelled and its lease released.

The model starts a run through the mod-registered tool `specplane_run_tests`, whose only input is `requestId`. The mod calls `executeTest` and returns the receipt reference for the model to cite in `criterionEvidence[].artifacts`. A receipt the core did not produce is not evidence.

Until this path is delivered and live-checked, the server cancels a prepared `plan-step` whose criteria carry `testRequirements`, releases its lease, and says to run the step through the managed plan-step flow.

Alternatives considered to the bundled suite table and the `specplane_run_tests` tool: a new config key naming each suite's command (needs a base configuration spec change), or reuse `plans.test_command` (a shell string, so it cannot name one suite).

### Confirming finalised content

A result that carries `finalizedEdits` or `creation` needs the user's confirmation before the core writes anything. The core confirms inside the server process, which has no screen, so the response crosses the server boundary through one protocol field.

- **Field.** `record` accepts an optional `confirmation`: the core's `ConfirmationResponse`, exactly `{challengeId, decision, interactionId}` with `decision` either `confirm` or `decline` and `interactionId` a fresh identifier the mod generates for each dialog. No other tool accepts it.
- **Flow.** The mod calls `record` with the validated proposal. The core builds its challenge; the server parks the core call at its interaction port and replies to the mod with `ok: false`, code `CONFIRMATION_REQUIRED`, and the challenge (`challengeId`, `targets`, `summary`, digests, `expiresAt`) in `error.details.challenge`. The mod shows `challenge.summary` unmodified in `$.ui.ask(summary, ['Confirm', 'Cancel'])`. The mod then calls `record` again with the same proposal and `confirmation`. The server matches `challengeId` to the parked challenge, hands the response to the core, and the core finishes or refuses.
- **Rules.** The server accepts `confirmation` only for a challenge it has parked for that `requestId`, once, and only until the challenge's `expiresAt`. A `decline`, a dismissed or rejected dialog, an expired challenge, a mismatched `challengeId`, a `cancel` or a `close` ends the parked call as a refusal; nothing is written and the request is closed. The mod never answers its own dialog; the model's text is never a response.
- **Trust.** The response is trusted as direct-human only because it arrives through the nonce-bound, origin-checked mod call (`## Deterministic command dispatch`, origin gate). Removing the nonce later needs a server protocol change, so the nonce stays.
- **After confirmation** the interim rule in `## Deterministic command dispatch` is removed, and the four writing workflows may return `creation` and `finalizedEdits`. Lifecycle approval remains a separate operation: this confirmation never approves a spec.

Alternative considered to the field `confirmation` and the two-call flow: keep one parked `record` call and add a `confirm` tool that carries the response.

### Recovering a lease left by an ended session

If a Claude session ends while a request is open (the terminal is closed, the host is killed, the model never calls the completion tool and `close` does not run), the writer lease stays held with host-worker evidence. Nothing releases it silently: the core reclaims such a lease only after trusted proof that the prior worker stopped, and a dead owner process is a necessary condition, not that proof.

Recovery is an explicit user operation on the CLI, which has no model turn:

```
specplane workflow list [--json]
specplane workflow recover <request-id> [--dry-run] [--json]
```

- `workflow list` is read-only. For each lease retained with host-worker evidence in this repository it prints the request id, owner process id and whether that process is alive, the lease age, the checkouts, and the recovery state. It never mutates.
- `workflow recover` refuses unless the owner process is dead, the retained records match the lease set recorded for that request, and no recording evidence is bound to it. It then prints what it will do and asks the user, on the terminal, to type the request id to confirm that the Claude session that held the request has ended. With no terminal it refuses with `CONFIRMATION_REQUIRED`; there is no `--yes`. On confirmation it adopts the lease through the core's host-recovery path and releases it. A request whose recording had begun is refused and stays with the recording-recovery path. It never deletes lease records by hand, and it leaves the model's working-tree edits untouched and says to inspect `git status`.
- A later `prepare` that meets such a lease reports the request id and this command in its refusal.
- `--dry-run` runs every check and prints the plan without confirming or changing anything.

Alternatives considered to the command names and the typed-id attestation as stopped-worker proof: reclaim automatically at the next `prepare` when the owner process is dead (rejected: no proof the worker stopped), or document manual deletion of the lease files (rejected: bypasses the core's checks). The CLI contract is in `architecture/reference-cli`.

## Claude session adapter (extension-owned)

Specplane's core and standalone CLI contain no Claude session code and never launch Claude. Automated plan execution for Claude belongs to this extension: it ships its own Protocol 1 `SessionAdapter` in the extension package and passes it explicitly to `runConductor` (see `architecture/reference-cli`).

The extension's adapter launches headless Claude Code processes through the mod's process port (`$.process.spawn`, argument array, no shell), one process per session request, in the request's `checkout` and never in another worktree. It uses no terminal multiplexer and never deletes a session.

**Launch.** `launch(request)` mints a session id (a UUID) and persists `{orchestrationId, nativeSessionId}` before the process starts. It then runs `claude -p --session-id <id> --max-budget-usd <budgetUsd> --permission-mode auto --permission-prompts none --allowedTools Skill --disallowedTools <list> --output-format stream-json --verbose <prompt>`; `--max-budget-usd` is omitted only when the request has no `budgetUsd`. The prompt is built by the extension from the request: it names the installed `plan-step` procedure and the `workflowRequestPath`, and contains no free text from the plan. The process does not use `--bare`, so the installed plugin loads, and uses no permission-bypass flag. A `launch` for an `orchestrationId` that still has a live process refuses: it starts nothing and leaves the mapping unchanged. A mapping left by an earlier adapter instance refuses the same way unless its process is confirmed dead.

**Permissions.** A session runs unattended, so nothing can answer a prompt. It runs in auto mode: the host's classifier reviews each action, and `--permission-prompts none` denies whatever would have prompted while the run continues. The extension bundles the rule lists; they are not read from the plan. The allow list holds only `Skill`, because a matching allow rule skips the classifier. The deny list holds the hard limits the classifier cannot override: `git push`, `git reset --hard`, `git clean`, `sudo`, `npm publish`, and the human lifecycle commands `specplane spec approve`, `spec reopen`, `plan approve`, `plan finish`, `plan abandon` and `decision accept`. A plan that needs a push leaves it to the user. Auto mode is a judgment, not a guarantee, and deny rules match the command as written, not the same program reached another way.

**Session check.** The session must load the plugin and run in auto mode, because the mod carries the policy and the workflow server. When `system/init` does not list plugin `specplane` or does not report `permissionMode: auto`, the adapter sends the process a termination signal and `observe` reports `failed`. A `success` result with no `system/init` seen is `unknown`, never `completed`.

**Observe.** `observe(ref)` reads the process's stream-json output and exit status. The adapter maps a final `result` event with `subtype: success` and exit 0 to `completed`; any other terminal `result` or a non-zero exit to `failed`; a live process with no terminal event to `running`; and a missing process, unparseable output, or an unrecognised event shape to `unknown`. `unknown` is never read as "no session". `completed` is advisory: the conductor still verifies the step commit, status and HANDOFF through the core.

**Resume.** `resume(ref, request)` runs the same command with `--resume <nativeSessionId>` in place of `--session-id`, only when the persisted mapping matches `ref` and no live process holds the session. A mismatch, or a live process, refuses.

**Recovery and cancel.** `recovery(ref)` returns argument-array instructions for `claude --resume <nativeSessionId>` (attach) and the log path, or an unavailable reason when the mapping is missing. `cancel(ref, signal)` sends the process a termination signal, waits for exit, and returns `{stopped: true, recoveryRequired: false}` only after the exit is observed; otherwise `{stopped: false, recoveryRequired: true}`.

**Probe.** `probe` reports `launch`, `observe`, `resume` and `cancel` true, and `budgetEnforcement` true, only after a probe against the installed, named version has launched, observed, resumed and cancelled a throwaway session and seen a budget stop. Help text alone is insufficient. Otherwise the capability is false and the conductor refuses before preparing a checkout. A launch whose outcome is uncertain is never retried automatically.

## Shared documentation delivery and completion interface

Package the compatible core's documentation bundle and manifest alongside its runtime inventory. The docs handler resolves that package before any repository preamble and returns the core/docs versions in every structured response. Register read-only documentation index/topic/search handlers through verified native dispatch, using the same typed docs operations as the CLI. The adapter returns shared topic bytes unchanged and can add host-specific invocation/capability notices separately. Query the host command inventory first; on name collision retain the host command and advertise the available documentation entry point rather than shadowing it. A host lacking native dispatch still exposes the bundled CLI docs through its established manual path.

Managed instruction assets contain the shared release orientation and documentation/contract versions. Resolve documentation relative to the installed package, not the product source checkout or an unrelated global executable. Installation verifies topic and manifest hashes. Explicit upgrade preserves custom/user-owned content under the shared upgrade transaction; ordinary docs lookup never installs, refreshes or accesses the network.

Completion handlers call shared `spec.complete`/`spec.implementation` operations, preserving separate review state and the current checkout's declared dependencies. They neither require a plan nor manufacture evidence. Completion guidance and manual edits remain valid outside managed plan workflows. Test docs/version parity with that bundled core, offline consumer usage, collision handling, stale guidance, and the ordinary-work/no-plan cases separately from live native-host certification.
