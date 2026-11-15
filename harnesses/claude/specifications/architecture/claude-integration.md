---
id: architecture/claude-integration
title: Claude Code integration implementation
authors:
  - llm: claude-sonnet-5-5
    contribution: drafted
implements: [claude-integration §2, claude-integration §3, claude-integration §4, claude-integration §5, claude-integration §6, claude-integration §7, claude-integration §8]
references: [root:architecture/reference-cli §12.1, root:architecture/agent-skills §7.4, root:architecture/agent-skills §1, root:architecture/agent-skills §9, root:architecture/repository-layout §5, root:harness R34, root:architecture/reference-cli §12.6, root:architecture/file-formats §6.1, root:architecture/agent-skills §2, root:architecture/file-formats §8, root:architecture/agent-skills §7, root:architecture/agent-skills §3, root:architecture/agent-skills §8, root:harness R18, root:architecture/reference-cli §12.2, root:harness R35.1, root:architecture/agent-skills §5, root:architecture/reference-cli §12.3, root:harness R14, root:architecture/agent-skills §6, root:architecture/reference-cli §12.7, root:architecture/agent-skills §7.5, root:architecture/agent-skills §5.3, root:architecture/repository-layout §3, root:architecture/reference-cli §12.8, root:architecture/reference-cli §7.8, root:roles-and-permissions R58]
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
| `.claude/hooks/specplane-caller.sh` (mode `0755`) | `harnesses/claude/templates/hooks/specplane-caller.sh` | Caller record hook for the non-plugin route (`§4`, `§10`) |
| `.claude/settings.json` | `harnesses/claude/templates/settings.json` | Hook and permission registration, merged (`§5`) |
| `.mcp.json` (project root) | built in the installer, not a template | The `specplane` MCP server entry (`specplane mcp`, `SPECPLANE_ADAPTER=claude`), merged (`§10`) |

- Every installed file except `settings.json` and `.mcp.json` is owned by Specplane and starts with a version header; refresh replaces it. A file the user changed is kept and reported with its exact path (assumption).
- `CLAUDE.md` is never created, edited or reordered. A project that forbids the marked block (`harness.install_block: off`, `root:architecture/file-formats §6.1`) is served by the rules file alone, which is Claude Code's own place for Specplane-owned instructions.
- The repository's own `.claude/` is a dogfood install of these templates. The templates are edited first and copied over; `harnesses/claude/tests/check-sync.sh` diffs each template against its installed copy and fails on any difference. The `settings.json` comparison is a subset check: every template registration must be present in the installed file.
- Templates for the retired pre-release behaviour are removed: the policy guard (`specplane-policy-guard.sh`), the plan-index generator (`specplane-generate.sh`) and the handoff check (`specplane-handoff-check.sh`), together with their `settings.json` entries. An already installed copy keeps running until the user removes it.

## §2 Standing instructions

Implements `claude-integration §2`.

`.claude/rules/specplane.md` holds the fixed standing text of `root:architecture/agent-skills §2`: Specplane is in use, read `.specplane/config.yaml` first and resolve paths from it, look up steering for the role, do not call the CLI, and the commit trailers of `root:architecture/file-formats §8` (`Specplane-Agent: $SPECPLANE_AGENT`, `Specplane-Session: $SPECPLANE_SESSION` when set). Its harness-specific part, after the shared text, lists the slash commands of `§3` (invocation detail, not standing instruction). It also carries the Specplane version and the steering stamp so that staleness is detected (`root:architecture/reference-cli §12.6`). It contains no permission modes, steering or procedures. Claude Code loads every file under `.claude/rules/` in each session, so no marker block is needed.

## §3 Command skills

Implements `claude-integration §3`.

Each command contract of `root:architecture/agent-skills §7` is packaged as one skill folder. The folder name is `specplane-<command>`; the slash name is the command name (assumption: the installer maps the skill to `/<command>`).

`SKILL.md` has Claude Code frontmatter followed by the contract:

```markdown
---
name: specplane-<command>
description: "<one sentence: what it does and when to use it>"
argument-hint: "<optional>"
disable-model-invocation: <true|false>
---
<!-- Specplane command contract v<version>; source: architecture/agent-skills §7 -->
# <command>

<Purpose paragraph and the contract sections, in order.>
```

