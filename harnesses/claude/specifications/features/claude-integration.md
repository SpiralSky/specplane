---
id: feature/claude-integration
title: Claude Code integration
status: review
author: mixed
extends: [feature/agent-integration, feature/plan-steps, feature/spec-policies]
based_on: { feature/agent-integration: "1e7327b", feature/plan-steps: "00332af", feature/spec-policies: "84f50b3" }
---

<!-- Revision 2026-11-01: extension/core separation and contribution provenance agreed in conversation; existing lifecycle status is unchanged. Implementation and integration review remain pending. -->

<!-- Experimental development amendment 2026-11-01. Existing status records prior approval only; these branch changes await human final review. -->

# Claude Code integration

This spec describes features of Specplane that are specific to Claude Code as the agent harness. It is an extending overlay spec in the `claude` root: it extends `feature/agent-integration`, `feature/plan-steps`, and `feature/spec-policies`, adding Claude Code–specific capabilities without contradicting them. Its `based_on` pins record the versions of those specs it was last reviewed against; `validate` warns when one changes.

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

Claude Code receives the standing instructions (`feature/agent-integration#agent-instructions`) from a Specplane-owned project rules file that Claude Code loads in every session. The file:

1. Contains the standing instructions, with the Specplane slash commands as the way to run workflows.
2. Adds a few Claude Code–specific conventions (which tools to prefer, commit attribution).

Specplane does not create or edit `CLAUDE.md`; it belongs to the repository's maintainers. Because the rules file is Specplane-owned, upgrading Specplane updates it without touching user content.

---

## Slash commands

The base spec (`feature/agent-integration`) defines which workflow integrations Specplane requires and their policy contracts. In Claude Code, a plugin containing a mod provides deterministic slash-command handlers and bundles a compatible Specplane core. Skills deliver reasoning phases; they do not implement mechanical commands by asking the agent to reconstruct a procedure.

Each workflow references and pins every applicable shared procedure and its Claude-specific contract. The extension packages these procedures for consumers and adds host invocation details without redefining policy. Mechanical commands parse arguments, invoke validated core operations, and display results without a model turn. Reasoning workflows invoke agent work only after deterministic preparation; final recording and policy checks run through the core. Approval commands collect the human decision directly and never use model output as authorization.

Host built-ins, including `/resume`, are not overridden. Commands are registered only on supported surfaces; missing native dispatch is reported explicitly, with the manual CLI available. Project skills can provide reasoning-only fallback workflows but must not masquerade as native deterministic handlers. Multiple contributing models are retained even when the user switches models inside a session.

| Slash command | Base integration | Description |
|---------------|-----------------|-------------|
| `/spec-assist` | `spec-assist` | Help the user write a feature spec (without authoring it) |
| `/spec-draft-architecture` | `spec-draft-architecture` | Draft an architecture spec from feature specs |
| `/plan-create` | `plan-create` | Create a new plan interactively |
| `/plan-step` | `plan-step` | Execute the next step of the current plan |
| `/plan-finish` | `plan-finish` | Run the finish flow for the current plan; without the CLI, prints the manual merge sequence |
| `/validate` | `validate` | Run `specplane validate` and summarise results |
| `/approve` | `approve` | Approve specs, plans, or decision records by ID (`--reopen` reopens an approved spec); only when the user invokes it |
| `/plan-start` | `plan-start` | Start a plan and say where to continue it |
| `/decision-new` | `decision-new` | Create a decision record, optionally written from the user's description |
| `/plan-status` | `plan-status` | Show plans with live status and next step |
| `/plan-abandon` | `plan-abandon` | Abandon a plan after confirmation |

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
- **Policy guard**: when the agent edits a spec, apply the spec type's `llm_role` as defined in `feature/spec-policies#meaning-of-each-value`; under `review` or `assist`, ask the user to approve the exact edit. Deny any agent edit that sets a spec to `approved`, a plan to `ready`, or a decision record to `accepted`; those changes go through `/approve`. Policy is enforced when it matters instead of relying on the agent to remember it.
- **Session context**: when a session starts in a plan's checkout, tell the agent which plan it is in and which step is next.
- **Post-step HANDOFF.md check**: verify that HANDOFF.md was updated by a step commit.
- **Auto-generate PLANS.md**: run `specplane generate` after a plan file changes.

A **status line** shows the current plan, step progress, and blockers when the session is in a plan checkout.

**Defaults**: pre-commit validation, the policy guard, and session context are enabled by Specplane's Claude Code setup; the status line is enabled unless the user already has one. The other hooks are documented and opt-in. Hooks are registered in Claude Code's project settings, which the user may also edit directly.

