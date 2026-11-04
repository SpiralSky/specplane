---
id: feature/agent-integration
title: "Agent integration: agent instructions, skills, and policy enforcement"
status: review
author: mixed
---

<!-- Revision 2026-11-01: extension/core separation and contribution provenance agreed in conversation; existing lifecycle status is unchanged. Implementation and integration review remain pending. -->

<!-- Experimental development amendment 2026-11-01. Existing status records prior approval only; these branch changes await human final review. -->

# Agent integration: agent instructions, skills, and policy enforcement

This spec defines how Specplane integrates with AI agents: what instructions they follow, what skills (or slash commands) they execute, and how they enforce Specplane policies.

---

## Agent instructions

Specplane's instructions to agents come in two parts:

- **Standing instructions**: a short text the agent has in every session, because some rules apply even when no workflow is running. It starts with the orientation below and covers:
  1. **Finding things**: Specplane is in use; read the config before acting on specs or plans, and resolve paths from it.
  2. **Authorship policies**: what each `llm_role` value permits.
  3. **Precedence rules**: architecture spec first, feature spec for gaps, stop on contradictions.
  4. **Optional plans and commits**: managed plan execution uses its designated checkout and recording workflow. Ordinary work needs neither a plan nor Specplane commit trailers. Manual implementation-completion edits are valid.
  5. **Workflows**: how to invoke the workflow integrations in this harness.
- **Workflow procedures**: the step context contract, the HANDOFF.md format, the step commit, and the common flows (assist with a feature spec, draft an architecture spec, create a plan, execute the next step, finish a plan). These live in the workflow integrations (§ Workflow integrations), which load only when used.

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

An **extension** means any plugin, extension, or mod from a harness ecosystem that provides Specplane's agent workflows inside that harness. The term does not prescribe an ecosystem's packaging format. Each extension bundles a compatible Specplane core and owns its host integration; the standalone CLI remains complete for manual use, including explicit human approvals, without an extension.

The host is explicit at an extension's entry point. Specplane never selects a runtime from installed files, registry order, or a default. An entry point offering multiple hosts requires an explicit selection. Merely detecting an integration establishes neither permission to execute nor session capability.

Several extensions may coexist. Shared standing instructions remain harness-neutral; invocation details belong to each extension and must not replace another extension's guidance.

The framework defines what each workflow must accomplish (the policy rules, the HANDOFF.md contract, the authorship constraints, the precedence rules). It does **not** dictate how the harness implements the workflow: whether it uses subagents or a single session, which model it calls, what tools it invokes internally, or how it manages concurrency within a session.

Each harness may extend the base workflows with harness-specific features (e.g. per-step subagents, slash commands, hooks) without changing the base behaviour. Extensions are defined in the harness's overlay root and must not contradict the base specs.

---

## Workflow integrations

A **workflow integration** is a predefined, executable sequence of actions that an agent follows to complete a Specplane task. Harnesses expose these as slash commands, macros, or callable skills — the mechanism is a harness concern and is specified in the harness's overlay root.

Each harness skill must record the contract it implements: a reference to the contract by anchor (for example, the `plan-step` contract) together with a pin of the spec that defines it. `validate` reports when that spec has changed since the skill was last pinned, so skills no longer drift from the base specs through manual review alone.

Extensions deliver the complete applicable shared procedures to consumers, who need not have Specplane's own specifications. Dependencies include both shared procedures and harness-specific contracts: a shared change requires integration review even if the harness-specific contract is unchanged.

Mechanical commands execute directly through deterministic handlers, without asking a model to choose or reconstruct the operation. Reasoning workflows use deterministic preparation and validation around explicitly delegated agent work. Human decisions are collected explicitly before their transitions execute. A prompt-only skill does not constitute deterministic command dispatch. Host built-ins remain host-owned and are never shadowed by Specplane commands.

All workflow integrations read configuration from `.specplane/config.yaml` and resolve all spec paths from config. An integration that hardcodes a spec path is a defect.

### Required workflow integrations

#### `spec-assist`

Helps a user write a feature spec.

**Trigger**: user requests help with a feature spec.

**Contract**:
- Under `specs.feature.llm_role: assist`, follow refine-then-write (`feature/spec-policies#refine-then-write-llm_role-assist`): Describe, Refine, Finalise, then Write after the user approves the text.
- Under `specs.feature.llm_role: review`:
  1. Ask the user what the spec is about and who it is for.
  2. Suggest a structure (sections) without writing content.
  3. Ask clarifying questions to uncover edge cases and acceptance criteria.
  4. Review a draft the user has written, noting gaps, ambiguity, and architectural language.
  5. Never write the spec body.

**Policy enforcement**: under `draft`, the integration may also draft on request; under `none`, it declines and explains the policy.

#### `spec-draft-architecture`

Drafts an architecture spec from approved feature specs.

**Trigger**: user requests an architecture spec draft; `specs.architecture.llm_role: draft`.