- The body is the contract text of `root:architecture/agent-skills §1`, filled with steering and documentation for the command (`root:architecture/agent-skills §3`). Skills never name a `specplane` command, only harness actions (`root:architecture/agent-skills §8`).
- `[code]` steps are done by the harness actions; Claude does not reconstruct them. A typed command with no arguments runs its `[code]` steps through the user-command runner without a model turn (`root:harness R18`, `root:architecture/reference-cli §12.2`). This is done by a Claude Code plugin handler for slash commands (assumption); where it cannot be installed, setup says the command needs a model turn and refuses to pretend otherwise (`root:harness R35.1`).
- `disable-model-invocation: true` for `approve`, `requests`, `spec-view`, `plan-start`, `plan-step`, `plan-finish`, `plan-abandon`, `plan-create` and `spec-draft-architecture`; `false` for `spec-assist`, `spec-review`, `validate`, `plan-status`, `verify`, `decision-new` and `migrate` (assumption). The flag never grants a permission; the guard decides (`root:architecture/agent-skills §5`).
- `approve`, `requests` and `spec-view` have no model: they are user-only commands. Claude Code reports the `viewing` capability because the plugin handler runs `spec-view` in the user-command runner.
- **`/requests` and the request dialogue** (`root:requests R52.1`, `root:requests R52.4`). Claude Code limitation: the plugin does not open a persistent pane (no `$.ui.open` with `ui.render`); the Claude Code realization of the requests pane is the host's own question dialogue (`$.ui.ask`, two to four options), which blocks until the user answers.
  - `/requests` with no arguments, run by the plugin handler (`harnesses/claude/plugin/hooks/commands.ts`), lists the pending requests from `requests list --json` of the bundled core and opens the dialogue for each in turn. The options are Accept, Decline and Skip. Accept and Decline run `requests accept <id>` or `requests decline <id>` through the bundled core as the person, never as the LLM (`root:architecture/reference-cli §12.1`); Skip leaves the request pending.
  - The dialogue text shows the sender, the action and the reason. For a request whose `diff` is not null (a request involving a specification) it also shows the difference from the last approved spec in git diff style, with removed lines as `-` and added lines as `+`, so the host shows them red and green where it can (`root:requests R52.4`).
  - **Push notification** (`root:requests R52.5`). When a request is created in the session (the arrival dialogue) and `notifications.push` is on with the request's permission in `notifications.push_permissions` (or `all`), the plugin raises one native notification with `$.ui.notify` before it opens the dialogue (the dialogue blocks), titled `Specplane`, keyed `specplane-request-<id>`: "Specplane: a request is waiting: <action> (from <role>). Open /requests to answer." It carries no diff, reason or answer path; the request is answered only in the dialogue or `/requests`. The settings are read with `config get <key> --json` of the bundled core. After the dialogue is answered the plugin takes the notification back with `$.ui.cancelNotify`; when the dialogue cannot open (a `-p` run) the notification stays. A failure of the notification is logged and never stops the dialogue. The adapter claims the `push` capability but cannot tell whether the plugin is loaded, so the capability table says it holds with the plugin loaded; without the plugin no push is sent.
  - When the dialogue is unavailable or rejected (for example a `-p` run), the handler falls back to the text list followed by the line telling the user to answer with `/requests accept <id>`. `/requests accept <id>` and `/requests decline <id>` with arguments keep working and do not open the dialogue.
  - **Arrival dialogue** (`root:requests R52.4`): while a session is active, the plugin's `tool.call` handler (`harnesses/claude/plugin/hooks/channel.ts`) inspects the reply of every Specplane tool call (the request-sending action and any write action held for the user) and, when the reply says a request was created and the request is still pending, opens the same dialogue for it. It works on both routes: when the plugin serves the tool itself, and when the project's `specplane mcp` server (registered by `init --harness claude`) serves a `mcp__specplane__*` call, whose reply the handler sees through `next(e)`. One dialogue opens per request id even if both routes see it. In both routes the dialogue opens before the model's turn continues. After Accept or Decline (not Skip) the model is told: on the plugin's own route one line is added to the reply; on the MCP route the reply is not rewritten, so the plugin submits one short prompt without human authority (`Specplane: request <id> was accepted by the user (...). Do not send it again.`) shortly after. Failures are logged and the reply stands. The dialogue shows a `Warning:` line when the current diff is unavailable (the request is re-read with `requests show`, which recomputes the diff). A failed Accept is reported to the model as accepted but failed, with the core's message. Verified live on 2026-11-15 with the plugin and the `.mcp.json` server both present (`harnesses/claude/host-evidence/2.1.322-requests-dialogue.txt`, items 6 and 7). Limitation: this exists only with the plugin. Without the plugin there is no arrival dialogue; the plain skill `specplane-requests` only points the user to the plugin, and the user answers with `specplane requests accept <id>` in a terminal outside the session.
