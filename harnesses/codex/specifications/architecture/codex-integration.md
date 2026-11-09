---
id: architecture/codex-integration
title: Codex integration implementation
status: approved
approval:
  by:
    llm: claude-sonnet-5-5
    delegated-by: spiralsky
  date: 2026-11-09
  commit: 8e87b5645401e1e6da089d7fb4a28e25573c4ed2
  note: approved by the LLM, not a human, under the user's 2026-11-09 delegation (hand-edited; see docs/work-records/2026-11-09-spec-format.md)
authors:
  - llm: claude-sonnet-5-5
    contribution: drafted
implements: [codex-integration §2, codex-integration §3, codex-integration §4, codex-integration §5, codex-integration §6]
references: [root:architecture/agent-skills §1, root:architecture/agent-skills §9, codex-integration §1, root:architecture/repository-layout §5, root:architecture/agent-skills §2, root:architecture/reference-cli §12.6, root:architecture/agent-skills §3, root:architecture/agent-skills §8, root:harness R35.1, root:architecture/reference-cli §12.7, root:architecture/agent-skills §7.1]
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

- Installed only when the user names Codex at setup. Setup follows `root:architecture/repository-layout §5`: owned files carry a version header and are replaced on refresh; a customised file is kept and reported with its path.
- Setup never writes Codex configuration, sandbox or approval settings, credentials, or global files. It inspects each path component before writing and refuses a symbolic link in an installation path, naming it.
- Skill discovery is by directory: Codex scans `.agents/skills` from the working directory up to the repository root, and duplicate skill names are not merged (assumption). A plugin copy of the same skill and the repository copy must not both be installed; setup refuses the second and says which exists.

## §2 Standing instructions

Implements `codex-integration §2`.

The standing text is the fixed text of `root:architecture/agent-skills §2`. It is delivered as the marked block of `root:architecture/repository-layout §5` in `AGENTS.md`, created if absent, with the begin line carrying the Specplane version. With `harness.install_block: off`, nothing is written and setup prints that Codex has no standing instructions. A begin marker without an end marker, or markers that repeat, stop setup with an error and no change (`root:architecture/reference-cli §12.6`).

## §3 Skill and contracts

Implements `codex-integration §3`.

- `SKILL.md` has frontmatter `name: specplane` and a one-sentence `description`, then a table of the workflows and the path of each contract file. It tells Codex to read the matching contract before acting and to follow it in order (`root:architecture/agent-skills §1`).
- Each contract file is the harness-neutral contract with a version header, filled with its steering and documentation (`root:architecture/agent-skills §3`). It names harness actions, not CLI commands (`root:architecture/agent-skills §8`).
- Codex reaches the harness actions through the tool channel Specplane provides on the surface. Which channel exists on each surface, and whether a native command can run without a model turn, is a capability the adapter reports (`capabilities()` of `root:architecture/reference-cli §12.6`). Until a surface is verified, the adapter reports no typed commands, and the contracts of commands that need one are not offered there (`codex-integration §3`).
- A contract whose capability check fails stops and names the missing capability, as `root:architecture/agent-skills §1` requires. It does not tell the user to run the CLI as a replacement (`root:harness R35.1`).

## §4 Blocking the CLI

Implements `codex-integration §4`.

The adapter installs a pre-tool check that uses core `isSpecplaneCommand` (`root:architecture/reference-cli §12.7`) only if the surface offers a hook or rule for shell calls that can be verified to deny. Otherwise `capabilities()` reports command blocking as missing and setup prints it.

## §5 Plan checkout

Implements `codex-integration §5`.

The plan-start contract prints the command that opens Codex in the checkout (assumption: `codex` started with the checkout as its working directory). The plan-step contract begins by checking the branch `plan/<id>` and stops with the checkout path if the session is elsewhere. Background launching is not implemented; the capability is reported as missing.

## §6 Model identity

Implements `codex-integration §6`.

The adapter reports the model identity Codex exposes at the moment of a write, or `unknown`; `spec.create` and `spec.edit` use it as the author (`root:architecture/agent-skills §7.1`).

## §7 Testing

- Test (deterministic): setup into a temporary project creates the three paths of `§1`; a second setup changes nothing; an `AGENTS.md` with other text keeps it byte for byte outside the block; a symbolic link in an installation path is refused.
- Test (deterministic): a begin marker without an end marker stops setup with no change.
- Test (deterministic): every contract file carries a version header; an older copy is reported as a warning (`root:architecture/agent-skills §9`).
- Fake adapters do not certify Codex's real behaviour. Each surface needs a live check before its capabilities are claimed, with the user's approval.
