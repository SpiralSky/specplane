---
id: architecture/agent-skills
title: "Agent skills: config resolution and harness-neutral prompt contracts"
status: approved
author: llm
implements: [feature/agent-integration]
based_on: { feature/agent-integration: "9e3a0cf" }
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
1. Load config from .specplane/config.yaml at the repository root. If it is absent,
   the skill does nothing and suggests `specplane init` (feature/agent-integration).
2. For each spec ID referenced:
   a. Apply the ID resolution rules (feature/spec-overlays; implemented in
      architecture/reference-cli § Spec resolution).
   b. Use the resolved file path.
3. For plan operations: plan folder = <plans.dir>/<plan-id>/ (or <plans.dir>/archive/<plan-id>/).
4. For ADRs: <decisions.dir>/<NNNN>-*.md.
```

The skill should call the CLI (`specplane`) for resolution, validation, and plan flows when it is available, rather than reimplementing them. If the CLI is not available, it follows the same rules by hand from the format specification.

---

## Standing instructions

Skills hold the procedures; they load only when invoked. A few rules must hold even when no skill is running (an ad hoc "edit this spec" request, a contradiction found mid-task). These **standing instructions** are a short, fixed text that every harness delivers to the agent at all times. They are kept short because they cost context in every session.

### Content

The canonical text, versioned with the CLI (`v1`):

```markdown
## Specplane

This repository uses Specplane. Before acting on specs, plans, or ADRs, read `.specplane/config.yaml`; resolve every path from it (`spec_roots`, `plans.dir`, `decisions.dir`), never assume one. `execution` says how plans run.

- **Authorship**: `specs.<type>.llm_role` limits what you may do to specs of that type: `none` = do not act on them, decline and say why; `review` = ask, suggest, and review, but do not write the spec body; `assist` = write the body only after the user finalises the content and approves the text (refine-then-write); `draft` = you may write a draft for review. Setting a spec to `approved`, a plan to `ready`, or a decision record to `accepted` is the human's decision: never do it by editing a file.
- **Precedence**: when implementing, the architecture spec wins and the feature spec fills gaps; record each gap, assumption, or proposed spec edit as a `spec-gaps.md` entry in the plan folder. If specs contradict each other, stop and report it; do not implement either side.
- **Plans**: work on a plan only in its checkout (branch `plan/<id>`), one step at a time, following the plan-step workflow. HANDOFF.md and `spec-gaps.md` in the plan folder are the source of truth for progress and gaps.
- **Commits**: follow `architecture/file-formats` §8 (Conventional Commits subject plus `Specplane-*` trailers).
- **Workflows**: <harness-specific line naming how to run the workflows, e.g. slash commands>; without them, follow the contracts in `architecture/agent-skills`.
```

Each harness replaces only the **Workflows** line. The rules themselves live in the specs; this text only points to them (`feature/agent-integration`: no duplicated policy).

### Delivery

A harness delivers the standing instructions through a file it owns whenever the harness supports one (for example a rules directory or an import), so no user-owned file is edited. The fallback is a **managed block** in `AGENTS.md`:

```markdown
<!-- specplane:begin v1 — managed by `specplane init`; edits inside this block are overwritten -->
...standing instructions, with the harness-neutral Workflows line...
<!-- specplane:end -->
```

- `specplane init` creates `AGENTS.md` containing only the block if the file is absent; appends the block (after a blank line) if the file exists without one; and replaces the text between the markers if the block exists with a different version or content. Text outside the markers is never changed.
- The base `init` always writes the `AGENTS.md` block, because harnesses other than the one installed may read `AGENTS.md`. A harness overlay may additionally install its own copy; a few duplicated lines are acceptable.
- A file with a begin marker and no end marker (or several blocks) is not touched; `init` reports it and `validate` warns.

---

## `spec-assist`

### Purpose

Helps the user write a feature spec. Implements `spec-assist`. The mode follows `specs.feature.llm_role` (`feature/spec-policies` §1): refine-then-write under `assist`, review-only under `review`.

### Policy check

```
Read config.specs.feature.llm_role
If llm_role == "none": decline and explain
If llm_role == "review": review-only mode
If llm_role == "assist": refine-then-write mode
If llm_role == "draft": drafting is permitted; default to refine-then-write unless the user asks for a draft
```

### Steps

Refine-then-write (`assist`), following `feature/spec-policies#refine-then-write-llm_role-assist`:

1. **Describe**: ask the user to describe the feature in their own words. Write nothing to the spec.
2. **Refine**: discuss the description to find issues — gaps, ambiguous rules, contradictions with other specs, missing edge cases and acceptance scenarios, and architecture leaks. Raise each issue with a suggested resolution; the user decides. Repeat until no issue is open or the user chooses to stop.
3. **Finalise**: summarise the agreed content (rules, scenarios, the decision on each issue, and anything left open). The user confirms the summary is final.
4. **Write**: write the body from the finalised content only, using the feature spec template in `architecture/file-formats` §1.3, and show it to the user. Write the file only after the user approves the text; mark every detail filled in as an assumption to confirm.
5. Set `author: mixed` and leave `status` unchanged. Never set it to `approved`.
6. Before writing, self-check the body: no implementation detail (the architecture-leak test) and no contradiction with the user's agreed content. Rewrite or drop any passage that fails.

Review-only (`review`):

1. Ask the user what the spec is about and who it is for.
2. Suggest a structure (list of section headings) without writing content.
3. Ask clarifying questions to surface edge cases and acceptance scenarios.
4. Review a draft the user has written: missing acceptance scenarios, ambiguous rules, and architecture-leak violations (implementation detail that is not part of the user-visible interface).
5. Self-check every suggestion and proposed edit before showing it: it must not introduce implementation detail and must not contradict the user's existing text. Rewrite or drop any that fail.
6. Propose edits as text; never write the spec body, and apply only an exact edit the user approves.

Under `draft`, the agent may also produce a `draft` with `author: llm` when the user asks.

### Output

Refine-then-write: the written body and its path, after approval, with the assumptions listed. Review-only: a summary of suggested additions and changes, applied only where the user approved them.

---

## `spec-draft-architecture`

### Purpose

Drafts an architecture spec from feature specs. Implements `spec-draft-architecture`. Under `assist` it follows refine-then-write (`feature/spec-policies` §1) instead of drafting from the feature specs alone; under `review` it reviews an existing draft instead of producing one.

### Policy check

```
Read config.specs.architecture.llm_role
If llm_role == "none": decline
If llm_role == "review": review-only mode (spec-assist review steps)
If llm_role == "assist": refine-then-write mode
If llm_role == "draft": proceed
```

Under `assist`, the feature specs read in step 1 are the input to Describe and Refine, and Write uses the finalised content: `author: mixed`, `status` unchanged, and the file written only after the user approves the text. Under `review`, the agent reviews a draft the user wrote and writes nothing.

### Steps

1. Identify the feature specs to implement (from the user).
2. Read each feature spec (resolve path from config) and any ADRs listed in their text or whose `related_specs` include them.
3. Check each feature spec's status. Warn about any that are not `approved`; note that the architecture spec cannot be approved until they are when `specs.architecture.require_approved_features: true`.
4. Produce a draft using the template in `architecture/file-formats` §1.4.
5. Mark any place where the feature specs leave the architecture open with `<!-- GAP: <description> -->`.
6. Set `author: llm`, `status: draft`, and the `implements` list.
7. Before writing, self-check the draft: every `implements` entry resolves, every feature-spec requirement is covered or marked with a GAP, and no section contradicts a feature spec (the architecture spec wins only where the feature spec is silent). Fix or mark with a GAP anything that fails.
8. Write to `<root.path>/architecture/<slug>.md` (root from config; `base` unless the user names another).

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
4. Propose a step decomposition following `feature/plan-steps` § Step grouping guidance, with a `context` list per step (spec IDs with anchors, `decision/NNNN` IDs, file paths). Ordering check: confirm that each step depends only on earlier steps (nothing a step needs is produced by a later one) and reorder before showing the proposal if not.
5. After user approval, create `<plans.dir>/<id>/PLAN.md` (`status: draft`) and `steps/NN-<slug>.md` files (`status: pending`), using `specplane plan new` when available.
6. Run validation on the new plan. Without the CLI, apply `architecture/file-formats` §2 by hand (create the files, check IDs and dependencies manually) and tell the user validation was not run.

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