**Contract**:
1. Read the feature specs the architecture spec will implement (as named by the user), plus any related ADRs.
2. Produce a draft architecture spec with `author: llm`, `status: draft`, and those feature specs in `implements`.
3. Mark gaps with a `<!-- GAP: ... -->` comment.
4. Create the file at the correct path resolved from config.

**Policy enforcement**: if `llm_role: assist`, follow refine-then-write instead of drafting from the feature specs alone; if `review`, review a draft instead of producing one; if `none`, decline.

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

**Contract**: equivalent to `specplane plan finish <current-plan-id>` (see `feature/plan-execution` § Finish flow).

#### `validate`

Runs full repository validation and presents actionable results.

**Contract**:
1. Invoke the CLI validate command, parse its JSON output, and summarise errors and warnings grouped by category, with a suggested fix for each error.
2. If `specs.llm_review: true`, additionally perform the LLM review stages: the architecture-leak review of feature specs (`feature/spec-policies#3-architecture-leak-guard`) and the contradiction review of extending overlay specs (`feature/spec-overlays`). Report findings as warnings. Skip specs whose type has `llm_role: none`.
3. If the CLI is unavailable, perform the checks by hand from the format specification, and say so.

#### `approve`

Approves specs, plans, and decision records, or reopens an approved spec, on the user's request.

**Trigger**: the user invokes it. The agent never approves on its own initiative, and never sets `status: approved`, `status: ready`, or `status: accepted` by editing a file directly.

**Contract**:
1. For each ID the user names, determine its kind (spec, plan, or decision record) and run the matching CLI command: `spec approve`, `plan approve`, or `decision accept` (see `feature/tooling`). Several IDs are passed in the user's order.
2. On a refusal, report the reasons and the fix for each, and stop.
3. When the user asks to reopen a spec, run `spec reopen` and show the specs it reports as needing to be reopened too; reopen those only if the user asks.

#### `plan-start`

Starts a plan so its steps can run.

**Contract**: equivalent to `specplane plan start <id>` (see `feature/plan-execution`). Report the checkout path. When the plan runs in a separate checkout, tell the user to open a new session there; that session is told the plan and its next step.

#### `decision-new`

Creates a decision record.

**Contract**:
1. Run `specplane decision new <title>`.
2. If the user describes the decision, write the body from that description following `feature/decisions#adr-body-structure`; otherwise leave the sections for the user.
3. Leave `status: proposed`; the user accepts the decision with the `approve` integration.

#### `plan-status`

Shows where plans stand.

**Contract**: equivalent to `specplane plan list --live`, with each plan's next step; when run in a plan's checkout, the current plan is highlighted.

#### `plan-abandon`

Abandons a plan.

**Contract**: ask the user to confirm, then run `specplane plan abandon <id>` (see `feature/plan-execution` § Abandoning a plan).

---

## Policy enforcement by agents

Agents must enforce Specplane policies when acting within a repository. This section specifies what "enforce" means for each policy.

### Authorship policy enforcement

| Config | Agent behaviour |
|--------|----------------|
| `authorship: user`, `llm_role: review` | Agent may not write the spec body. It asks questions, suggests changes and reviews, and applies only edits the user has approved exactly. |
| `authorship: user`, `llm_role: assist` | Agent writes the body only after Describe, Refine and Finalise, and only once the user approves the text. Sets `author: mixed`; never changes `status`. |
| `authorship: user`, `llm_role: draft` | Agent may produce a `draft` with `author: llm`; it notes that a human must revise it (setting `author: mixed` or `user`) before it moves to `review`. |
| `authorship: user`, `llm_role: none` | Agent may not edit or suggest changes to the spec body. Read-only. |
| `authorship: llm` | LLM authorship is permitted subject to the independently configured `llm_role`. Records actual authorship. |
| `authorship: either` | Either authorship kind is permitted; `llm_role` still limits agent actions. Records actual authorship. |

Authorship never overrides role limits. Under `none`, reading and implementing a spec remain permitted; editing, reviewing, or suggesting changes to its body do not. Contribution and approval provenance follow `feature/spec-system`; a model or session identity never grants policy authority.

When the agent is asked to do something the authorship policy forbids, it:
1. Declines the action.
2. Explains which policy applies and where it is configured.
3. Offers the closest permitted action.

### Architecture-leak guard enforcement

When reviewing feature text, distinguish observable technical requirements from incidental implementation choices. Report suspected misplaced detail with reasoning; do not delete a requirement solely because it names a technology or mechanism. `allow_architecture` documents intentional technical contracts. Explicit repository authorship policy still controls who may edit the text.

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

### Scenario 1: Agent asked to draft a feature spec under `llm_role: review`

Given `specs.feature.llm_role: review`,
When the user says "Write a feature spec for the search feature",
Then the agent responds: "I can't author this spec (policy: `specs.feature.llm_role: review`), but I can help you write it. What should the search feature do?"

