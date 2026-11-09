---
id: architecture/claude-integration
title: Claude Code integration implementation
status: awaiting-review
authors:
  - llm: claude-sonnet-5-5
    contribution: drafted
implements: [claude-integration §2, claude-integration §3, claude-integration §4, claude-integration §5, claude-integration §6, claude-integration §7, claude-integration §8]
references: [root:architecture/agent-skills §1, root:architecture/agent-skills §9, root:architecture/repository-layout §5, root:harness R34, root:architecture/reference-cli §12.6, root:architecture/file-formats §6.1, root:architecture/agent-skills §2, root:architecture/file-formats §8, root:architecture/agent-skills §7, root:architecture/agent-skills §3, root:architecture/agent-skills §8, root:harness R18, root:architecture/reference-cli §12.2, root:harness R35.1, root:architecture/agent-skills §5, root:architecture/reference-cli §12.3, root:harness R14, root:architecture/agent-skills §6, root:architecture/reference-cli §12.7, root:architecture/agent-skills §7.5, root:architecture/agent-skills §5.3, root:architecture/repository-layout §3]
---

# Claude Code integration implementation

This spec says which files Specplane installs for Claude Code and what they contain. It packages the harness-neutral contracts of `root:architecture/agent-skills §1` for Claude Code and adds only invocation detail; it never changes a contract's steps, order or permissions (`root:architecture/agent-skills §9`). Where installed files live follows `root:architecture/repository-layout §5`. The harness is installed only when the user names it at setup (`root:harness R34`, via `root:architecture/reference-cli §12.6`).

## §1 Files produced

Implements `claude-integration §2`, `claude-integration §3`, `claude-integration §4`.

| Installed path | Source in this repository | Purpose |
|----------------|---------------------------|---------|
| `.claude/rules/specplane.md` | `harnesses/claude/templates/rules/specplane.md` | Standing instructions (`§2`) |
| `.claude/skills/specplane-<command>/SKILL.md` | `harnesses/claude/templates/skills/` | One skill per command contract (`§3`) |
| `.claude/hooks/specplane-*.sh` (mode `0755`) | `harnesses/claude/templates/hooks/` | Hook programs (`§4`) |
| `.claude/settings.json` | `harnesses/claude/templates/settings.json` | Hook and permission registration, merged (`§5`) |

- Every installed file except `settings.json` is owned by Specplane and starts with a version header; refresh replaces it. A file the user changed is kept and reported with its exact path (assumption).
- `CLAUDE.md` is never created, edited or reordered. A project that forbids the marked block (`harness.install_block: off`, `root:architecture/file-formats §6.1`) is served by the rules file alone, which is Claude Code's own place for Specplane-owned instructions.
- The repository's own `.claude/` is a dogfood install of these templates. The templates are edited first and copied over; `harnesses/claude/tests/check-sync.sh` diffs each template against its installed copy and fails on any difference. The `settings.json` comparison is a subset check: every template registration must be present in the installed file.
- Templates for the retired pre-release behaviour are removed: the policy guard (`specplane-policy-guard.sh`), the plan-index generator (`specplane-generate.sh`) and the handoff check (`specplane-handoff-check.sh`), together with their `settings.json` entries. An already installed copy keeps running until the user removes it.

## §2 Standing instructions

Implements `claude-integration §2`.

`.claude/rules/specplane.md` holds the fixed standing text of `root:architecture/agent-skills §2`: Specplane is in use, read `.specplane/config.yaml` first and resolve paths from it, look up steering for the role, do not call the CLI, and the commit trailers of `root:architecture/file-formats §8` (`Specplane-Agent: $SPECPLANE_AGENT`, `Specplane-Session: $SPECPLANE_SESSION` when set). It lists the slash commands of `§3`. It also carries the Specplane version and the steering stamp so that staleness is detected (`root:architecture/reference-cli §12.6`). It contains no permission modes, steering or procedures. Claude Code loads every file under `.claude/rules/` in each session, so no marker block is needed.

## §3 Command skills

Implements `claude-integration §3`.

Each command contract of `root:architecture/agent-skills §7` is packaged as one skill folder. The folder name is `specplane-<command>`; the slash name is the command name (assumption: the installer maps the skill to `/<command>`).

`SKILL.md` has Claude Code frontmatter followed by the contract:



- The body is the contract text of `root:architecture/agent-skills §1`, filled with steering and documentation for the command (`root:architecture/agent-skills §3`). Skills never name a `specplane` command, only harness actions (`root:architecture/agent-skills §8`).
- `[code]` steps are done by the harness actions; Claude does not reconstruct them. A typed command with no arguments runs its `[code]` steps through the user-command runner without a model turn (`root:harness R18`, `root:architecture/reference-cli §12.2`). This is done by a Claude Code plugin handler for slash commands (assumption); where it cannot be installed, setup says the command needs a model turn and refuses to pretend otherwise (`root:harness R35.1`).
- `disable-model-invocation: true` for `approve`, `requests`, `plan-start`, `plan-step`, `plan-finish`, `plan-abandon`, `plan-create` and `spec-draft-architecture`; `false` for `spec-assist`, `validate`, `plan-status` and `verify` (assumption). The flag never grants a permission; the guard decides (`root:architecture/agent-skills §5`).
- `approve` and `requests` have no model: they are user-only commands.
- The `description` of a skill that Claude may load on its own is the trigger text; the instruction delivery of `root:architecture/reference-cli §12.3` sends a pointer to the skill rather than its text, so the behaviour matches `root:harness R14`.
- Claude Code shows `Read` as the way to read specs; the skills tell Claude to use one retrieval action per working set (`root:architecture/agent-skills §6`).

