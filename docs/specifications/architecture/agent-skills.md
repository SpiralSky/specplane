---
id: architecture/agent-skills
title: "Agent skills: config resolution and harness-neutral prompt contracts"
status: approved
author: mixed
implements: [feature/agent-integration, feature/spec-precedence, feature/spec-policies, feature/spec-system, feature/plan-steps, feature/plan-execution, feature/tooling]
based_on: { feature/agent-integration: "7720f2a", feature/spec-precedence: "233c5a1", feature/spec-policies: "9e333d1", feature/spec-system: "919d9e8", feature/plan-steps: "00332af", feature/plan-execution: "59b4b17", feature/tooling: "9abfce2" }
---

<!-- Plan index proposal 2026-11-02: user agreed naming/source semantics and approved the companion feature patch, now applied. Architecture revision awaits review; not implemented behavior. -->


<!-- Architecture reconciliation 2026-11-02: current feature contracts govern this draft revision. Stored lifecycle status and dependency pins are preserved; this edit is not approval or evidence of implementation. -->

<!-- Revision 2026-11-01: extension/core separation and contribution provenance agreed in conversation; existing lifecycle status is unchanged. Implementation and integration review remain pending. -->

<!-- Experimental development amendment 2026-11-01. Existing status records prior approval only; these branch changes await human final review. -->

<!-- Draft revision 2026-11-02: reconciles the user-approved optional-workflows feature text, completion assessment and shared docs. Existing lifecycle status describes prior approval, not approval or implementation of this architecture revision. -->

# Agent skills: config resolution and harness-neutral prompt contracts

This spec defines the content of Specplane's workflow integrations (skills) independently of any agent harness: the policy checks each one performs, the procedure it follows, and what it outputs. A harness overlay defines how these contracts are packaged and invoked (file location, file format, invocation syntax, subagent use) — for Claude Code, see `claude:architecture/claude-integration`.

Each harness implementation must preserve the policy checks, steps, and outputs defined here. It may add harness-specific detail but must not remove or reorder required steps.

An extension is any host plugin, extension, or mod delivering these workflows inside its harness. It bundles a compatible shared core and the complete applicable procedures. Mechanical phases run in code; only phases requiring reasoning are delegated to the agent. User command handlers, agent tools, and manual CLI commands call the same validated core operations. A prompt asking the agent to reconstruct a mechanical operation is not a deterministic implementation.

---

## Contract structure

Every skill contract has these parts, and every harness packaging keeps them in this order:

1. **Purpose** — one paragraph describing what the skill does and which workflow integration from `feature/agent-integration` it implements.
2. **Policy check** — the config keys the skill must read before acting, and what to do when policy forbids the action.
3. **Steps** — the ordered procedure the agent follows.
4. **Output** — what the agent should produce or say at the end.

### Config resolution in skills

Repository workflows must never hardcode paths. Every path to a spec, plan, or ADR is resolved from config. Product docs index/topic/search bypass this preamble: they use the installed bundle and work without a repository or config.

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

An extension calls its bundled compatible core for resolution, validation, and plan flows. A reasoning-only fallback session calls the verified CLI (`specplane`) when available. Neither path reconstructs deterministic operations in a prompt. Without either, only the explicitly labeled manual fallbacks below apply; no native dispatch or completed validation is claimed.

### Deterministic phases and reasoning procedures

The ordered contracts below describe the whole workflow, including mechanical operations and human gates; they are not instructions to send every phase to a model. `architecture/reference-cli#structured-reasoning-boundary` defines the request/result envelope and recording validation; its confirmation and upgrade sections define human interaction and asset migration. Extensions preserve this order while assigning each phase to code, agent reasoning, or direct human interaction:

| Workflow | Preparation in code | Agent reasoning | Validation/recording in code |
|----------|---------------------|-----------------|------------------------------|
| `spec-assist` | Resolve policy, spec revision and context | Describe/refine; suggest or write only as the role permits | Bind finalized text to human confirmation when required; validate bytes, authorship and contribution events |
| `spec-draft-architecture` | Resolve features, ADRs, policy and status warnings | Draft or assist/review under policy; identify GAPs | Create through the core, validate references and record allowed body/provenance |
| `plan-create` | Resolve choices, dependencies and IDs | Propose goal, body, criteria and ordered steps | Collect approval of the proposal, create draft plan/steps, validate; never set ready |
| `plan-step` | Synchronize, lock, select step and resolve context | Implement, identify gaps/expansion, assess acceptance | Validate structured evidence and staging, record outcome/HANDOFF/commit, publish when required |
| `plan-finish` | Check all steps, run required tests and expose gaps | Assess each acceptance criterion and explain evidence | Collect separate human gates, revalidate revised evidence after rebase, then perform the authorized finish flow |
| `validate` | Run deterministic validation | Optional configured LLM review, permitted by role; interpret findings | Check quoted evidence and label LLM warnings separately |
| `decision-new` | Create proposed ADR | Write only the user's described decision | Validate body/provenance; never accept |

`approve`, `plan-start`, `plan-status`, and `plan-abandon` are wholly mechanical plus any explicit human interaction; they require no reasoning asset. Native handlers stop with an unavailable-capability result when the host lacks required dispatch or interaction APIs. A separately labeled existing-session fallback can follow these same procedures through the manual CLI, without claiming a native handler executed.

In an extension-managed step, the agent returns `WorkflowResult`; it does not independently change step status, append HANDOFF, or commit before `recordWorkflow`. The core performs contract steps 8–10, including publication, using that result. In a reasoning-only CLI fallback, the agent invokes the same validated recording command after inspecting its edit set and evidence. Subagents follow the same boundary: the worker-side extension/core validates and records, and the parent receives the structured recording receipt. This preserves the required one-step commit without two competing recorders. Cancellation before recording produces no step outcome commit; cancellation after recording reports the existing commit and any incomplete publication. Do not treat a model's summary as evidence that any mechanical operation ran.

**Creation goes through the shared creation operation.** An extension calls the core equivalent of `specplane spec new <type> <slug>` or `specplane plan new`; a CLI fallback uses those commands. Neither hand-writes the frontmatter or skeleton when that operation is available. The operation writes `status: draft`, `author: user`, and the section headings of the templates in `architecture/file-formats` §1.3 and §1.4, and the agent then edits the body (as its `llm_role` allows) and, where required, only the `author` metadata field. Target root, implemented IDs, and `extends` are validated operation arguments rather than hand-written overlay frontmatter. Right after creation run the matching spec or repository validation and report the result. Without core or CLI, only a contract's explicit manual fallback applies, labeled as unvalidated manual work.

### Operations and skills

Every CLI operation is either exposed by an extension handler, CLI-only, or an internal primitive. An extension handler uses the bundled core for mechanical phases and host UI for explicit human decisions. Only phases requiring judgment or writing are skills; confirmation alone does not require a model. The contracts named in the table below are workflow contracts, not requirements to install public prompt skills. CLI-only operations remain accessible through the shell. Docs lookup is read-only and independent of repository setup; implementation declarations and retargeting are deterministic operations, not new reasoning skills.

