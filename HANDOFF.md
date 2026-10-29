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

## Current state (2026-10-29, autonomous completion session)
- The user asked for the whole repo to be completed unattended: plans are auto-approved (`ready`), one subagent runs each plan step, and the main session acts as the confirming human for `local_merge`. Every judgement call is listed in `AUTONOMOUS-CHOICES.md` (details in each plan's `HANDOFF.md`, items marked `CHOICE:`).
- All 20 specs are `approved`. Feature specs are never edited by agents (`llm_role: assist`); feature-spec findings go to `feature-spec-proposals.md` files in plan folders.
- **Done and merged**: `2026-10-28-reference-cli-core`, `2026-10-29-claude-plugin-hardening`, `2026-10-29-cli-claude-harness-init`, `2026-10-29-cli-spec-search`, `2026-10-29-cli-plan-commands`. Earlier: `claude-harness-files`, `claude-instructions-and-enforcement`. The CLI in `packages/cli` has `validate`, `generate [--print --live]`, `init [--harness claude]`, `spec new/list/show/validate/pin`, `search`, and `plan new/list [--live]/show/graph` (159 tests).
- CLI install: `cd packages/cli && npm run build && npm install -g --prefix ~/.local .` (this is a symlink, so a rebuild updates it). With `specplane` on PATH, the pre-commit hook runs `specplane validate` on the main checkout, so `main` must stay at 0 errors.
- **In progress**: `2026-10-29-cli-plan-flows`, then `2026-10-29-cli-forge-ci-publish` (worktree under `../.specplane-worktrees/specs-framework/`).
- Open for the user: the plugin has no LICENSE (the plugin directory refuses a submission without one), and there is no icon.

## Next steps
1. Run the remaining plans in order, one step per subagent, and finish each with `local_merge` (by hand until `plan finish` exists): `cli-plan-flows` → `cli-forge-ci-publish`.
2. After each merge: `specplane validate`, `specplane spec pin --check`, `specplane generate`.
3. At the end: the user reviews `AUTONOMOUS-CHOICES.md` and the `feature-spec-proposals.md` files.

## Deferred review findings (should-fix/nits, not blocking; fix as spec edits on the relevant plan branch)
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