1. Identify the plan: from the current branch `plan/<id>`, or from the user. If not on the plan's branch, warn before proceeding. If `origin/plan/<id>` exists, fetch it first: fast-forward when it is ahead, and stop when the branches have diverged ("Another session advanced `plan/<id>`; reconcile the branches before running a step"). Several sessions (worktrees, cloud runs) may work on a repository, but only one at a time on a given plan.
2. Parse the step files; find the next step (lowest-numbered step that is not `done` or `skipped`). Ordering check: confirm every lower-numbered step is `done` or `skipped`; if any is `pending` or `blocked`, run that one first (or report its `BLOCKED:` issue) rather than the step the user named. If it is `blocked`, report its `BLOCKED:` issue and stop. If there is none, report that all steps are done and suggest `plan-finish`.
3. Load context: every item in the step's `context` field (spec sections by anchor, ADRs, files) plus all prior sections of HANDOFF.md.
4. Avoid reading other files unless the listed context is insufficient; record any expansion in HANDOFF.md.
5. Execute the tasks, following `feature/spec-precedence` (record gaps; on contradictions, stop if attended, or record `BLOCKED:` and continue with unaffected tasks if unattended). Every gap, assumption, or proposed spec edit goes into `<plans.dir>/<plan-id>/spec-gaps.md` as a new numbered entry (`## G<n>: <case>`, the six fields and statuses of `architecture/file-formats` §4.2, `**Status**: open`): create the file on the first entry and never reuse a number. A step that would propose a spec edit it may not make itself writes a `proposal` entry; `feature-spec-proposals.md` is the archived format and is not written by new plans.
6. Check the acceptance criteria.
7. Decide the outcome: `done`, or `blocked` if a blocking issue prevents the criteria from being met.
8. Record it with the CLI: stage the step's own work, then run `specplane plan step-done <plan-id> --outcome <outcome> --summary <text>` with `--changed`, `--deviation`, `--open-issue`, `--gap`, `--next-knows`, and the harness attribution `--trailer` (`architecture/reference-cli` § `plan step-done`). The CLI appends the HANDOFF.md section (`architecture/file-formats` §4.1), sets the step's `status` to the outcome, and makes the step commit (§8) in one operation. The "Gaps found in specs" subsection lists each `spec-gaps.md` entry this step added, by ID, through `--gap`.
9. Without the CLI, do the same by hand: set the `status`, append the §4.1 section with `**Outcome**` equal to the status and "None." for empty sections, and commit per `architecture/file-formats` §8 with `Specplane-Workflow: step`, `Specplane-Plan`, `Specplane-Step`, and `Specplane-Agent` (plus `Specplane-Session` when the harness exposes one), e.g. `feat(search-indexer): build graph from spec links`, a bullet summary, then the trailers.
10. If `execution.backend` is `external`, or the plan branch has an upstream, push `plan/<id>` so the next session and other machines see the step.

### Output

One-paragraph summary: outcome, files changed, gaps (their `spec-gaps.md` IDs), open issues, and the next step. Do not start the finish flow automatically after the last step; suggest it.

---

## `plan-finish`

### Purpose

Runs the finish flow for the current plan. Implements `plan-finish`.

### Policy check