| Operation | Workflow contract / dispatch | Reason |
|-----------|-------|--------|
| `plan new` | `plan-create` | Needs the goal, spec choices, and step files, which the skill writes. |
| `plan list` (`--live`) | `plan-status` native handler | Format and highlight structured state without a model; optional interpretation is separate. |
| `plan next` | not user-facing | Read-only resolver for `plan-step` and for conductors; its JSON is machine input. |
| `plan step-done` | not user-facing | Called by `plan-step` to write the HANDOFF.md section and the step commit. |
| `plan start` | `plan-start` native handler | Prepare the checkout and display where to continue without a model. |
| `plan finish` | `plan-finish` | Needs confirmation and acceptance-criteria evidence; has a manual mode without the CLI. |
| `plan approve`, `spec approve`, `spec reopen`, `decision accept` | `approve` native handler | Human decision collected by host interaction; user-invoked only. |
| `plan abandon` | `plan-abandon` native handler | Host interaction confirms the operation; code executes it. |
| `plan retarget` | CLI-only | Explicit destination reconciliation, with dry-run/JSON receipts; never a rebase or automatic commit. |
| `plan restack` | CLI-only | Mechanical history rewrite; `plan-status` and the start flow name the command when a base plan has merged. |
| `plan cleanup` | CLI-only | Mechanical; the finish flow runs it after a local merge. |
| `plan archive` | CLI-only | File terminal plan records away; does not change status or manage the checkout. |
| `plan shelve` | CLI-only | On user request, pause a started plan and retain its worktree and progress. |
| `plan resume` | CLI-only | On user request, restore a shelved plan; report the next step without executing it. |
| `plan show`, `plan graph` | CLI-only | Read-only output that needs no interpretation. |
| `spec new` | `spec-assist`, `spec-draft-architecture` | Called by those skills; not a user-facing skill of its own. |
| `spec pin` | CLI-only | Mechanical spec dependency pin update after review; does not rewrite skill comments. |
| `spec complete`, `spec implementation` | Shared deterministic handlers or manual CLI | Explicit implementation declaration; preserves review state and requires no plan. |
| `docs`, `docs search` | Shared read-only handlers or bundled CLI | Offline product orientation/topics; no model, config or repository required. |
| `spec list`, `spec show`, `spec validate` | CLI-only | Read-only; `validate` wraps the whole-repository check. |
| `validate` | `validate` | The skill summarises the results. |
| `decision new` | `decision-new` | Writes the body from the user's description. |
| `plan index` | CLI-only | Rebuilds `PLANS.md`; explicit head/staged/working sources, default head. CI uses head; the optional edit hook uses working. |
| `search` | CLI-only | Read-only lookup. |
| `init` | CLI-only | One-time setup, run before any skill exists. |

---

## Standing instructions

Skills hold the procedures; they load only when invoked. A compact conceptual orientation and applicable repository policies must be available even when no skill is running (an ad hoc "edit this spec" request, a contradiction found mid-task). These **standing instructions** are a short, fixed text that every harness delivers to the agent at all times. They are kept short because they cost context in every session.

### Content

The canonical text, versioned with the CLI (advance the standing-text version when implementing these changes):

```markdown
## Specplane

Specplane tracks intended behaviour, review, implementation completion and evidence separately. Plans are optional; branches have no prescribed role. Specs and implementation may change together or separately. Completion is a declaration; matching its content fingerprint does not prove code correctness. Changed definitions can require reassessment. Use `specplane docs` for concepts and the requested workflow.

This repository uses Specplane. Before acting on specs, plans, or ADRs, read `.specplane/config.yaml`; resolve every path from it (`spec_roots`, `plans.dir`, `decisions.dir`), never assume one. `execution` says how plans run.

- **Authorship**: `specs.<type>.llm_role` limits spec writing and review independently of `authorship`: `none` = read and implement only, with no spec-body edits, review, or suggestions; `review` = ask, suggest, and review without independently drafting the spec body; apply a suggested edit only after the user approves that exact change; `assist` = write the body only after the user finalises the content and approves the text (refine-then-write); `draft` = you may write a draft for review. Setting a spec to `approved`, a plan to `ready`, or a decision record to `accepted` is the human's decision: never do it by editing a file.
- **Precedence**: when implementing, the architecture spec wins and the feature spec fills gaps; when using a managed plan, record gaps and assumptions in its `spec-gaps.md`; otherwise use the user's chosen record or conversation. If specs contradict each other, stop and report it; do not implement either side.
- **Plans**: when invoking managed plan execution, work only in its checkout (branch `plan/<id>`), one step at a time, following the plan-step workflow. HANDOFF.md and `spec-gaps.md` in the plan folder are the source of truth for progress and gaps.
- **Commits**: managed commands that create commits follow their documented format. Ordinary work needs no Specplane trailers. Manual implementation-completion edits are valid and do not approve a spec.
- **Workflows**: use an explicitly installed Specplane extension for agent workflows, or the standalone `specplane` CLI for manual operations. Extensions deliver the shared workflow procedures and their host-specific invocation details.
```

The shared AGENTS.md block always uses this neutral Workflows line. Harness-owned instruction files may add invocation details without replacing shared guidance. The detailed rules live in the versioned product docs and their source contracts; consumer instructions link to `specplane docs` topic IDs rather than assuming the product's source specs are present (`feature/agent-integration`: no duplicated policy).