- The `description` of a skill that Claude may load on its own is the trigger text; the instruction delivery of `root:architecture/reference-cli §12.3` sends a pointer to the skill rather than its text, so the behaviour matches `root:harness R14`.
- Claude Code shows `Read` as the way to read specs; the skills tell Claude to use one retrieval action per working set (`root:architecture/agent-skills §6`).

## §4 Hooks

Implements `claude-integration §4`.

All hook scripts are POSIX `sh`, read the Claude Code hook JSON on stdin, need `jq` only where noted, and exit 0 without output when the project has no `.specplane/config.yaml`.

| Script | Registration | Behaviour |
|--------|--------------|-----------|
| `specplane-cli-block.sh` | `PreToolUse`, matcher `Bash` | Splits the command text into simple commands (`;`, `&&`, `\|`, subshells, `env` prefixes, `sh -c`, `npx`, `bunx`, path-qualified `specplane`), and exits 2 with a message naming the harness actions when one runs the Specplane CLI. Uses core `isSpecplaneCommand` (`root:architecture/reference-cli §12.7`) when the CLI is installed, otherwise an equivalent pattern (assumption) |
| `specplane-session-context.sh` | `SessionStart` | Prints the documentation essentials (`specplane docs essentials`, `root:steering R23`) when the CLI is installed; in a plan checkout (branch `plan/<id>`) also prints the plan, the next step and the instruction to work only on that step. It runs again after compaction, so the essentials are redelivered. With `CLAUDE_ENV_FILE` set, exports `SPECPLANE_AGENT=claude-code` and the session ID as `SPECPLANE_SESSION`, and, unless `bypass_guards.marker_export` is off, the LLM marker `SPECPLANE_ACTOR=llm`, `SPECPLANE_PROVIDER=anthropic` and the model as `SPECPLANE_MODEL` |
| `specplane-compact.sh` | `SessionStart`, matcher `compact` | Tells core that the compaction epoch changed so instructions are delivered again (`root:architecture/reference-cli §12.3`) |
| `specplane-pre-commit.sh` | `PreToolUse`, matcher `Bash` | For a `git commit`, runs validation through the core and exits 2 on errors; warnings do not block (assumption). Handles `git -C`, `git -c`, `cd x && git commit` and subshell forms; does not match `git commit-tree` or `echo commit` |
| `specplane-bypass-guard.sh` | `PreToolUse`, matcher `Bash\|Write\|Edit\|MultiEdit\|NotebookEdit` | Guards against permission bypass (`root:roles-and-permissions R58`, `root:architecture/reference-cli §7.8`): denies a shell command that starts a headless session (`claude -p`, `claude --print`, `codex exec`; `headless_block`), that sets or unsets `SPECPLANE_*` identity variables or clears the environment (`env -i`, `env -u`; `marker_protect`), or that names the local store files or the approvals notes ref for a write (`store_protect`); denies a file tool write to the same store files (`store_protect`) and to `.claude/hooks/specplane-*` and `.claude/settings*.json` (`hook_protect`, also for a shell command). Each measure is read from `bypass_guards.<measure>` in `.specplane/config.yaml`; text that is not run is ignored as in the CLI block. The same hook carries strict mode (`root:roles-and-permissions R55.1`, `root:architecture/reference-cli §15`), read from `strict_mode.enabled` and `strict_mode.<measure>` in the same file (all off unless enabled): `edit_block` denies a file-tool write, and a shell write (redirect, `tee`, `sed -i`, `mv`, `rm`, `cp` onto, `git checkout` and similar), into the specification folders named by `paths.*` and the subprojects, `.specplane/decisions` and `.specplane/roles`; `git_commit_guard` denies `git commit --no-verify` or `-n`, `core.hooksPath` and writes to `.git/hooks`; `os_permissions` denies `chmod`, `chown`, `chgrp`, `chattr` and `setfacl` on the hooks, `.claude/settings.json`, `.git/hooks` and the store. The adapter claims `strict-mode` only when the installed copy of this hook mentions strict mode |
| `specplane-caller.sh` | `PreToolUse`, matcher `mcp__specplane__.*` | Writes the per-call caller record for a tool call of a subagent and never decides a call (`root:architecture/reference-cli §12.1`, `§10`) |
| `specplane-statusline.sh` | `statusLine` | Plan, step progress and what is waiting, in a plan checkout; empty elsewhere (assumption) |

