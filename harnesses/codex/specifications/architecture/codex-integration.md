---
id: architecture/codex-integration
title: Codex integration implementation
authors:
  - llm: claude-sonnet-5-5
    contribution: drafted
implements: [codex-integration §2, codex-integration §3, codex-integration §4, codex-integration §5, codex-integration §6]
references: [root:architecture/reference-cli §12.1, root:architecture/agent-skills §1, root:architecture/agent-skills §9, codex-integration §1, root:architecture/repository-layout §5, root:architecture/agent-skills §2, root:architecture/reference-cli §12.6, root:architecture/agent-skills §3, root:architecture/agent-skills §8, root:harness R35.1, root:architecture/reference-cli §12.7, root:architecture/agent-skills §7.1]
---

# Codex integration implementation

This spec says which files Specplane installs for Codex. It packages the contracts of `root:architecture/agent-skills §1` and adds only invocation detail; it never changes a contract's steps or permissions (`root:architecture/agent-skills §9`). The package facts below come from Codex's published skill documentation and are assumptions until verified on each surface (`codex-integration §1`).

## §1 Files produced

Implements `codex-integration §2`, `codex-integration §3`.

| Installed path | Source in this repository | Purpose |
|----------------|---------------------------|---------|
| `AGENTS.md` (one marked block) | generated | Standing instructions (`§2`) |
| `.agents/skills/specplane/SKILL.md` and its folder | `harnesses/codex/templates/skills/specplane/` | Entry skill for all workflows (`§3`) |
| `.agents/skills/specplane/contracts/` | `harnesses/codex/templates/contracts/` | Contract text for each command (`§3`) |
| `.codex/config.toml` (one table) | built in the installer | The `[mcp_servers.specplane]` table (`specplane mcp`, `SPECPLANE_ADAPTER=codex`), added only when absent |

- Installed only when the user names Codex at setup. Setup follows `root:architecture/repository-layout §5`: owned files carry a version header and are replaced on refresh; a customised file is kept and reported with its path.
- Setup writes exactly one entry into Codex configuration: the registration of the Specplane MCP server (`§3`). It never writes any other Codex configuration, sandbox or approval settings, credentials, or other global files. It inspects each path component before writing and refuses a symbolic link in an installation path, naming it.
- Skill discovery is by directory: Codex scans `.agents/skills` from the working directory up to the repository root, and duplicate skill names are not merged (assumption). A plugin copy of the same skill and the repository copy must not both be installed; setup refuses the second and says which exists.

## §2 Standing instructions

Implements `codex-integration §2`.

The standing text is the fixed text of `root:architecture/agent-skills §2`. It is delivered as the marked block of `root:architecture/repository-layout §5` in `AGENTS.md`, created if absent, with the begin line carrying the Specplane version. With `harness.install_block: off`, nothing is written and setup prints that Codex has no standing instructions. A begin marker without an end marker, or markers that repeat, stop setup with an error and no change (`root:architecture/reference-cli §12.6`).

## §3 Skill and contracts

Implements `codex-integration §3`.