**Routing table (project-owned, outside the managed text).** Skills with `disable-model-invocation: true` are hidden from the model, so a natural-language request such as "start the plan" would otherwise lead to hand-edited plan files. A project that wants those requests to work adds a short routing table to a file it owns (for `AGENTS.md`, outside the managed block): a request to start, step, finish, or show the status of a plan means running `specplane plan <op>` (the CLI stays reachable through the shell even when the skill is not), and those requested managed transitions are performed through the CLI. This routing does not prohibit explicit manual declarations or ordinary Git work outside that workflow. Specplane does not write this table and `init` never touches it; the managed text stays unchanged.

### Delivery

A harness delivers the standing instructions through a file it owns whenever the harness supports one (for example a rules directory or an import), so no user-owned file is edited. The fallback is a **managed block** in `AGENTS.md`:

```markdown
<!-- specplane:begin v<N> — managed by `specplane init`; edits inside this block are overwritten -->
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
4. **Write**: write the body from the finalised content only, using the feature spec template in `architecture/file-formats` §1.3, and show it to the user. Write the file only after the user approves the text; mark every detail filled in as an assumption to confirm. For a new spec, after approval run `specplane spec new feature <slug> --title "<title>"` (adding `--root <name> --extends <ids>` for an overlay) and write the approved body into the file it creates; the CLI never takes content.
5. Set `author: mixed` and leave `status` unchanged. Never set it to `approved`.
6. Before writing, verify the exact approved text and distinguish incidental implementation choices from observable technical requirements. Explain any remaining concern to the user; do not rewrite or drop approved requirements. A content change under `assist` returns to Finalise and exact-text approval before writing.
7. After writing, run `specplane spec validate <id>` and report the result.

Review-only (`review`):

1. Ask the user what the spec is about and who it is for.
2. Suggest a structure (list of section headings) without writing content.
3. Ask clarifying questions to surface edge cases and acceptance scenarios.
4. Review a draft the user has written: missing acceptance scenarios, ambiguous rules, and architecture-leak violations (implementation detail that is not part of the user-visible interface).
5. Self-check every suggestion against the intended contract. Technical mechanisms that define observable behaviour are valid; explain suspected incidental choices and contradictions rather than classifying vocabulary alone as a violation.
6. Propose edits as text; apply a suggested edit only after the user approves that exact change. Do not independently draft the spec body or include additional unapproved edits. The Claude overlay may collect that exact-edit approval through its tool review; a general host permission grant is not approval of unspecified text. Applying an approved edit does not grant lifecycle approval.

Under `draft`, the agent may also produce a `draft` with `author: llm` when the user asks.

### Output

Refine-then-write: the written body and its path, after approval, with the assumptions listed and the validation result. Review-only: a summary of suggested additions and changes, identifying any exact user-approved edits applied; otherwise no body writes.

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

Under `assist`, the feature specs read in step 1 are the input to Describe and Refine, and Write uses the finalised content: `author: mixed`, `status` unchanged, and the file written only after the user approves the text. Under `review`, the agent reviews a draft the user wrote and may apply only an exact user-approved edit, following the `spec-assist` review steps; it does not independently draft the body.

### Steps

1. Identify the feature specs to implement (from the user).
2. Read each feature spec (resolve path from config) and any ADRs listed in their text or whose `related_specs` include them.
3. Check each feature spec's status. Warn about any that are not `approved`; note that the architecture spec cannot be approved until they are when `specs.architecture.require_approved_features: true`.
4. Produce a draft using the template in `architecture/file-formats` §1.4.
5. Mark any place where the feature specs leave the architecture open with `<!-- GAP: <description> -->`.
6. For a newly authored draft, set `author: llm`, `status: draft`, and the `implements` list. When revising an existing architecture, preserve its lifecycle status and prior attribution; record actual new contributors when known and label the revision as awaiting review. Existing approval metadata does not approve the new text.
7. Before writing, self-check the draft: every `implements` entry resolves, every feature-spec requirement is covered or marked with a GAP, and no section contradicts a feature spec (the architecture spec wins only where the feature spec is silent). Fix or mark with a GAP anything that fails.
8. For a new file use `specplane spec new architecture <slug> --implements <ids> [--root <name>] [--extends <ids>]` (root from config; `base` unless the user names another), then write the body and record authorship per step 6. For an existing file edit the authorized body directly, preserving unrelated metadata and using the same coverage/validation checks. Revision alone does not approve, complete or commit the spec.
9. Run `specplane spec validate <id>` and report the result.

### Output

Path to the created file; list of GAPs found; the validation result.

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
2. Ask for the specs, dependencies, intended integration destination and optional comparison baseline; resolve each spec ID (no root context) and plan ID. Reject unknown IDs, abandoned dependencies, and dependency cycles.
3. Draft the PLAN.md body sections (`architecture/file-formats` §2.2) with the user.
4. Propose a step decomposition following `feature/plan-steps` § Step grouping guidance, with a `context` list per step (spec IDs with anchors, `decision/NNNN` IDs, file paths). Ordering check: confirm that each step depends only on earlier steps (nothing a step needs is produced by a later one) and reorder before showing the proposal if not.
5. After user approval, create `<plans.dir>/<id>/PLAN.md` (`status: draft`) and `steps/NN-<slug>.md` files (`status: pending`), using `specplane plan new --id <id> --title "<title>" --specs <ids> [--depends-on <ids>] [--target <branch>] [--comparison-base <commit>]` for `PLAN.md` and the empty steps directory; HANDOFF.md is created when the first step is recorded (the step files have no CLI command; write them by hand, then fill in the PLAN.md body).
6. Run `specplane validate` and report the result for the new plan. Without the CLI, apply `architecture/file-formats` §2 by hand (create the files, check IDs and dependencies manually) and tell the user validation was not run.

### Output

Plan ID, path, and step list; a reminder that a human sets `status: ready` before the plan can be started, with the manual command `specplane plan approve <id>` or the invoking extension's available approval handler.

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

1. Identify the plan: from the current branch `plan/<id>`, or from the user. If not in its designated checkout on the plan's branch, report that checkout and stop managed execution; unrelated manual work remains permitted. If `origin/plan/<id>` exists, fetch it first: fast-forward when it is ahead, and stop when the branches have diverged ("Another session advanced `plan/<id>`; reconcile the branches before running a step"). Several sessions (worktrees, cloud runs) may work on a repository, but only one at a time on a given plan.
2. Resolve the committed execution target and authoritative lifecycle state through the core. Refuse drafts, terminal/abandoned state, unresolved target context and pending retarget edits; require commit/discard before managed execution. Refuse execution or recording when the authoritative plan state is `shelved`; direct the user to explicit `specplane plan resume <id>`. Parse the step files. For an explicitly requested completed-step rerun, validate `--step N --force --reason TEXT` through the core and select exactly that completed step; do not apply the ordinary next-step selection below. All lifecycle, dependency and coordination guards still apply. Otherwise find the next step (lowest-numbered step that is not `done` or `skipped`). For ordinary next-step execution, ordering check: confirm every lower-numbered step is `done` or `skipped`; if any is `pending` or `blocked`, run that one first (or report its `BLOCKED:` issue) rather than the step the user named. If it is `blocked`, report its `BLOCKED:` issue and stop. If there is none, report that all steps are done and suggest `plan-finish`.
3. Load context: every item in the step's `context` field (spec sections by anchor, ADRs, files) plus all prior sections of HANDOFF.md.
4. Avoid reading other files unless the listed context is insufficient; record any expansion in HANDOFF.md.
5. Execute the tasks, following `feature/spec-precedence` (record gaps; on contradictions, stop if attended, or record `BLOCKED:` and continue with unaffected tasks if unattended). Every gap, assumption, or proposed spec edit goes into `<plans.dir>/<plan-id>/spec-gaps.md` as a new numbered entry (`## G<n>: <case>`, the six fields and statuses of `architecture/file-formats` §4.2, `**Status**: open`): create the file on the first entry and never reuse a number. A step that would propose a spec edit it may not make itself writes a `proposal` entry; `feature-spec-proposals.md` is the archived format and is not written by new plans.
6. Check the acceptance criteria. Tests are specified by the step criteria/tasks and its reviewed test procedure; project test files are part of the implementation. In the structured workflow, request executable checks through `executeWorkflowTest` (Codex runner: `executeTest`) after edits, and return its artifacts with criterion evidence. Missing suite/report mappings remain uncertain until resolved and bound by preparation. Report commands, outcomes and limitations; core records the verification summary in HANDOFF.md as specified in reference-cli. In the manual CLI fallback, pass observed results through `--next-knows`, explicitly distinguishing them from core-issued receipts.
7. Decide the outcome: `done`, or `blocked` if a blocking issue prevents the criteria from being met.
8. Record it with the CLI: inspect the exact edit set and create the digest-bound recording manifest outside the checkout, then run `specplane plan step-done <plan-id> --outcome <outcome> --summary <text> --recording-set <file>` with `--changed`, `--deviation`, `--open-issue`, `--gap`, `--next-knows`, and the harness attribution `--trailer` (`architecture/reference-cli` § `plan step-done`). The CLI appends the HANDOFF.md section (`architecture/file-formats` §4.1), sets the step's `status` to the outcome, and makes the step commit (§8) in one operation. The "Gaps found in specs" subsection lists each `spec-gaps.md` entry this step added, by ID, through `--gap`.
9. Without the CLI or compatible core, new target-aware plans refuse managed recording rather than bypassing binding/lease checks. For legacy plans only, when the historical target and scope are unambiguous and the user chooses the labelled manual fallback, do the same by hand: set the `status`, append the §4.1 section with `**Outcome**` equal to the status and "None." for empty sections, and commit per `architecture/file-formats` §8 with `Specplane-Workflow: step`, `Specplane-Plan`, `Specplane-Step`, and `Specplane-Agent` (plus `Specplane-Session` when the harness exposes one), e.g. `feat(search-indexer): build graph from spec links`, a bullet summary, then the trailers.
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
If neither compatible core nor CLI is available: the manual sequence is allowed only for an unambiguously resolved legacy target, labelled "manual mode: no stale-base or divergence checks". Target-aware plans require the supporting core/CLI.
If any step of the plan is not done or skipped: stop and report which.
```

### Steps

1. Identify the current plan from the git branch.
2. Confirm with the user: "Run finish flow for `<plan-id>`?" (unattended: proceed only if the session was explicitly started to finish the plan).
3. Invoke `specplane plan finish <id>` (readiness checks, verification, rebase, final commit, PR or merge). Verification lists the open `spec-gaps.md` entries; open entries never stop the flow.
4. When verification asks for acceptance-criteria confirmation, check each criterion and state the evidence. Report the open `spec-gaps.md` entries it listed (ID, kind, target spec) so they are reviewed, and say that they do not block the merge.

**Manual mode (no CLI).** Instead of step 3, print "manual mode: no stale-base or divergence checks" once and follow this sequence (the finish flow's order, for the two merge modes only). Stop and tell the user to install the CLI when the plan has a new execution binding, target/comparison metadata, is stacked, has ambiguous historical context, or uses `plans.status_source: frontmatter`, since those need shared target, stack and claim logic. Resolve the historical target before the first mutation.

1. Check that the branch is `plan/<id>`, `git status --porcelain` is empty, and every step is `done` or `skipped`.
2. Run `plans.test_command` in the checkout when it is set; list the acceptance criteria and open `spec-gaps.md` entries as in step 4.
3. `git fetch origin` when a remote exists, then `git rebase <target>`; on a conflict run `git rebase --abort` and stop. Re-run the tests when the rebase applied new commits.
4. Set `status: done` in `<plans.dir>/<id>/PLAN.md`; when `archive_done` is true run `git mv <plans.dir>/<id> <plans.dir>/archive/<id>`; stage the plan folder and commit:
   ```
   chore(specplane): finish <id>

   Specplane-Workflow: finish
   Specplane-Plan: <id>
   Specplane-Agent: <$SPECPLANE_AGENT, else harness name>
   Specplane-Session: <$SPECPLANE_SESSION; omit when unset>
   ```
   followed by the harness attribution trailer.
5. `pull_request`: `git push -u origin plan/<id>`, then open the pull request (`gh pr create --base <target> --head plan/<id> --title "chore(specplane): finish <id>"`), or print the push command and the PR URL instructions when no forge CLI is available. `local_merge`: confirm with the user, then in the clean checkout of the recorded target `git merge --no-ff -m "Merge plan/<id>" plan/<id>`, then `git worktree remove <checkout>` (worktree backend) and `git branch -d plan/<id>`.

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
   a. For each feature spec (skipped if `specs.feature.llm_role: none`, or if the spec sets `allow_architecture: true`), ask: "Does this text prescribe incidental implementation choices, or is the technical mechanism itself part of the observable feature contract? Explain each suspected misplaced passage; technical vocabulary alone is not evidence." Each passage becomes a warning.
   b. For each overlay spec with `extends`, read it together with its base spec and ask whether it adds to or contradicts the base. Each suspected contradiction becomes a warning quoting both passages.
4. Self-check LLM-review findings before reporting: drop any passage that on re-reading does not describe implementation and any contradiction that cannot be quoted from both texts.
5. Present a summary: "N errors, M warnings", with a suggested fix for each error (e.g. for an ID mismatch: "Rename the file or update the `id:` field").

### Output

The grouped summary. Warnings from LLM review are labelled as such.

---

## `approve`

### Purpose

Approves specs, plans, and decision records, and reopens approved specs, on the user's request. Implements `approve`. Approval is the human's decision; the agent never runs this on its own initiative and never grants review approval by editing a lifecycle field (`feature/agent-integration` § `approve`). This restriction does not prohibit explicitly requested manual implementation-completion edits.

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
2. Run `specplane plan start <id> [--target <branch>]`, forwarding an explicit user selection without inventing a target; it performs the checks of `feature/plan-execution` § Start flow.
3. Report whether the checkout was created or resumed, the backend, checkout path, recorded target, starting commit, comparison baseline and next step from the CLI output. This mechanical operation requires no model call.
4. For the `worktree` backend, report the checkout and tell the user to continue there. Only the explicitly invoking extension may add its verified host launch instructions, quoting shell paths or using argument arrays. The core returns no host command. With the `external` backend, say that the environment runs the finish flow itself and that `specplane plan finish` must not be run locally. Do not run a step in a session whose checkout differs from the plan's.

### Output

The outcome (created or resumed), backend, checkout path, target, starting commit, optional comparison baseline, and next step. The invoking extension may add verified host launch instructions; standalone output remains harness-neutral.

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
3. Summarise per plan: stored/effective status, target, starting commit, comparison baseline, integration evidence or awaiting-merge state, step progress, next step, `where`, `checkout`, and any `BLOCKED:` items. Label pending retarget edits and stale/offline refs separately.
4. Point out plans that need attention: a next step that is blocked, or a stacked plan whose base has merged (`feature/plan-execution` § Restacking). For the latter, name the command `specplane plan restack <id>`; `plan list --live` prints it as a notice ("Base plan `<base-id>` has merged; run `specplane plan restack <id>`.").

### Output

The summary, current plan first when there is one.

---

## `plan-abandon`

### Purpose

Abandons a plan. Implements `plan-abandon`.

### Policy check

```
Read config.plans. Abandoning retains plan records and the branch unless branch deletion is requested, but removes the worktree (feature/plan-execution). Shelving retains the worktree for later resume.
Unattended: do not proceed; report the plan that would be abandoned instead.
```

### Steps

1. Identify the plan: the ID argument, else the current branch.
2. Show what is being abandoned: stored status, step progress, retained plan records and branch, and the checkout that will be removed. Ask the user to confirm. If the intent is to pause and retain the checkout, explain `specplane plan shelve <id>` instead.
3. Run `specplane plan abandon <id>`; add the branch-deletion option only when the user asks for it.

### Output

The result, and the documented manual cleanup for a branch that is kept (`git branch -D plan/<id>`).

---

## Keeping skills in sync with specs

Each skill declares the contract it implements with a contract pin: `<!-- specplane-contract: architecture/agent-skills#<skill-slug>@<blob7> -->`, where the anchor is the skill's section in this spec (e.g. `#plan-step`) and the hash is the blob of this file when the skill was last reviewed (format in `architecture/file-formats` §1.6). Skills reference contract sections by anchor, not by prose.

