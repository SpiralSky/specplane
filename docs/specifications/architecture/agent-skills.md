---
id: architecture/agent-skills
title: "Agent skills: config resolution and harness-neutral prompt contracts"
status: draft
author: llm
implements: [feature/agent-integration]
---

# Agent skills: config resolution and harness-neutral prompt contracts

This spec defines the content of Specplane's workflow integrations (skills) independently of any agent harness: the policy checks each one performs, the procedure it follows, and what it outputs. A harness overlay defines how these contracts are packaged and invoked (file location, file format, invocation syntax, subagent use) — for Claude Code, see `claude:architecture/claude-integration`.

Each harness implementation must preserve the policy checks, steps, and outputs defined here. It may add harness-specific detail but must not remove or reorder required steps.

---

## Contract structure

Every skill contract has these parts, and every harness packaging keeps them in this order:

1. **Purpose** — one paragraph describing what the skill does and which workflow integration from `feature/agent-integration` it implements.
2. **Policy check** — the config keys the skill must read before acting, and what to do when policy forbids the action.
3. **Steps** — the ordered procedure the agent follows.
4. **Output** — what the agent should produce or say at the end.

### Config resolution in skills

Skills must never hardcode paths. Every path to a spec, plan, or ADR is resolved from config:

```
1. Load config from .specplane/config.yaml at the repository root (defaults if absent).
2. For each spec ID referenced:
   a. Apply the ID resolution rules (feature/spec-overlays; implemented in
      architecture/reference-cli § Spec resolution).
   b. Use the resolved file path.
3. For plan operations: plan folder = <plans.dir>/<plan-id>/ (or <plans.dir>/archive/<plan-id>/).
4. For ADRs: <decisions.dir>/<NNNN>-*.md.
```

The skill should call the CLI (`specplane`) for resolution, validation, and plan flows when it is available, rather than reimplementing them. If the CLI is not available, it follows the same rules by hand from the format specification.

---

## `spec-assist`

### Purpose

Helps the user write a feature spec without authoring it. Implements `spec-assist`.

### Policy check

```
Read config.specs.feature.llm_role
If llm_role == "none": decline and explain
If llm_role == "assist": proceed (help mode)
If llm_role == "draft": drafting is permitted; default to help mode unless the user asks for a draft
```

### Steps

1. Ask the user what the spec should be about, and who it is for.
2. Suggest a structure (list of section headings) based on the feature spec template in `architecture/file-formats` §1.3.
3. For each section, ask a clarifying question to surface edge cases and acceptance scenarios.
4. If the user provides a draft, review it: missing acceptance scenarios, ambiguous rules, and architecture-leak violations (implementation detail that is not part of the user-visible interface).
5. Propose edits to the user's text; never write the file without explicit approval.

### Output

Summary of suggested additions and changes. The user approves, and the agent applies only what was approved.

---

## `spec-draft-architecture`

### Purpose

Drafts an architecture spec from feature specs. Implements `spec-draft-architecture`.

### Policy check

```
Read config.specs.architecture.llm_role
If llm_role == "none": decline
If llm_role == "assist": review an existing draft instead of producing one
If llm_role == "draft": proceed
```

### Steps

1. Identify the feature specs to implement (from the user).
2. Read each feature spec (resolve path from config) and any ADRs listed in their text or whose `related_specs` include them.
3. Check each feature spec's status. Warn about any that are not `approved`; note that the architecture spec cannot be approved until they are when `specs.architecture.require_approved_features: true`.
4. Produce a draft using the template in `architecture/file-formats` §1.4.
5. Mark any place where the feature specs leave the architecture open with `<!-- GAP: <description> -->`.
6. Set `author: llm`, `status: draft`, and the `implements` list.
7. Write to `<root.path>/architecture/<slug>.md` (root from config; `base` unless the user names another).

### Output

Path to the created file; list of GAPs found.

---

## `plan-create`

### Purpose

Creates a new plan interactively. Implements `plan-create`.

### Policy check

```
Read config.plans.require_approved_specs
Specs below the requirement → warn (the plan can be created, but not started, until they are approved)
```

### Steps