---

## Sessions in worktrees and the cloud

A Claude Code session works on one plan, one step at a time, whether it runs in a local worktree, as a subagent, or as a cloud session. Several sessions may work on different plans in parallel; only one works on a given plan at a time. A session that finds its plan advanced elsewhere stops rather than overwriting that work. Sessions on other machines publish each finished step, so the next session and the live view see it.

Cloud sessions use the same shared workflow contract, but extension delivery, native command handlers, and hooks must be verified for that surface. Missing native dispatch is reported explicitly; reasoning-only workflows and the manual CLI remain available where supported. The live view and mode display below are optional UI features, not requirements for executing a step.

---

## Live view and Specplane mode (optional)

Optional interface features of the Claude extension add:

- **Live view**: a panel beside the chat listing active plans across all worktrees, remote branches, and cloud sessions, with step progress, the next step, blockers, and which agent session made the last step. It is read-only and offers the command to continue a plan in its checkout.
- **Specplane mode**: a session mode (`step`, `spec`, or off). `step` mode, entered automatically in a plan checkout, keeps the agent's edits inside the checkout and the current step and shows the step's acceptance-criteria progress. `spec` mode shows the authorship policy and spec templates while writing specs.

These interface features add visibility and tighten existing rules; command execution does not depend on enabling a pane. Without the extension, the complete manual CLI remains available and repository policy still applies. Availability in cloud/headless sessions is declared and checked separately from interactive UI support.

---

## Memory integration

Claude Code has a persistent memory system. Memory is per-user and is never the source of truth: a plan's progress lives in its `HANDOFF.md`, and memory only points to it.

Specplane recommends the memory names below, so that sessions record the same things in the same place. They are recommendations only; Specplane does not enforce or validate them.

| Memory name | Records |
|-------------|---------|
| `specplane-active-plan` | The active plan ID and current step number, as a pointer to the plan's `HANDOFF.md`. |
| `specplane-open-questions` | Open questions found during step execution and not yet recorded in the plan's `HANDOFF.md`. |
| `specplane-spec-gaps` | Spec gaps discovered and not yet recorded in the plan's `spec-gaps.md`. |

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

Given `specs.feature.llm_role: review` or `assist`,
When the agent tries to edit a feature spec,
Then Claude Code asks the user to approve that exact edit before it is applied.

### Scenario 5: Fresh session in a plan worktree

Given plan `2026-10-28-search-indexer` has step 01 done and step 02 pending,
When a new Claude Code session starts in that plan's worktree,
Then the agent is told it is in that plan and that step 02 is next, before the user types anything.

### Scenario 6: Skill refuses to draft feature spec under `llm_role: review`

Given `specs.feature.llm_role: review`,
When the user invokes `/spec-assist` and asks "Write the feature spec for search",
Then the skill offers to help (ask questions, review a draft) but does not produce the spec body.

### Scenario 6a: Skill writes a finalised feature spec under `llm_role: assist`

Given `specs.feature.llm_role: assist`,
When the user invokes `/spec-assist`, describes the feature, refines it with the agent, and confirms the Finalise summary,
Then the skill shows the written body and writes the file only after the user approves it.

### Scenario 6b: Agent cannot approve by editing

Given `feature/search` is `review`,
When the agent tries to edit it to `status: approved`,
Then the policy guard denies the edit and points to `/approve`.

### Scenario 6c: `/approve` on an overlay re-pins it

Given `feature/spec-policies` is approved and committed, and `claude:feature/claude-integration` is `review` with a stale pin of it,
When the user runs `/approve claude:feature/claude-integration`,
Then one commit refreshes the pin and sets the overlay to `approved`.

### Scenario 7: Skill contract drift

Given the `/plan-step` skill pins the spec that defines the `plan-step` contract,
And that spec has since changed,
When the user runs `/validate`,
Then the summary includes a skill-drift warning for the skill, and the user is told to review the diff and re-pin.

---

## Open questions

None. IDs refer to `docs/OPEN-QUESTIONS.md`.

Resolved: OQ-2 (skills vs. bash aliases — § Slash commands), OQ-3 (subagents per step — § Subagents per step), OQ-4 (default hooks — § Hooks), OQ-5 (memory names — § Memory integration).

## Experimental background conductor

The conductor uses an observable session in the Specplane-owned checkout, not a second harness worktree. A harness alert is surfaced only through the adapter; external delivery remains governed by existing user settings. Specplane does not enable or bypass notifications. The local Claude executable must support the required capabilities; unavailable or incompatible versions are refused rather than guessed compatible. No live Claude session has been verified in the Dot cloud environment used for this branch.
