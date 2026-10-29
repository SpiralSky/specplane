---
id: feature/claude-integration
title: Claude Code integration
status: review
author: mixed
---

# Claude Code integration

This spec describes features of Specplane that are specific to Claude Code as the agent harness. It is an overlay spec in the `claude` root; it describes additional capabilities beyond those in the base spec set.

See `feature/agent-integration` (base) for the general agent integration model. This spec adds Claude Code–specific details.

---

## Claude Code as the harness

Claude Code is an AI coding assistant that operates in a terminal, reads files from the repository, and executes shell commands. In the Specplane context, Claude Code:

- Receives the Specplane standing instructions in every session, and workflow procedures through slash commands.
- Executes Specplane CLI commands.
- Writes spec and plan files directly.
- Runs plan steps by reading the step file and HANDOFF.md, executing tasks, and committing.

---

## Standing instructions

Claude Code receives the standing instructions (`feature/agent-integration` § Agent instructions) from a Specplane-owned project rules file that Claude Code loads in every session. The file:

1. Contains the standing instructions, with the Specplane slash commands as the way to run workflows.
2. Adds a few Claude Code–specific conventions (which tools to prefer, commit attribution).

Specplane does not create or edit `CLAUDE.md`; it belongs to the repository's maintainers. Because the rules file is Specplane-owned, upgrading Specplane updates it without touching user content.

---

## Slash commands

The base spec (`feature/agent-integration`) defines which workflow integrations Specplane requires and their policy contracts. In Claude Code, each integration is exposed as a **slash command** implemented as a project skill committed to the repository.

Project skills are the chosen mechanism for this harness because they version with the repository, appear automatically in the slash command menu, and are auditable markdown. Each skill restates the workflow contract from the base specs and adds Claude Code–specific invocation detail. Skills must not redefine policy — they defer to the base specs.

| Slash command | Base integration | Description |
|---------------|-----------------|-------------|
| `/spec-assist` | `spec-assist` | Help the user write a feature spec (without authoring it) |
| `/spec-draft-architecture` | `spec-draft-architecture` | Draft an architecture spec from feature specs |
| `/plan-create` | `plan-create` | Create a new plan interactively |
| `/plan-step` | `plan-step` | Execute the next step of the current plan |
| `/plan-finish` | `plan-finish` | Run the finish flow for the current plan |
| `/validate` | `validate` | Run `specplane validate` and summarise results |

---

## Subagents per step

Claude Code may run a step session as a subagent. This is an **opt-in** harness feature; it does not change the base step contract.

A step opts in by declaring `use_subagent: true` in its frontmatter (see `feature/plan-steps`). When enabled, the `/plan-step` skill:
1. Launches a **fresh** subagent — one that starts with an empty context rather than inheriting the parent session's — told where to find the step file, HANDOFF.md, and the context items listed in the step frontmatter.
2. The subagent loads that context itself, executes the tasks, sets the step's final status, appends to HANDOFF.md, and commits.
3. The subagent returns a summary to the parent session.

The parent session retains only the subagent's summary, not the step's context or tool output — keeping the main context clean for subsequent steps. Because a subagent cannot ask the user questions mid-step, it handles spec contradictions in unattended mode (see `feature/spec-precedence`).

**Default**: `use_subagent` is absent (off) unless declared in the step. The harness does not enable it globally.

---

## Hooks

Claude Code supports hooks — shell commands that run before or after Claude tool calls. Specplane can use hooks for:

- **Pre-commit validation**: run `specplane validate` before the agent makes a git commit, and block the commit if there are errors (warnings are allowed).
- **Policy guard**: when the agent edits a spec, apply the spec type's `llm_role`: refuse under `none`, ask the user to approve the exact edit under `assist`, allow under `draft`. Policy is enforced when it matters instead of relying on the agent to remember it.
- **Session context**: when a session starts in a plan's checkout, tell the agent which plan it is in and which step is next.
- **Post-step HANDOFF.md check**: verify that HANDOFF.md was updated by a step commit.
- **Auto-generate PLANS.md**: run `specplane generate` after a plan file changes.

A **status line** shows the current plan, step progress, and blockers when the session is in a plan checkout.

