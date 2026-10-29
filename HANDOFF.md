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

## Current state (2026-10-29, spec-approval session)
- `main` clean. No remote. No worktrees. `plans.merge: local_merge` (forge stays `auto`, which acts as `none` without a remote).
- **All 20 specs are `approved`** (14 feature, 6 architecture). The user told me to apply the OQ-5 patch, fix issues, and approve them. That was done after a three-part review (core features, plan/agent features, architecture). All must-fix findings were fixed in commits `d188bb9`..`75afbd9`.
- The fixes include:
  - a `local_merge` section and scenario in `feature/plan-execution`;
  - restacking at finish, and skipping fetch when there is no remote;
  - the OQ-10 `INFO.md` error;
  - `spec pin` added to `feature/tooling`;
  - the pin_bases semantics aligned (stale pins always block approval);
  - `file-formats` §1.5 (finding messages, including a new `pin` type) and §1.6 (skill contract comment);
  - CLI housekeeping subjects exempted from the 72-character limit;
  - skill-contract wording aligned to `architecture/agent-skills` with a `skill-drift` warning;
  - OQ-4 recorded as the widened hook defaults.
- Pins are refreshed: `claude:feature/claude-integration`, `claude:architecture/claude-integration`, and the skill `specplane-contract` comments (`@21e5329`). check-sync and hook tests pass.
- Plans `claude-harness-files` and `claude-instructions-and-enforcement` are done and archived. The CLI-core plan (`2026-10-28-reference-cli-core`, 5 steps) is still `draft`. Step 05 guidance no longer lists the closed gaps. `specplane` CLI is not built yet.

## Next steps
1. Set `2026-10-28-reference-cli-core` to `ready` and run `/plan-step` in a worktree (`../.specplane-worktrees/specs-framework/<id>/`). Finish with `local_merge`.
2. After the CLI exists, run `specplane spec pin --check`, `specplane validate`, and `specplane generate`. Expect the CLI to surface anything the hand review missed.
3. Later, write the plan for `init --harness claude` (it depends on CLI-core). It should define harness skill-dir registration; step 05 uses a stand-in `skillDirs()`.

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
