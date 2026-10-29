# Session handoff

> **Standing instruction from the user**: read this file and continue the work. When you finish a milestone, rewrite this file (goal, decisions, current state, next steps, and this instruction) and tell the user. The user then starts a new session. Repeat until the project is complete.

## Goal
Build Specplane, a spec and plan management framework, in this repo: specs → plans → reference CLI → Claude harness (`init --harness claude`).

## Key decisions (all recorded in specs/ADRs; revisit only if you disagree)
- **PLANS.md is deterministic**: stored status + `blocked` only. Live status via `plan list --live`. (`feature/plan-index`)
- **Finish flow**: readiness → `plans.test_command` → rebase → done+archive commit → PR/merge → cleanup. (`feature/plan-execution`)
- **Stacking**: at most one unmerged dependency; base found via commit trailer; restack with `rebase --onto`.
- **Step status `blocked`** for unattended contradictions. **Spec edits on a plan branch keep `approved`.**
- **Overlays**: no shadowing; `extends` may be a list; contradictions are warnings.
- **Base pins (ADR 0003)**: `based_on` pins referenced specs by git blob hash. A stale pin gives a `base-changed` warning and blocks approval. `specplane spec pin [--check]`, `specs.pin_bases: off|warn|require`, `<id>#<slug>` anchors are checked, and skills carry `<!-- specplane-contract: …@blob -->` markers.
- **Claude harness**: Specplane never edits `CLAUDE.md`. Standing instructions go in `.claude/rules/specplane.md` plus the `AGENTS.md` managed block (`specplane:begin v1`). A policy-guard hook enforces `llm_role` (none→deny, assist→ask, draft→allow; covers NotebookEdit). The harness also adds session-context hooks, a status line, and an optional plans-pane plugin.
- **Commits**: Conventional Commits subject plus `Specplane-Workflow/Plan/Step/Agent` trailers (`file-formats` §8). The human stays the author.
- **Step records** live in `plans/<id>/HANDOFF.md`, not here.

## Current state (2026-10-29, autonomous completion finished)
- **All 9 plans are `done` and merged** into `main`. No worktrees, no plan branches, no remote. Unattended run: plans were auto-approved, one subagent ran each step, and the main session confirmed the `local_merge`s. The last two plans were finished with the CLI's own `plan start` / `plan finish`.
- **The `specplane` CLI is complete** (`packages/cli`, 211 tests): `init [--harness claude]`, `validate [--json]`, `generate [--print --live]`, `spec new/list/show/validate/pin`, `search`, `plan new/list [--live]/show/graph/start/finish/abandon/cleanup/archive/restack`, and forge (`gh`) PR support. CI workflows are in `.github/workflows/` (the publish workflow is never triggered).
- Install: `cd packages/cli && npm run build && npm install -g --prefix ~/.local .` (a symlink to this checkout). The pre-commit hook runs `specplane validate`, so `main` must stay at 0 errors (it does: 0 errors, 18 warnings — leak-guard hits were reviewed and allow-listed; pins current; check-sync and hook tests pass).
- **Every judgement call is in `AUTONOMOUS-CHOICES.md`**, which ends with a "Needs your decision" list: licence, publishing setup, the feature-spec proposals, leak-guard hits in feature specs, and behaviour changes worth a look.
- The deferred review findings below were all addressed: architecture-spec fixes on the plan branches, feature-spec findings as proposals.

## Next steps
1. Node requirement is now `>=22` (decided 2026-10-29). Licence chosen (Apache-2.0).
2. Feature-spec proposals were applied on 2026-10-29 (`676b645`), including Rule 6 and the per-plan `spec-gaps.md` record (`9491332`, user-approved design).
3. Plan `2026-10-29-feature-spec-alignment` was created 2026-10-29 (`draft`, 6 steps). It aligns the architecture specs, CLI, skills, and agents with the applied feature specs. **The user sets `status: ready`**, then `specplane plan start 2026-10-29-feature-spec-alignment` and `/plan-step` in the checkout.
4. Add a remote, then publish via a `v*` tag.
5. **llm_role change in progress (2026-10-29, user decision)**: the old `assist` becomes `review` (review-only); `assist` is redefined as refine-then-write (Describe → Refine → Finalise → Write after approval, `author: mixed`, status unchanged). Done: `feature/spec-policies` §1 edited, now `review`. It and `claude:feature`/`claude:architecture/claude-integration` were demoted to `review` (pin cascade). Next, as proposed edits the user approves: `feature/configuration` (enum), `feature/agent-integration` (spec-assist / spec-draft-architecture contracts, policy table, Scenario 1), `claude:feature/claude-integration` (guard line 77, Scenarios 5–6). Then the user re-approves; re-pin one level per commit; then a small plan for architecture specs, CLI enum, skill, guard hook, `.claude/` sync.
6. Tooling gap found 2026-10-29: editing an approved base spec that an approved overlay pins needs one commit per overlay level (demote to review → commit → pin → re-approve), because `spec pin` refuses uncommitted bases and the pre-commit hook refuses stale pins. The user chose a **separate plan**, after a `feature/tooling` change via `/spec-assist`.

## Deferred review findings (ADDRESSED 2026-10-29: see plan HANDOFFs and feature-spec-proposals.md files)
- **reference-cli**: specify the command surface beyond the core plan:
  - `spec new/list/show`, `search`, `plan new/list/show`, and `init` details;
  - what triggers `restack`;
  - the harness registry (`src/harness/`) and how freshness of `.claude/rules/specplane.md` is checked;
  - one error-message pattern (`PlanStateError` vs. the feature texts), and stderr for human reports;
  - leak-guard heuristics that miss "JSON Schema" and bare file extensions;
  - deprecated-reference warnings for `implements`/`extends`;
  - a backend/`where` field in plan activity;
  - an error class for "already exists";
  - `DEFAULT_CONFIG`, pointing to the defaults table in `feature/configuration`.
- **agent-skills**:
  - agent-side leak self-check, ordering check, and CLI-unavailable fallback;
  - `plan-finish`/`validate` contracts have no Policy check section.
- **claude architecture**:
  - the subagent step leaves the push step unassigned (give it to the parent);
  - check-sync describes the `settings.json` comparison as byte-identical, but it is a subset comparison.
- **ci**:
  - the prose and YAML triggers differ;
  - `plans/**` and `plans/PLANS.md` are hardcoded, although `plans.dir` is configurable.
- **file-formats**: the ID pattern allows `a//b` and needs 2+ characters after the type.
- **Features**:
  - plan-steps: what happens to the HANDOFF section when a `blocked` step is re-run (append, latest wins?); the example step files use `src/…` paths.
  - plan-status: abandon wording ("any non-terminal plan"); stack mode with a `ready` plan that has 2+ unmerged dependencies.
  - plan-index: Scenario 5 should be split in two.
  - decisions: validation cases (id/filename, `superseded_by` missing or cyclic).
  - spec-precedence: "both silent" has no numbered rule.
  - configuration: errors for `worktree_dir` inside the repo and for bad `spec_roots` paths.
  - tooling: `--no-fetch` is missing from the options list; `--type` takes different values in different commands.

## Open items
- Plugin: the gating hooks have no `.catch` guards (validate warns about this). The pane's "Read HANDOFF" button does nothing in `claude -p`.
