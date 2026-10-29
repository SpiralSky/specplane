---
id: feature/agent-integration
title: "Agent integration: agent instructions, skills, and policy enforcement"
status: review
author: mixed
---

# Agent integration: agent instructions, skills, and policy enforcement

This spec defines how Specplane integrates with AI agents: what instructions they follow, what skills (or slash commands) they execute, and how they enforce Specplane policies.

---

## Agent instructions

Specplane's instructions to agents come in two parts:

- **Standing instructions**: a short text the agent has in every session, because some rules apply even when no workflow is running. It covers only:
  1. **Finding things**: Specplane is in use; read the config before acting on specs or plans, and resolve paths from it.
  2. **Authorship policies**: what each `llm_role` value permits.
  3. **Precedence rules**: architecture spec first, feature spec for gaps, stop on contradictions.
  4. **Plans and commits**: work on a plan only in its checkout, one step at a time; HANDOFF.md is the source of truth; commit messages follow the Specplane format.
  5. **Workflows**: how to invoke the workflow integrations in this harness.
- **Workflow procedures**: the step context contract, the HANDOFF.md format, the step commit, and the common flows (start a spec, assist with a feature spec, draft an architecture spec, create a plan, execute the next step, finish a plan). These live in the workflow integrations (§ Workflow integrations), which load only when used.

### Delivery without overwriting user files

Instruction files such as `AGENTS.md` and `CLAUDE.md` belong to the repository's maintainers. Specplane must never overwrite or reorder their content.

- A harness delivers the standing instructions through a file Specplane owns, when the harness supports one (for example a rules directory). Specplane may overwrite its own files on update.
- `AGENTS.md` is the harness-neutral fallback. Specplane writes the standing instructions there as a single **managed block** with clear begin and end markers. It changes only the text between the markers, and it appends the block when the file has none.
- Users may write anything outside the block, including their own rules for agents.

### What the standing instructions must NOT do

- Hardcode paths. Paths are always resolved from config.
- Duplicate policy. They reference `feature/spec-policies` and `feature/spec-precedence` rather than redefining the rules.
- Contain procedures. Procedures belong to the workflow integrations.

### Agent-made changes are attributable

Every commit an agent makes in a Specplane workflow identifies the workflow, the plan and step (when there is one), and the agent session that made it, without replacing the human's or bot account's git identity. A reviewer can tell from history alone which session produced which step, even when steps run on different machines.

---

## Harness non-interference principle

The framework defines what each workflow must accomplish (the policy rules, the HANDOFF.md contract, the authorship constraints, the precedence rules). It does **not** dictate how the harness implements the workflow: whether it uses subagents or a single session, which model it calls, what tools it invokes internally, or how it manages concurrency within a session.

Each harness may extend the base workflows with harness-specific features (e.g. per-step subagents, slash commands, hooks) without changing the base behaviour. Extensions are defined in the harness's overlay root and must not contradict the base specs.

---

## Workflow integrations

A **workflow integration** is a predefined, executable sequence of actions that an agent follows to complete a Specplane task. Harnesses expose these as slash commands, macros, or callable skills — the mechanism is a harness concern and is specified in the harness's overlay root.

All workflow integrations read configuration from `.specplane/config.yaml` and resolve all spec paths from config. An integration that hardcodes a spec path is a defect.

### Required workflow integrations

#### `spec-assist`

Assists a user in writing a feature spec without authoring it.

**Trigger**: user requests help with a feature spec; `specs.feature.llm_role: assist`.

**Contract**:
1. Ask the user what the spec is about and who it is for.
2. Suggest a structure (sections) without writing content.
3. Ask clarifying questions to uncover edge cases and acceptance criteria.
4. Review a draft the user has written, noting gaps, ambiguity, and architectural language.
5. Must not produce the full spec body unprompted.

**Policy enforcement**: if `specs.feature.llm_role: none`, the integration declines and explains the policy.

#### `spec-draft-architecture`

Drafts an architecture spec from approved feature specs.

**Trigger**: user requests an architecture spec draft; `specs.architecture.llm_role: draft`.

**Contract**:
1. Read the feature specs the architecture spec will implement (as named by the user), plus any related ADRs.
2. Produce a draft architecture spec with `author: llm`, `status: draft`, and those feature specs in `implements`.
3. Mark gaps with a `<!-- GAP: ... -->` comment.
4. Create the file at the correct path resolved from config.

**Policy enforcement**: if `llm_role: assist`, review a draft instead of producing one; if `none`, decline.

#### `plan-create`

Creates a new plan interactively.

**Contract**:
1. Prompt for plan title, specs, and dependencies.
2. Validate that the specs and dependencies exist; warn (do not block) if specs do not yet meet `require_approved_specs`, since that is checked when the plan starts.
3. Suggest a step decomposition following the step grouping guidance in `feature/plan-steps`, with a `context` list for each step.
4. Create the plan folder, PLAN.md (`status: draft`), and step files with frontmatter. A human sets `status: ready`.

#### `plan-step`

Executes the next step of a plan (see `feature/plan-steps` for "next step").

**Contract**:
1. Identify the plan being worked on (current branch or user-specified).
2. Find the next step. If it is `blocked`, report the blocking issue and stop. If there is none, report that all steps are complete.
3. Load the context items listed in the step's `context` frontmatter field plus all prior HANDOFF.md sections.
4. Execute the tasks, following the precedence rules.
5. Check the step's acceptance criteria.
6. Set the step's final status (`done`, or `blocked` if a blocking issue prevents the criteria being met) in its frontmatter.
7. Append the step's entry to HANDOFF.md.
8. Commit with the required message format.