- The `Bash` hooks run side by side; a deny from any stops the call.
- A hook whose tool (`jq`, `git`, Specplane core) is missing exits 0 and prints nothing, so a missing tool never blocks the user.
- `root:harness R35.1`: setup states that the CLI block, the bypass guards and strict mode are best effort. The hook measures read the working-tree configuration; a shell command's environment does not tell the subagent apart (one environment file), so role rules on a subagent apply to shell commands only where the environment states it (`root:architecture/reference-cli §7.8`); harness action calls get the subagent from the caller (`§10`).

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

```
Agent({
  subagent_type: "general-purpose",
  description: "Execute plan step NN: <title>",
  prompt: "<the [llm] steps of the plan-step contract>\n\nPlan: <plan-id>, checkout: <path>\nStep file: <path>\nHANDOFF.md: <path>\nContext items: <resolved paths, with heading anchors>\nSession mode: unattended"
})
```

- The prompt carries paths and cites, not file contents; the subagent retrieves its context itself (`root:architecture/agent-skills §6`).
- The parent runs the contract's selection and checks first; the subagent runs the `[llm]` steps and the actions of steps 4 to 6 of `root:architecture/agent-skills §7.5` under the parent's role, and returns a short summary and the outcome. The parent calls no step-done action again (`root:architecture/agent-skills §7.5`).
- A chain of several steps repeats this once per step, in order; the next subagent starts only after the previous one returned `done` (assumption).
- The subagent has no user questions, so it uses the block rules of `root:architecture/agent-skills §5.3`.

## §7 Worktree and cloud sessions

Implements `claude-integration §6`.

- `plan-start` launches the plan session in the checkout path of `root:architecture/repository-layout §3` through the session adapter, by the `claude -p` route of its existing design, sending the slash command `/specplane-plan-step <plan-id>` as the whole first message (the skill is not model-invocable, and a slash command is recognised only at the very start of a message); the project's own session is not moved (assumption). Only when the adapter reports the capability unavailable does it print the exact command that opens Claude Code there, shown as an error naming why (`root:architecture/agent-skills §7.4`, `root:harness R35.1`).
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
- Test T1 (deterministic): `check-sync.sh` fails when an installed copy differs from its template.
- Test T2 (deterministic): every skill carries a contract comment whose version matches the packaged contract; an older copy is reported as a warning (`root:architecture/agent-skills §9`).
- Live checks in a real Claude Code session are separate and need the user's approval.

## §10 Action channel

Implements `claude-integration §3`.

The harness actions of `root:architecture/reference-cli §12.1` reach Claude Code through one of two channels, both running the same action registry with the permission checks inside the core process, not in Claude Code.

- **Plugin install: the mod-served channel.** The plugin's mod (`harnesses/claude/plugin/hooks/register.tsx`, QuickJS hook code) registers every action as its own tool, named `mcp__specplane__<action name>` with the underscore form of the MCP server (`spec.retrieve` is `mcp__specplane__spec_retrieve`, `toolName` in `harness/mcp.ts`), and serves each call by forwarding it to the session server of `root:architecture/reference-cli §12.8` over a Unix socket. The mod starts that server with `$.process.spawn` at `session.start`, reads its readiness line from the spawn stream and keeps draining the stream, registers the tools from the action list on that line (assumption: registration after the line is read), and asks it to shut down at `session.end`. Each call carries the identity the Claude Code engine gives: the agent ID (present only for a subagent), the agent type from `$.agent.list()`, the tool use ID and the session model from `$.session.model()`. Identity therefore does not come from the undocumented `_meta` field of the MCP route or from a record file, and the caller hook needs no part in it. The manifest sets no `SPECPLANE_ADAPTER` through an MCP declaration; the mod starts the server for the Claude adapter, so `plan.start` opens the plan session through the Claude session adapter of `§7`, as the typed `/plan-start` does.
- **Without the plugin.** The MCP server (`core/dist/harness/mcp-main.js`) and the hook `specplane-caller.sh` (`§4`) stay for Codex and for a Claude project set up with `init --harness claude` without the plugin. There the identity is the per-call record of `root:architecture/reference-cli §12.1`. `init --harness claude` registers the server as the `specplane` entry of the project's `.mcp.json` (`command` `specplane`, `args` `["mcp"]`, `env` `SPECPLANE_ADAPTER=claude`), so a project without the plugin has the tools. Other servers and keys of the file are kept; an existing `specplane` entry that differs is kept and reported, not overwritten; invalid JSON leaves the file alone with a report; a symlinked path is refused as for every installed file; a repeat run changes nothing. The plugin stays an optional additional route; a session with both may list the tools twice. The headless session of `§7` starts only if its `system/init` reports the plugin or an MCP server named `specplane` whose `status`, if any, is not `failed` or `needs-auth`, and auto mode; otherwise the monitor stops it. When several `specplane` entries are listed (for example `.mcp.json` and a user-scope server), one usable entry is enough, since it gives the session the tools; the session stops only when every listed entry is `failed` or `needs-auth`. The message says to run `init --harness claude` or install the plugin, or, when every listed `specplane` server failed to connect, names each distinct status once. The shape of the `mcp_servers` entries was checked live on 2026-11-14 in a fixture with Claude Code headless and Haiku, without `--plugin-dir`, after `init --harness claude`: `system/init` listed `{'name': 'specplane', 'status': 'connected', 'source': 'project'}` with 43 `mcp__specplane` tools and 16 skills, and `docs_essentials` returned text. Neither the user settings nor the fixture held an MCP approval, so a headless session loads the unapproved project server and init needs no `enabledMcpjsonServers`. An interactive session was not checked (not checked live). In an interactive session Claude Code may ask the user to approve a project `.mcp.json` server before it connects (assumption, not checked live).