```
Read config.plans and config.execution before finishing.
If the CLI is unavailable: stop and tell the user to install it; the flow is not reimplemented by hand.
If any step of the plan is not done or skipped: stop and report which.
```

### Steps

1. Identify the current plan from the git branch.
2. Confirm with the user: "Run finish flow for `<plan-id>`?" (unattended: proceed only if the session was explicitly started to finish the plan).
3. Invoke `specplane plan finish <id>` (readiness checks, verification, rebase, final commit, PR or merge). Verification lists the open `spec-gaps.md` entries; open entries never stop the flow.
4. When verification asks for acceptance-criteria confirmation, check each criterion and state the evidence. Report the open `spec-gaps.md` entries it listed (ID, kind, target spec) so they are reviewed, and say that they do not block the merge.

### Output

The result: PR URL, merge confirmation, or the error that stopped the flow and what to do about it.

---

## `validate`

### Purpose

Runs full repository validation and presents actionable results. Implements `validate`.

### Policy check

```
Read config.specs.llm_review and config.specs.<type>.llm_role.
If the CLI is unavailable: say so, do not claim the repository is valid, and perform only the LLM review of step 3 (when enabled) plus manual frontmatter checks from architecture/file-formats.
```

### Steps

1. Run `specplane validate --json`.
2. Parse the JSON output; group errors and warnings by file.
3. If `specs.llm_review: true`:
   a. For each feature spec (skipped if `specs.feature.llm_role: none`, or if the spec sets `allow_architecture: true`), ask: "Does this text describe how something is implemented (architecture) rather than what it does (behaviour)? List any suspect passages." Each passage becomes a warning.
   b. For each overlay spec with `extends`, read it together with its base spec and ask whether it adds to or contradicts the base. Each suspected contradiction becomes a warning quoting both passages.
4. Self-check LLM-review findings before reporting: drop any passage that on re-reading does not describe implementation and any contradiction that cannot be quoted from both texts.
5. Present a summary: "N errors, M warnings", with a suggested fix for each error (e.g. for an ID mismatch: "Rename the file or update the `id:` field").

### Output

The grouped summary. Warnings from LLM review are labelled as such.

---

## `approve`

### Purpose

Approves specs, plans, and decision records, and reopens approved specs, on the user's request. Implements `approve`. Approval is the human's decision; the agent never runs this on its own initiative and never changes a `status` field by editing a file (`feature/agent-integration` § `approve`).

### Policy check

```
No spec body is edited: approval changes only the `status:` line, through the CLI.
If the CLI is unavailable: stop and tell the user to install it; this integration is not reimplemented by hand.
Only when the user asks: never approve or accept during other work.
```

### Steps

1. Parse `$ARGUMENTS` in the user's order: `--reopen` marks reopen mode; every other token is an ID.
2. Resolve each ID's kind: a spec (through `spec/resolve.ts`), a plan (through `plan/resolve.ts`), or a decision record (`decision/<NNNN>`, through `decisions/parse.ts`).
3. Run the matching command: `specplane spec approve <id>`, `specplane plan approve <id>`, or `specplane decision accept <id>`; several IDs of one kind may go in one command, which stops at the first refusal.
4. On a refusal, report the reason and the fix for that ID and stop. Do not retry another way and do not edit frontmatter directly.
5. In reopen mode, run `specplane spec reopen <id>` and show the specs it reports as no longer able to stay approved; reopen one only when the user asks for it.

### Output

One line per ID: the commit that approved it, or the refusal and its fix. In reopen mode, the reopen commit and the reported dependants with their commands.

---

## `plan-start`

### Purpose

Starts a plan so its steps can run. Implements `plan-start`.

### Policy check

```
Read config.execution.backend (worktree, branch, or external).
```

### Steps