- `SKILL.md` has frontmatter `name: specplane` and a one-sentence `description`, then a table of the workflows and the path of each contract file. It tells Codex to read the matching contract before acting and to follow it in order (`root:architecture/agent-skills §1`).
- Each contract file is the harness-neutral contract with a version header, filled with its steering and documentation (`root:architecture/agent-skills §3`). It names harness actions, not CLI commands (`root:architecture/agent-skills §8`).
- Codex reaches the harness actions as tools of the Specplane MCP server (`root:architecture/reference-cli §12.1`), registered in Codex's configuration by setup (`§1`), with permission checks inside the CLI process. The registration is the table `[mcp_servers.specplane]` (`command = "specplane"`, `args = ["mcp"]`, `env = { SPECPLANE_ADAPTER = "codex" }`, `default_tools_approval_mode = "approve"`) in the project's `.codex/config.toml`, the project-scoped Codex configuration, which Codex honours only for trusted projects (checked against the Codex MCP documentation, 2026-11-11); setup tells the user that a project that is not trusted does not load it. It is not written to the user-level `~/.codex/config.toml`, which is a global file outside the repository (`§1`). Where a surface cannot use that registration, the tool channel Specplane provides on it is used instead. Which channel exists on each surface, and whether a native command can run without a model turn, is a capability the adapter reports (`capabilities()` of `root:architecture/reference-cli §12.6`). The approval line is there because every action checks the LLM role's permission in the core, so the host's per-tool prompt adds nothing, and without it a headless Codex run (`codex exec`) cannot call any action ("MCP tool call requires approval, but approval policy is never"); it mirrors Claude, where the session adapter allows `mcp__specplane`. The adapter claims only the `subagents` capability: Codex 0.169.0 was checked live, and a subagent it starts calls a Specplane tool. The audit records a subagent's call like the main agent's, so `subagent-identity` stays missing (evidence: `harnesses/codex/host-evidence/0.169.0-live-check.txt`). Until another surface is verified, the adapter reports no typed commands, and the contracts of commands that need one are not offered there (`codex-integration §3`).
- Bypass guards (`root:roles-and-permissions R58`): the Codex adapter claims no `bypass-guards` capability, because no Codex hook or environment export is verified, so setup reports it as missing and only the core's `llm_marker` check applies, and only to a process that already carries `SPECPLANE_ACTOR=llm`. Codex's `codex exec` and the CLI inside a Codex shell are therefore not blocked or marked.
- Strict mode (`root:roles-and-permissions R55.1`): the Codex adapter claims no `strict-mode` capability, because no Codex pre-tool hook is verified, so direct edits of specification files by Codex are not blocked; `validate` warns when `strict_mode.edit_block` is in force in a project with Codex installed. The pre-commit check of `git_commit_guard` and the file permissions of `os_permissions` do not depend on the harness, but the check recognises an LLM only when the process carries the marker, which Codex does not set.
- A contract whose capability check fails stops and names the missing capability, as `root:architecture/agent-skills §1` requires. It does not tell the user to run the CLI as a replacement (`root:harness R35.1`).

## §4 Blocking the CLI

Implements `codex-integration §4`.

The adapter installs a pre-tool check that uses core `isSpecplaneCommand` (`root:architecture/reference-cli §12.7`) only if the surface offers a hook or rule for shell calls that can be verified to deny. Otherwise `capabilities()` reports command blocking as missing and setup prints it.

## §5 Plan checkout

Implements `codex-integration §5`.

The plan-start contract has the integration launch the plan session in the checkout through its session adapter with `codex exec` (`root:harness R35.1`); only when the adapter reports the capability unavailable does it print the command that opens Codex there (assumption: `codex` started with the checkout as its working directory), shown as an error naming why. The plan-step contract begins by checking the branch `plan/<id>` and stops with the checkout path if the session is elsewhere.

## §6 Model identity

Implements `codex-integration §6`.

The adapter reports the model identity Codex exposes at the moment of a write, or `unknown`; `spec.create` and `spec.edit` use it as the author (`root:architecture/agent-skills §7.1`).

## §7 Testing

- Test T1 (deterministic): setup into a temporary project creates the four paths of `§1` (`.codex/config.toml` with its `[mcp_servers.specplane]` table, tested in `codex.test.ts`); a second setup changes nothing; an `AGENTS.md` with other text keeps it byte for byte outside the block; a symbolic link in an installation path is refused.
- Test T2 (deterministic): a begin marker without an end marker stops setup with no change.
- Test T3 (deterministic): every contract file carries a version header; an older copy is reported as a warning (`root:architecture/agent-skills §9`).
- Fake adapters do not certify Codex's real behaviour. Each surface needs a live check before its capabilities are claimed, with the user's approval.