An installed workflow may declare several contract comments. Declare every applicable shared procedure as well as its harness-specific contract; validate all declarations independently. Package the referenced procedures and versioned snapshots with the extension, including remote synchronization/publication, acceptance checks, and structured gap recording. Snapshot integrity is not evidence that the delivered workflow implements the procedure. Never refresh a pin until that implementation has been reviewed.

`specplane validate` warns (type `skill-drift`) when a pin no longer matches the current blob of the spec, when the anchor does not resolve, or when a skill has no contract comment (`architecture/reference-cli` § Skill contract drift). Changes that only touch the spec's frontmatter `status`/`author` are ignored. After reviewing `git diff <pin> <current>` and updating the skill, refresh the pin to the committed blob (`specplane spec pin architecture/agent-skills` for the spec's own pins; skill comments are updated by hand to the new `git rev-parse HEAD:<path>` value). Because a pin must name a committed blob to be diffable, pins are refreshed in a commit after the spec change.

Skills are committed to the repository and versioned. A PR that changes a workflow contract (in `feature/agent-integration`, this spec, or a harness overlay) updates the corresponding skill files and their contract pins in the same PR, then refreshes the pins once the spec change is committed.

## Extension conductor contract

Resolve config and call the shared conductor through the invoking extension, which must supply a session adapter explicitly. Standalone CLI commands never launch a harness. Shelved plans have no executable conductor action; neither a branch nor a pending step authorizes implicit resume. Never invoke approval or finish/merge automatically. Session identity is deterministic per plan and step for restart protection; the adapter maps it to a verified host session identity and preserves the mapping. A deterministic orchestration identity is not fabricated native-session provenance. The extension invokes its installed step workflow in unattended mode using its verified host mechanism, without embedding Claude syntax in the shared core.