### Scenario 1a: Agent asked to write a feature spec under `llm_role: assist` without a description

Given `specs.feature.llm_role: assist`,
When the user says "Write a feature spec for the search feature" without describing it,
Then the agent asks what the feature should do and writes nothing until the content is finalised.

### Scenario 2: Agent drafts an architecture spec

Given `specs.architecture.llm_role: draft`,
When the user asks for a draft of `architecture/search`,
Then the agent reads `feature/search` (approved), produces a draft, sets `author: llm`, `status: draft`, and creates the file.

### Scenario 3: Architecture-leak guard in agent output

Given the agent is assisting with `feature/search`,
And it proposes the sentence "The search index uses an inverted list stored in SQLite",
Then it flags the sentence as a possible implementation choice, explains why, and asks whether that mechanism is part of the intended feature contract; it does not silently remove it.

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

### Scenario 7: Skill contract drift is reported

Given a harness skill records the `plan-step` contract by anchor with a pin,
And the spec defining that contract has since changed,
When `validate` runs,
Then a skill-drift warning names the skill and the changed spec.

### Scenario 8: Existing AGENTS.md is preserved

Given a repository whose `AGENTS.md` contains the team's own rules,
When `specplane init` runs,
Then the team's text is unchanged and the Specplane standing instructions are appended as one managed block,
And running `specplane init` again after an upgrade replaces only that block.

### Scenario 9: Agent does not approve on its own

Given `feature/search` is `review` and the user says "This looks good",
When the agent responds,
Then it does not approve `feature/search`, and it tells the user that the `approve` integration approves it.

---

## Edge cases

- The standing instructions are versioned with Specplane. When Specplane adds new policies, re-running `specplane init` updates them; `specplane validate` warns when they are missing or older than the installed Specplane.
- A user who edits inside the managed block loses those edits on the next update; the block's begin marker says so.
- An agent running in a repository without Specplane configured (no `.specplane/config.yaml`) should not attempt to apply Specplane policies. The skills are designed to be no-ops or to prompt for initialisation in this case.
- Skills must be idempotent: running `plan-step` after the last step is complete reports that and changes nothing; running it on a `blocked` step reports the blocker and changes nothing.

## Extension-owned conductor integration

An extension may offer automated plan execution using the shared conductor and its explicitly supplied host adapter. Unsupported session or budget capabilities are refusals, never a fallback to another host. Automation never approves, finishes or merges plans. A consideration is a blocked step, unresolved proposal/assumption, finish-review readiness, restack, divergence, dirty checkout, exhausted execution limit, or failure. The conductor stops and presents the decision with a resolving command. Delivery follows `execution.notify` and remains user-owned. Distinct plans may run concurrently; one step per plan may run at a time. Restarting never duplicates a live session; attach to that session instead. A known non-running session can be resumed with its stable identity.

Acceptance: a mechanical command makes zero model calls; a missing adapter launches nothing; co-installed extensions leave shared guidance unchanged; changing a shared workflow contract requires both extensions to be reviewed.

## Shared orientation and product documentation

The standing orientation explains purpose before commands:

> Specplane tracks intended behaviour, specification review, and implementation completion separately. Plans are optional, and branches have no prescribed role. A reviewed spec may describe functionality not yet implemented; specs and implementation may also change together. Completion is a declaration; its fingerprint identifies the definition assessed, not proof of code correctness. Changed definitions may require reassessment. Read repository configuration for paths and explicit policies. Use `specplane docs` for concepts and the relevant managed workflow before invoking it.

The short orientation is always delivered through the existing managed-instruction mechanism. Detailed conceptual, command and workflow documentation comes from the same bundled source for people, CLI clients, and harness integrations. Consumers need neither Specplane's source repository nor internet access. Product documentation is distinct from the consuming project's specs. Installed repository guidance links to stable documentation topic IDs, not paths to files available only in Specplane's own repository.

Each release reviews orientation, documentation, command examples and workflow procedures together against implemented capabilities. Record documentation/contract versions and source fingerprints. New draft source specs do not automatically advertise unreleased commands. Validation warns about stale or missing managed guidance; explicit initialization/refresh updates only owned content and preserves user instructions and customized assets under the existing upgrade rules. Checking freshness never performs an implicit upgrade.

Harness documentation entry points use the same compatible core documentation operation. Host-specific invocation and capability notices remain separate from the shared topic. Optional semantic retrieval may improve discovery later, but is not needed for initial onboarding and cannot replace always-present orientation or authoritative versioned topic text.

Acceptance is exercised in a separate consumer fixture with no Specplane source specs: ordinary work without a plan, manual completion edits, changed completed requirements, arbitrary branches, offline docs, and co-installed harnesses. Test deterministic delivery/content/version parity separately from agent interpretation; an agent exercise is evidence of those cases, not proof all agents understand the workflow. An agent does not invent a plan requirement or claim a matching spec hash proves the implementation.