1. Identify the plan: the ID argument, else the current branch `plan/<id>`, else ask the user.
2. Run `specplane plan start <id>`; it performs the checks of `feature/plan-execution` § Start flow.
3. Report whether the checkout was created or resumed, the backend, the checkout path, and the next step, all taken from the CLI output (`--json` carries `resumed`, `backend`, `checkout`, `nextCommand`).
4. For the `worktree` backend, tell the user to open a new session there and give the exact `nextCommand` line from the CLI (`cd <checkout> && claude`); do not compose commands yourself. That session is told the plan and its next step by the harness. With the `external` backend, say that the environment runs the finish flow itself and that `specplane plan finish` must not be run locally. Do not run a step in a session whose checkout differs from the plan's.

### Output

The outcome (created or resumed), the backend, the checkout path, the exact command to open the session, and the next step.

---

## `decision-new`

### Purpose

Creates a decision record. Implements `decision-new`.

### Policy check

```
The record starts as `status: proposed`; accepting it is the `approve` integration.
Write the body only from the user's description: do not invent alternatives, consequences, or decisions.
```

### Steps

1. Run `specplane decision new "<title>"` and keep the reported path.
2. If the user describes the decision, write the body sections from `feature/decisions#adr-body-structure` from that description only, marking anything left open as open.
3. Otherwise leave the sections for the user to fill in.

### Output

The created path and the sections still open.

---

## `plan-status`

### Purpose

Shows where plans stand. Implements `plan-status`.

### Policy check

```
Read config only; this integration changes nothing.
```

### Steps

1. Run `specplane plan list --live` (without the CLI, read `PLAN.md` and step files by hand).
2. When the session is in a plan's checkout (branch `plan/<id>`), highlight that plan. If `cwd` is not that plan's `checkout` (compare real paths; skip when `checkout` is null), warn once and name the `cd <checkout>` line.
3. Summarise per plan: effective status, step progress, next step, `where`, `checkout`, and any `BLOCKED:` items.
4. Point out plans that need attention: a next step that is blocked, or a stacked plan whose base has merged (`feature/plan-execution` § Restacking).

### Output

The summary, current plan first when there is one.

---

## `plan-abandon`

### Purpose

Abandons a plan. Implements `plan-abandon`.

### Policy check

```
Read config.plans. Abandoning keeps the branch and worktree unless the user asks for deletion (feature/plan-execution).
Unattended: do not proceed; report the plan that would be abandoned instead.
```

### Steps

1. Identify the plan: the ID argument, else the current branch.
2. Show what is being abandoned: stored status, step progress, branch, and checkout. Ask the user to confirm.
3. Run `specplane plan abandon <id>`; add the branch-deletion option only when the user asks for it.

### Output

The result, and the documented manual cleanup for a branch that is kept (`git branch -D plan/<id>`).

---

## Keeping skills in sync with specs

Each skill declares the contract it implements with a contract pin: `<!-- specplane-contract: architecture/agent-skills#<skill-slug>@<blob7> -->`, where the anchor is the skill's section in this spec (e.g. `#plan-step`) and the hash is the blob of this file when the skill was last reviewed (format in `architecture/file-formats` §1.6). Skills reference contract sections by anchor, not by prose.

`specplane validate` warns (type `skill-drift`) when a pin no longer matches the current blob of the spec, when the anchor does not resolve, or when a skill has no contract comment (`architecture/reference-cli` § Skill contract drift). Changes that only touch the spec's frontmatter `status`/`author` are ignored. After reviewing `git diff <pin> <current>` and updating the skill, refresh the pin to the committed blob (`specplane spec pin architecture/agent-skills` for the spec's own pins; skill comments are updated by hand to the new `git rev-parse HEAD:<path>` value). Because a pin must name a committed blob to be diffable, pins are refreshed in a commit after the spec change.

Skills are committed to the repository and versioned. A PR that changes a workflow contract (in `feature/agent-integration`, this spec, or a harness overlay) updates the corresponding skill files and their contract pins in the same PR, then refreshes the pins once the spec change is committed.