An explicit completed-step rerun adds `--step N --force --reason TEXT` to the workflow invocation. Select exactly that completed step, execute it again, and record using the same step/force/reason options on `plan step-done`, together with its reviewed recording manifest. The reason must be nonempty and single-line. The recorder appends a new outcome with the audit reason/trailer, even after later-numbered sections; the latest occurrence for the selected step is authoritative. Do not bypass safety conditions or erase earlier history. Without those arguments, existing lowest-pending ordering remains unchanged. Configured session mode may force unattended but never attended behavior.

## Integration-target workflow requirements

This contract implements the current integration-target feature requirements. Plan creation surfaces the user's integration destination and optional comparison baseline; it does not assume that approval belongs on main. Pass declared values through the CLI rather than writing execution metadata. First start resolves and displays the target and starting commit; every later workflow uses the recorded binding and reports conflicts rather than silently following a changed default.

Step preparation, dependency checks, receipt validation and status inspection use the same target context as the core. Present the actual target in finish/merge confirmation. A completed candidate or positive metric result never authorizes promotion to another branch. Separate candidate plans must have distinct IDs, and an agent may generate or execute parallel candidates only when authorized by the user and repository policy.

Manual finish must resolve a trustworthy historical target before fetching, rebasing or opening a PR. If unavailable or ambiguous, stop with recovery instructions; never substitute main. Local merge requires a suitable clean target checkout, not necessarily the main checkout. The CLI's execution-binding and target resolution logic must not be reimplemented by the agent when the CLI is unavailable. Existing legacy manual mode is limited to an unambiguous historical default target; new target-aware plans require the supporting CLI.