**Defaults**: pre-commit validation, the policy guard, and session context are enabled by Specplane's Claude Code setup; the status line is enabled unless the user already has one. The other hooks are documented and opt-in. Hooks are registered in Claude Code's project settings, which the user may also edit directly.

---

## Sessions in worktrees and the cloud

A Claude Code session works on one plan, one step at a time, whether it runs in a local worktree, as a subagent, or as a cloud session. Several sessions may work on different plans in parallel; only one works on a given plan at a time. A session that finds its plan advanced elsewhere stops rather than overwriting that work. Sessions on other machines publish each finished step, so the next session and the live view see it.

Everything required for this (standing instructions, slash commands, hooks) works in cloud sessions. The live view and Specplane mode below are optional local additions.

---

## Live view and Specplane mode (optional)

An optional Claude Code plugin adds:

- **Live view**: a panel beside the chat listing active plans across all worktrees, remote branches, and cloud sessions, with step progress, the next step, blockers, and which agent session made the last step. It is read-only and offers the command to continue a plan in its checkout.
- **Specplane mode**: a session mode (`step`, `spec`, or off). `step` mode, entered automatically in a plan checkout, keeps the agent's edits inside the checkout and the current step and shows the step's acceptance-criteria progress. `spec` mode shows the authorship policy and spec templates while writing specs.

The plugin only adds visibility and tightens existing rules. Without it, every rule still holds.

---

## Memory integration

Claude Code has a persistent memory system. Specplane-related memories to consider recording:

- The active plan ID and current step number.
- Open questions found during step execution.
- Spec gaps discovered and not yet filed.

> **Open question OQ-5** (see `docs/OPEN-QUESTIONS.md`): Should Specplane define a standard set of memory keys for Claude Code integration, or leave memory entirely to the user's preference? Proposed default: define a recommended set in this spec, but do not enforce it.

---

## Context loading in Claude Code

Claude Code agents load context by reading files. The step context contract (`feature/plan-steps`) applies. For Claude Code specifically:

- The agent should use the `Read` tool (not `cat`) for spec and plan files, so the content is in the context window.
- The agent should use `Glob` to discover files in a directory rather than `ls`.
- For large spec files, the agent may read only the relevant sections using offset and limit.

---

## Acceptance scenarios

### Scenario 1: `/plan-step` skill reads HANDOFF.md

Given the user invokes `/plan-step` on plan `2026-10-28-search-indexer`,
And step 02 is the next incomplete step,
When the skill runs,
Then it reads `plans/2026-10-28-search-indexer/HANDOFF.md` and `plans/2026-10-28-search-indexer/steps/02-graph-builder.md` before executing tasks.

### Scenario 2: Pre-commit hook blocks invalid spec

Given the pre-commit validation hook is enabled,
And a spec file has a frontmatter error,
When the agent attempts to commit,
Then the hook runs, finds the error, and the commit is blocked with the validation error message.

### Scenario 3: CLAUDE.md is left alone

Given a repository with its own `CLAUDE.md`,
When `specplane init --harness claude` runs,
Then `CLAUDE.md` is unchanged,
And a new Claude Code session still has the standing instructions and the list of slash commands.

### Scenario 4: Policy guard asks before a feature-spec edit

Given `specs.feature.llm_role: assist`,
When the agent tries to edit a feature spec,
Then Claude Code asks the user to approve that exact edit before it is applied.

### Scenario 5: Fresh session in a plan worktree

Given plan `2026-10-28-search-indexer` has step 01 done and step 02 pending,
When a new Claude Code session starts in that plan's worktree,
Then the agent is told it is in that plan and that step 02 is next, before the user types anything.

### Scenario 6: Skill refuses to draft feature spec under `llm_role: assist`

Given `specs.feature.llm_role: assist`,
When the user invokes `/spec-assist` and asks "Write the feature spec for search",
Then the skill offers to help (ask questions, review a draft) but does not produce the spec body.

---

## Open questions

IDs refer to `docs/OPEN-QUESTIONS.md`.

| ID | Question | Proposed default |
|----|----------|-----------------|
| OQ-5 | Standard memory keys for Claude Code? | Define recommended set, do not enforce |

Resolved: OQ-2 (skills vs. bash aliases — § Slash commands), OQ-3 (subagents per step — § Subagents per step), OQ-4 (default hooks — § Hooks).
