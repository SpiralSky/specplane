---
title: Harnesses
summary: Installing Claude Code or Codex, the commands and capabilities each supports, and what an LLM can do.
related: [commands, permissions, plans, harness-commands]
---

# Harnesses

A harness is the agent host that an LLM works in. Specplane supports Claude Code and Codex. You name the harness when you set up; Specplane never guesses it.

```sh
specplane init --harness claude
specplane init --harness codex
```

`init` sets up the notes fetch refspec for every remote and installs the named harness's files, then prints which capabilities that harness lacks. Installed files carry a version header; `validate` warns when one is missing, older than the CLI, edited so the stamp no longer matches, or when a marker block is broken. Standing instructions go to an owned file, or into a marked block in a shared file such as `AGENTS.md` (turn this off with `harness.install_block`). Specplane never edits `CLAUDE.md`.

## What an LLM uses

The LLM does not run the CLI. It calls the Specplane actions through an MCP server (`specplane mcp`, started by the harness adapter, not by hand). The Claude Code plugin serves the same actions itself: it registers each one as a tool and passes every call to a Specplane process that it starts for the session, so the plugin declares no MCP server. Every action checks the permission of the LLM role (see `permissions`); an action needing `request-user` becomes a request that you answer in the harness or with `requests accept <id>` and `requests decline <id>`. A person's typed commands (`/validate`, `/approve`, and so on) run as the person who typed them and make no model call; see `harness-commands`. A shell command typed with the `!` prefix in a Claude Code session is different: it runs in the session's shell, which carries the LLM marker, so Specplane takes it as the LLM's and an approval typed that way becomes a request; run it in a terminal outside the session (see `permissions`). This was observed only on Claude Code; it is not checked on Codex.

Steering and command instructions describe the same effective role that each action checks, including approved custom permissions. LLM role rules use the identity factors supplied by the adapter; when the effective role or permissions change, instructions are sent again. All callers of a Claude Code session share one MCP process, so the installed caller hook records which subagent makes each call and the call takes the role the rules give that subagent; the subagent's identity never comes from tool input. Without that hook, or on Codex, rules on a subagent, an agent type or delegation match only where the environment states them.

## What each harness supports

<!-- note: harness-support -->
**Support differs by harness.** Plan execution is required on every supported harness; other capabilities may differ, and this topic lists what Claude Code and Codex each support. If a harness lacks a capability, Specplane says so and refuses the action, and does not silently use a weaker substitute.

| Capability | Claude Code | Codex |
|------------|-------------|-------|
| Instructions on demand | supported | missing |
| Push notifications | supported with the plugin loaded (Setup cannot tell whether it is), the host raises it through its own push: it reached a phone with Remote Control connected (`/remote-control`) while the person was away from the session (checked on Claude Code 2.1.322), and it is informational only, so you open the session to answer; when the host reports the notification as not sent (a detached session with no Remote Control, or you are active at the terminal) the plugin logs one line; without the plugin, none is sent | missing |
| Subagents | supported | supported (checked with Codex 0.169.0) |
| Viewing specifications (`spec-view`) | supported | missing |
| Usage measurement | supported | missing |
| Blocking the Specplane CLI | supported when the installed hook file is present | missing |
| Opening a plan session | supported | missing |
| Guarding against permission bypass by headless sessions | supported when the installed bypass-guard hook file is present | missing |
| strict mode: blocking direct edits of specifications | supported when the installed bypass-guard hook is a version that handles strict mode | missing |
| Telling subagents apart for LLM role rules | supported with the plugin when the running Claude Code version is the one the plugin was checked against; without the plugin, when the installed caller hook file is present | missing |

Codex claims only what has been checked live with a Codex build: subagents were checked with Codex 0.169.0, and every other capability stays missing until it is. Its `plan-start` refuses with the command that opens Codex in the plan's checkout.

| Command | Claude Code | Codex |
|---------|-------------|-------|
| `spec-assist`, `spec-draft-architecture`, `plan-create`, `plan-start`, `plan-step`, `plan-finish`, `plan-status`, `validate`, `verify`, `plan-abandon` | typed command | skill with a contract |
| `approve`, `requests`, `spec-view` | typed command | not offered; run them in your own terminal |