## Shared documentation and completion guidance

Deliver the compact orientation from the same reviewed release source as the bundled docs. Embed `docs_version` and `contract_version` in managed asset metadata; use manifest hashes for freshness checks. Do not regenerate instruction text from unreleased source specs at user-session startup. Refresh through the explicit existing installation transaction and preserve user-owned content. Harness-specific invocation hints supplement the shared orientation; they never replace it or redefine shared semantics.

For conceptual questions, read `docs concepts` or `docs completion`; for a requested operation load its topic through the installed compatible core. Docs retrieval is read-only and must work without project config. Do not search a consumer repository for Specplane's own architectural source files. Repository spec IDs continue to resolve through that repository's config and are distinct from product-doc topic IDs.

When asked to mark a spec complete, explain that the action records a declaration if needed, then invoke the shared completion operation; no plan is required. A manual status edit is valid if explicitly requested. Do not fabricate fingerprints, tests, review approval or implementation revisions. A stale declaration asks for reassessment, not automatic implementation or status reset. Body-writing authorship policies still apply independently.

A technical feature requirement is not automatically an architecture leak. Explain suspected incidental detail and preserve user-approved contract mechanisms. Outside a managed plan, no plan checkout, handoff or managed commit format is imposed. Within one, use the operation's actual checks and recording procedure.
