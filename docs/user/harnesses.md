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

The LLM does not run the CLI. It calls the Specplane actions through an MCP server (`specplane mcp`, started by the harness adapter, not by hand). Every action checks the permission of the LLM role (see `permissions`); an action needing `request-user` becomes a request that you answer in the harness or with `requests accept <id>` and `requests decline <id>`. A person's typed commands (`/validate`, `/approve`, and so on) run as the person who typed them and make no model call; see `harness-commands`.

## What each harness supports

<!-- note: harness-support -->
**Support differs by harness.** Plan execution is required on every supported harness; other capabilities may differ, and this topic lists what Claude Code and Codex each support. If a harness lacks a capability, Specplane says so and refuses the action, and does not silently use a weaker substitute.

| Capability | Claude Code | Codex |
|------------|-------------|-------|
| Instructions on demand | supported | missing |
| Push notifications | missing | missing |
| Subagents | supported | missing |
| Viewing specifications | missing | missing |
| Usage measurement | supported | missing |
| Blocking the Specplane CLI | supported when the installed hook file is present | missing |
| Opening a plan session | supported | missing |

Codex claims no capability until each surface has been checked live with a Codex build. Its `plan-start` refuses with the command that opens Codex in the plan's checkout.

| Command | Claude Code | Codex |
|---------|-------------|-------|
| `spec-assist`, `spec-draft-architecture`, `plan-create`, `plan-start`, `plan-step`, `plan-finish`, `plan-status`, `validate`, `verify`, `plan-abandon` | typed command | skill with a contract |
| `approve`, `requests` | typed command | not offered; run them in your own terminal |

The Claude Code installation adds the typed commands, a hook that denies an agent's shell call to the Specplane CLI, a compaction hook that makes the instructions be delivered again, a pre-commit validation hook, a status line and the MCP server entry. The Codex installation adds `.agents/skills/specplane/` (an entry skill and one contract per command), the `AGENTS.md` block and a `[mcp_servers.specplane]` table in project `.codex/config.toml`, which Codex reads only for a trusted project.

## Keeping the LLM off the CLI

Where the harness can block shell calls, a hook refuses a command that runs the installed CLI by name (directly, through `env`, a path, `sh -c`, `npx` or `bunx`) and points to the actions. The check is best effort. Text that is merely quoted, a heredoc body or a comment is not a command and is not blocked. To run the CLI from a source checkout, call `node packages/cli/dist/cli.js`.