**Policy enforcement**:
- If not on a plan branch, warn the user before proceeding.
- Do not invoke the finish flow automatically after the last step; prompt the user.

#### `plan-finish`

Runs the finish flow for the current plan.

**Contract**: equivalent to `specplane plan finish <current-plan-id>`. Runs verification, sets plan status to done, archives, rebases, opens PR (or merges locally).

#### `validate`

Runs full repository validation and presents actionable results.

**Contract**:
1. Invoke the CLI validate command, parse its JSON output, and summarise errors and warnings grouped by category, with a suggested fix for each error.
2. If `specs.llm_review: true`, additionally perform the LLM review stages: the architecture-leak review of feature specs (`feature/spec-policies` §3) and the contradiction review of extending overlay specs (`feature/spec-overlays`). Report findings as warnings. Skip specs whose type has `llm_role: none`.
3. If the CLI is unavailable, perform the checks by hand from the format specification, and say so.

---

## Policy enforcement by agents

Agents must enforce Specplane policies when acting within a repository. This section specifies what "enforce" means for each policy.

### Authorship policy enforcement

| Config | Agent behaviour |
|--------|----------------|
| `authorship: user`, `llm_role: assist` | Agent may not draft spec body. It offers to assist (ask questions, review). |
| `authorship: user`, `llm_role: draft` | Agent may produce a `draft` with `author: llm`; it notes that a human must revise it (setting `author: mixed` or `user`) before it moves to `review`. |
| `authorship: user`, `llm_role: none` | Agent may not edit or suggest changes to the spec body. Read-only. |
| `authorship: llm` | Agent may author. Sets `author: llm`. |
| `authorship: either` | No restriction. Agent notes its role in `author` field. |

When the agent is asked to do something the authorship policy forbids, it:
1. Declines the action.
2. Explains which policy applies and where it is configured.
3. Offers the closest permitted action.

### Architecture-leak guard enforcement

When the agent writes or edits a feature spec, it applies the architecture-leak check to its own output before saving:
- Checks for paths, identifiers, technology names, schemas.
- If found, removes or replaces the architecture detail and notes the change.
- If `allow_architecture: true` is set, proceeds without checking.

### Spec ordering enforcement

Before setting an architecture spec to `approved`, the agent checks that all specs in its `implements` list are `approved` (when `require_approved_features: true`). If not, it reports the blocked transition and does not make the change.

### Contradiction handling during step execution

If the agent encounters a contradiction between specs while executing a step, it follows the rules in `feature/spec-precedence` (which also defines how attended and unattended sessions are told apart):
- In attended mode: stops and presents the contradiction.
- In unattended mode: records a `BLOCKED:` item in HANDOFF.md, continues with unaffected tasks, and ends the step `blocked` if its acceptance criteria cannot be met.

---

## MCP server (future work)

A Model Context Protocol (MCP) server wrapping the Specplane CLI is planned as a future addition. It will expose spec and plan operations as tool calls, allowing MCP-capable agents to query and modify Specplane state programmatically. This is not part of the initial release.

---

## Acceptance scenarios

### Scenario 1: Agent asked to draft a feature spec under `llm_role: assist`

Given `specs.feature.llm_role: assist`,
When the user says "Write a feature spec for the search feature",
Then the agent responds: "I can't author this spec (policy: `specs.feature.llm_role: assist`), but I can help you write it. What should the search feature do?"

### Scenario 2: Agent drafts an architecture spec

Given `specs.architecture.llm_role: draft`,
When the user asks for a draft of `architecture/search`,
Then the agent reads `feature/search` (approved), produces a draft, sets `author: llm`, `status: draft`, and creates the file.

### Scenario 3: Architecture-leak guard in agent output

Given the agent is assisting with `feature/search`,
And it proposes the sentence "The search index uses an inverted list stored in SQLite",
Then before saving, it removes the sentence and notes: "Removed architecture detail ('inverted list', 'SQLite') from feature spec draft."

### Scenario 4: `plan-step` skill oriented from HANDOFF.md

Given step 02 is the next incomplete step,
And HANDOFF.md has a completed entry for step 01,
When `plan-step` runs,
Then the agent reads HANDOFF.md and step 02, not step 01 or the diff.

### Scenario 5: Spec path resolved from config, not hardcoded

Given the config has `spec_roots[0].path: specifications/` (not the default),
When any skill looks up `feature/search`,
Then it resolves the path to `specifications/features/search.md`, not `docs/specifications/features/search.md`.

### Scenario 6: Agent declines spec action with `llm_role: none`

Given `specs.feature.llm_role: none`,
When the user says "Can you check my feature spec for issues?",
Then the agent responds: "Policy (`specs.feature.llm_role: none`) prevents me from reviewing this spec."

### Scenario 7: Existing AGENTS.md is preserved

Given a repository whose `AGENTS.md` contains the team's own rules,
When `specplane init` runs,
Then the team's text is unchanged and the Specplane standing instructions are appended as one managed block,
And running `specplane init` again after an upgrade replaces only that block.

---

## Edge cases

- The standing instructions are versioned with Specplane. When Specplane adds new policies, re-running `specplane init` updates them; `specplane validate` warns when they are missing or older than the installed Specplane.
- A user who edits inside the managed block loses those edits on the next update; the block's begin marker says so.
- An agent running in a repository without Specplane configured (no `.specplane/config.yaml`) should not attempt to apply Specplane policies. The skills are designed to be no-ops or to prompt for initialisation in this case.
- Skills must be idempotent: running `plan-step` after the last step is complete reports that and changes nothing; running it on a `blocked` step reports the blocker and changes nothing.