## §4 Hooks

Implements `claude-integration §4`.

All hook scripts are POSIX `sh`, read the Claude Code hook JSON on stdin, need `jq` only where noted, and exit 0 without output when the project has no `.specplane/config.yaml`.

| Script | Registration | Behaviour |
|--------|--------------|-----------|
| `specplane-cli-block.sh` | `PreToolUse`, matcher `Bash` | Splits the command text into simple commands (`;`, `&&`, `\|`, subshells, `env` prefixes, `sh -c`, `npx`, `bunx`, path-qualified `specplane`), and exits 2 with a message naming the harness actions when one runs the Specplane CLI. Uses core `isSpecplaneCommand` (`root:architecture/reference-cli §12.7`) when the CLI is installed, otherwise an equivalent pattern (assumption) |
| `specplane-session-context.sh` | `SessionStart` | In a plan checkout (branch `plan/<id>`) prints the plan, the next step and the instruction to work only on that step. With `CLAUDE_ENV_FILE` set, exports `SPECPLANE_AGENT=claude-code` and the session ID as `SPECPLANE_SESSION` |
| `specplane-compact.sh` | `SessionStart`, matcher `compact` | Tells core that the compaction epoch changed so instructions are delivered again (`root:architecture/reference-cli §12.3`) |
| `specplane-pre-commit.sh` | `PreToolUse`, matcher `Bash` | For a `git commit`, runs validation through the core and exits 2 on errors; warnings do not block (assumption). Handles `git -C`, `git -c`, `cd x && git commit` and subshell forms; does not match `git commit-tree` or `echo commit` |
| `specplane-statusline.sh` | `statusLine` | Plan, step progress and what is waiting, in a plan checkout; empty elsewhere (assumption) |

- The two `Bash` hooks run side by side; a deny from either stops the call.
- A hook whose tool (`jq`, `git`, Specplane core) is missing exits 0 and prints nothing, so a missing tool never blocks the user.
- `root:harness R35.1`: setup states that the CLI block is best effort and that headless sessions and environment-marker guards are a later release.

## §5 Settings merge

Implements `claude-integration §4`.

Setup merges `templates/settings.json` into `.claude/settings.json`:

1. File absent: write the template (two-space indent, trailing newline).
2. File not valid JSON: leave it and print `Skipped .claude/settings.json (invalid JSON; add the Specplane registration by hand)`.
3. For each template matcher group under `hooks.<Event>`: skip it when any existing command contains its script name; otherwise append it.
4. `permissions.allow`: add each template entry that is not present. The template allows nothing that lets Claude run the CLI.
5. `statusLine`: set only when absent; otherwise print `Kept existing statusLine`.
6. Keep all other keys and their order. Write only when something changed.

## §6 Subagent step execution

Implements `claude-integration §5`.

When a step runs as a subagent, the `plan-step` skill starts it with the Agent tool as a fresh `general-purpose` subagent, never a `fork`, because a fork inherits the parent's context and defeats the clean per-step session:



- The prompt carries paths and cites, not file contents; the subagent retrieves its context itself (`root:architecture/agent-skills §6`).
- The parent runs the contract's selection and checks first; the subagent runs the `[llm]` steps and the actions of steps 4 to 6 of `root:architecture/agent-skills §7.5` under the parent's role, and returns a short summary and the outcome. The parent calls no step-done action again (`root:architecture/agent-skills §7.5`).
- A chain of several steps repeats this once per step, in order; the next subagent starts only after the previous one returned `done` (assumption).
- The subagent has no user questions, so it uses the block rules of `root:architecture/agent-skills §5.3`.

## §7 Worktree and cloud sessions

Implements `claude-integration §6`.

- `plan-start` prints the exact command that opens Claude Code in the checkout path of `root:architecture/repository-layout §3`; the project's own session is not moved (assumption).
- A session detects a plan checkout by the branch name `plan/<id>` and the plan record in it; the session-context hook (`§4`) reports it.
- A cloud session needs the repository checkout, the installed `.claude/` files and the Specplane core. If a hook script or the core is missing there, the contract's capability check names the missing piece and stops (`root:architecture/agent-skills §1`). Whether the hooks run in the cloud is to be verified per surface (assumption).
- A step in the cloud pushes its commits so later sessions see them (assumption).

## §8 Memory

Implements `claude-integration §7`.

Skills never read or write Claude Code memory. The recommended names are `specplane-active-plan` (plan ID, checkout path, last finished step), `specplane-open-questions` and `specplane-spec-gaps`. They are pointers; Specplane does not validate them.

## §9 Testing

Implements `claude-integration §4`, `claude-integration §3`.

- `harnesses/claude/tests/hooks.test.sh` (POSIX `sh`, exits non-zero on failure) feeds fixture JSON to each hook with a stub `specplane` first on `PATH` and a temporary `CLAUDE_PROJECT_DIR`. Cases: the CLI block denies direct, `env`, `npx`, `sh -c` and path-qualified calls and allows unrelated commands; pre-commit blocks real commits (`git -C d commit`, `(git commit)`) when the stub fails and allows `git commit-tree`, `echo commit`; session context names the next step and exports the two variables; the status line is empty outside a plan checkout; each hook exits 0 when its tool or the config is missing.
- Settings merge is tested for absent file, invalid JSON, already registered, partial registration and existing `statusLine`.
- Test (deterministic): `check-sync.sh` fails when an installed copy differs from its template.
- Test (deterministic): every skill carries a contract comment whose version matches the packaged contract; an older copy is reported as a warning (`root:architecture/agent-skills §9`).
- Live checks in a real Claude Code session are separate and need the user's approval.