The plugin manifest no longer declares `mcpServers`, so the tools are not listed twice.

**Mod behaviour.** The mod returns the reply text as a string, because the host rejects any other tool result. A request to the server must answer within the host's 30000 ms limit for a forwarded request, which has no option to raise it: the server answers within 25 seconds, or with `pending` and a job ID, and the mod asks again for that job until it is done. When the connection itself fails (no socket, connection refused), so the request was not sent, the mod starts a new server and retries once; if that fails the call is denied with a message naming the cause (`root:harness R35.1`). When a request was sent and no answer came within the host's limit, the mod reports the failure and neither retries nor starts another server. There is at most one server per session. A resumed session starts a new server. The host does not restart a child that exited and does not remove it when the host is killed with SIGKILL, which is why the server ends itself when its parent is gone.

**Host version (early access).** The mod API is early access of Claude Code and may change. The plugin records the version it was built and checked against, `2.1.322`, and the mod compares it with the running version at load. On a mismatch it still serves the tools and warns, and the adapter reports `subagent-identity` as missing (`root:architecture/reference-cli §12.6`); while a session server serves the session this version match alone decides the capability and the installed caller hook does not count. The hook's matcher also matches the mod's tools, so it writes records in a plugin session that nothing reads; they expire as in `root:architecture/reference-cli §12.1`. A probe server, not the production core, was run live on 2.1.322 in headless sessions only (`harnesses/claude/host-evidence/2.1.322-socket-probe/live-results.txt`): the route works from the main agent and from a subagent and the agent ID is present only for a subagent. Interactive sessions are not verified.

**Guards.** `marker_protect` of the bypass-guard hook (`§4`) covers the identity variables, `SPECPLANE_*`, so a shell command cannot set them to change an actor (`root:roles-and-permissions R58`, `root:architecture/reference-cli §7.8`). The mod starts the server with `SPECPLANE_ACTOR=mod`; the server starts only on exactly that value and then marks its own environment as an LLM's. This check, `marker_protect` and a refusal by the bypass-guard hook of shell commands that name the session server entry are text matching and best effort: a shell command that got past them could start its own server and claim an identity. A request without the session secret is refused, which keeps a shell command from using the session's own server.

## §11 Plugin package

Implements `claude-integration §3`.

The plugin of `§10` is built, not hand-assembled. `packages/cli/scripts/build-plugin.mjs` runs at the end of the package build and writes `dist/plugin/`: the plugin sources of `harnesses/claude/plugin/` (`.claude-plugin/plugin.json`, `hooks/`, `LICENSE`) and, under `core/`, a self-contained copy of the compiled core (`dist/` without test files, `assets/`, `package.json`, `core-release.json` and the production dependencies from `node_modules/`). The manifest declares no MCP server; the mod starts `core/dist/harness/session-server-main.js` (name an assumption) and the slash-command handler runs `core/dist/cli.js`; neither needs an install step or the repository, only Node. The manifest or a file next to it records the Claude Code version of `§10`. The script fails when the mod names a core file the package lacks. `dist/plugin` is excluded from the npm tarball, because npm drops nested `node_modules`; the plugin folder itself is what Claude Code loads (how it reaches users, for example through a marketplace, is a later release).
- Test T1 (deterministic): `plugin-package.test.ts` builds the plugin into a temporary folder, starts the session server from it with no repository, reads its readiness line, lists the tools from the action list and runs `core/dist/cli.js docs essentials`.
- Not checked offline: that Claude Code loads the folder as a plugin and runs the mod in an interactive session (assumption; a live check needs the user's approval).