In Claude Code, a typed command that hands its arguments to the assistant first checks the permissions it cannot do anything without: `plan.create` for `plan-create`, `plan.abandon` for `plan-abandon`, `plan.complete` for `plan-finish`, and `info.retrieve` for `validate`, `verify` and `spec-review`. If the LLM role has one of them as deny, the command is refused at once with the denial text naming the permission, and no model turn starts. Allow and request user start the turn as usual. Other commands, whose permission depends on what they write, always start it. Codex has no typed commands, so this check does not apply there.

The Claude Code installation adds the typed commands, a hook that denies an agent's shell call to the Specplane CLI, a bypass-guard hook (see `permissions`), a caller hook that tells subagents apart, a compaction hook that makes the instructions be delivered again, a pre-commit validation hook, a status line and the `specplane` MCP server entry in the project's `.mcp.json`. The entry is merged: other servers stay, a different existing `specplane` entry is kept and reported, and a symlinked `.mcp.json` is refused. Claude Code may ask you to approve a project MCP server the first time. The Codex installation adds `.agents/skills/specplane/` (an entry skill and one contract per command), the `AGENTS.md` block and a `[mcp_servers.specplane]` table in project `.codex/config.toml`, which Codex reads only for a trusted project. The table also sets `default_tools_approval_mode = "approve"`: Specplane checks the role's permission for every action itself, so Codex's own per-tool prompt adds nothing, and without the line a headless Codex run cannot call any action.

The plugin is optional; `init` gives Claude Code the Specplane tools without it. To add it, build the CLI (`npm run build` in `packages/cli`) and start Claude Code with `claude --plugin-dir <path to packages/cli/dist/plugin>`, or install that folder as a plugin. A plan session started by `plan start` runs when Claude Code reports either the plugin or the `specplane` MCP server; with neither it is stopped and says so. The monitor that runs the session also chains sessions for a selection (`next`, a count, `all` or `<first>..<last>`, given to `plan-start` as its second argument): after each clean exit that finished a step it writes a clean-end record in the run marker, which reads as idle between steps, and starts a fresh session on the next step; any stop, an error exit or a step left unfinished ends the chain, and the last two record a failure stop. The selection is kept in memory only. To continue an existing plan (idle, or stopped) with a selection, run in a terminal `specplane harness session <plan-id> --session <new-uuid> --selection all` (or `next`, a count, `<first>..<last>`); a stopped plan is resumed first, and the selection must start at the next step. Leave out `--resume`: that flag only resumes a Claude Code session of that ID, as after a blocking request. With both present the tools may be listed twice. The popup that opens when a request arrives, and the notification before it, need the plugin loaded; they work whether the plugin or the `.mcp.json` server serves the Specplane tool. Without the plugin, answer with `specplane requests accept <id>` in a terminal.

The Claude Code plugin uses an early-access part of Claude Code to serve the actions. It was built and checked against Claude Code 2.1.322. On another version it still serves the actions, shows a warning once per session, and reports telling subagents apart as missing, so LLM role rules that state a subagent or an agent type do not apply there. With the plugin, the identity of the caller and the model come from Claude Code itself. This needs `sh`, so it does not work on Windows.

## Keeping the LLM off the CLI

Where the harness can block shell calls, a hook refuses a command that runs the installed CLI by name (directly, through `env`, a path, `sh -c`, `npx` or `bunx`) and points to the actions. The check is best effort. Text that is merely quoted, a heredoc body or a comment is not a command and is not blocked. To run the CLI from a source checkout, call `node packages/cli/dist/cli.js`.

That hook is one of several measures against bypassing a role; the others are in `permissions` under "Bypass guards". Codex cannot block a shell call, mark its shell commands or guard files, so on Codex only the marker check of the core applies, and only when the environment already carries the marker. The same holds for strict mode (`permissions`, "Strict mode"): on Codex only the pre-commit check and the file permissions work; blocking direct edits of specifications does not, and `validate` warns when strict mode asks for it.