1. Ask for the goal and title; propose a slug (2–4 words) and the ID `<today>-<slug>`. Confirm it does not exist.
2. Ask for the specs and dependencies; resolve each spec ID (no root context) and plan ID. Reject unknown IDs, abandoned dependencies, and dependency cycles.
3. Draft the PLAN.md body sections (`architecture/file-formats` §2.2) with the user.
4. Propose a step decomposition following `feature/plan-steps` § Step grouping guidance, with a `context` list per step (spec IDs with anchors, `decision/NNNN` IDs, file paths).
5. After user approval, create `<plans.dir>/<id>/PLAN.md` (`status: draft`) and `steps/NN-<slug>.md` files (`status: pending`), using `specplane plan new` when available.
6. Run validation on the new plan.

### Output

Plan ID, path, and step list; a reminder that a human sets `status: ready` before the plan can be started.

---

## `plan-step`

### Purpose

Executes the next step of a plan. Implements `plan-step`.

### Policy check

```
Read config.specs.* (authorship and llm_role) before editing any spec.
Determine whether the session is attended (feature/spec-precedence).
```

### Steps

1. Identify the plan: from the current branch `plan/<id>`, or from the user. If not on the plan's branch, warn before proceeding.
2. Parse the step files; find the next step (lowest-numbered step that is not `done` or `skipped`). If it is `blocked`, report its `BLOCKED:` issue and stop. If there is none, report that all steps are done and suggest `plan-finish`.
3. Load context: every item in the step's `context` field (spec sections by anchor, ADRs, files) plus all prior sections of HANDOFF.md.
4. Avoid reading other files unless the listed context is insufficient; record any expansion in HANDOFF.md.
5. Execute the tasks, following `feature/spec-precedence` (record gaps; on contradictions, stop if attended, or record `BLOCKED:` and continue with unaffected tasks if unattended).
6. Check the acceptance criteria.
7. Set the step's `status` to `done`, or `blocked` if a blocking issue prevents the criteria from being met.
8. Append the step's HANDOFF.md section (`architecture/file-formats` §4; `**Outcome**` matching the status; "None." for empty sections).
9. Commit: `plan/<id> step NN: <slug>\n\n<bullet summary of changes>`.

### Output

One-paragraph summary: outcome, files changed, gaps, open issues, and the next step. Do not start the finish flow automatically after the last step; suggest it.

---

## `plan-finish`

### Purpose

Runs the finish flow for the current plan. Implements `plan-finish`.

### Steps

1. Identify the current plan from the git branch.
2. Confirm with the user: "Run finish flow for `<plan-id>`?" (unattended: proceed only if the session was explicitly started to finish the plan).
3. Invoke `specplane plan finish <id>` (readiness checks, verification, rebase, final commit, PR or merge).
4. When verification asks for acceptance-criteria confirmation, check each criterion and state the evidence.

### Output

The result: PR URL, merge confirmation, or the error that stopped the flow and what to do about it.

---

## `validate`

### Purpose

Runs full repository validation and presents actionable results. Implements `validate`.

### Steps

1. Run `specplane validate --json`.
2. Parse the JSON output; group errors and warnings by file.
3. If `specs.llm_review: true`:
   a. For each feature spec (skipped if `specs.feature.llm_role: none`, or if the spec sets `allow_architecture: true`), ask: "Does this text describe how something is implemented (architecture) rather than what it does (behaviour)? List any suspect passages." Each passage becomes a warning.
   b. For each overlay spec with `extends`, read it together with its base spec and ask whether it adds to or contradicts the base. Each suspected contradiction becomes a warning quoting both passages.
4. Present a summary: "N errors, M warnings", with a suggested fix for each error (e.g. for an ID mismatch: "Rename the file or update the `id:` field").

### Output

The grouped summary. Warnings from LLM review are labelled as such.

---

## Keeping skills in sync with specs

When a spec that a skill depends on is updated, the skill may need to be updated. `specplane validate` checks only that `AGENTS.md` mentions every top-level config section; it does not validate skill content — that is a manual review step.

Skills are committed to the repository and versioned. A PR that changes a workflow contract (in `feature/agent-integration`, this spec, or a harness overlay) updates the corresponding skill files in the same PR.
