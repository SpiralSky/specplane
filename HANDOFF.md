# Session handoff

> **Standing instruction from the user (2026-10-29)**: read this file and continue the work. When you finish a milestone, rewrite this file (goal, decisions, current state, next steps, and this instruction) and tell the user. The user then starts a new session. Repeat until the project is complete.
>
> **Standing instruction (2026-10-29, later)**: the agent decides open questions itself and verifies them at the plan merge (`/plan-finish`) instead of pausing mid-plan. After the last plan is done, the user will do a full review of the codebase and of the workflow as a whole and make final amendments then; the general structure is to be treated as solid until that review. Also recorded in `plans/2026-10-29-assist-and-approve/HANDOFF.md`, and to be repeated in every later plan HANDOFF.

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
- **Step records** live in `plans/<id>/HANDOFF.md`, not here. **Gaps/assumptions/proposals** live in `plans/<id>/spec-gaps.md` with status `open | applied | rejected` (`file-formats` §4.2).

## Current state (2026-10-29, `2026-10-29-assist-and-approve` in progress)
- **10 plans are `done` and merged** into `main`; the newest is `2026-10-29-feature-spec-alignment`, archived. `main` was at 0 errors / 20 warnings before this plan.
- **All 20 specs are now `approved`** and committed on `main` (`44a18df`, `b6ee1cf`, `dd829a6`, `f6a9012`, `bbf4d19`) — the five architecture specs that were in `review` were approved at the user's explicit request, and `plans/PLANS.md` was regenerated. Writes that set `approved`/`ready`/`accepted` are the user's decision; from step 05 of this plan the Claude harness guard denies them for the agent.
- **`2026-10-29-assist-and-approve` was approved by hand** (`6f02019`, `status: ready`) because `plan approve` only lands in step 04. It runs in the worktree `../.specplane-worktrees/specs-framework/2026-10-29-assist-and-approve` on branch `plan/2026-10-29-assist-and-approve`.
- **Step 01 is `done`** (`48c61b0`): the architecture specs now specify the `review` role, refine-then-write `assist`, and the approval commands. `validate` there: 0 errors, 33 warnings (12 new `skill-drift` warnings until step 05 refreshes the skill pins). Two assumption entries, G1/G2, are open in the plan's `spec-gaps.md`.
- **Next step: 02** (`config-and-policy`).

## Next steps
1. Run steps 02–06 of `2026-10-29-assist-and-approve` one at a time (`/plan-step`), then `/plan-finish`. Note the temporary `skill-drift` warnings are cleared by step 05.
2. After the plan merges, the user's **full codebase and workflow review** (see the standing instruction above) decides the open items below.
3. **Publishing (user decisions)**: add a remote, set `repository.url`, add the `NPM_TOKEN` secret, then publish via a `v*` tag. The publish workflow exists but has never run.
4. Decide whether to supersede `decision/0002` (it records Node ≥18; everything else is now ≥22).
5. Later follow-ups: `architecture/reference-cli` § `search` grouped/JSON output still differs from the CLI (one hit per line with `type`); the plugin has no icon; the 20 validate warnings (now more, temporarily) have no suppression mechanism.

## Open questions the agent decided (verify at `/plan-finish` and at the user's final review)
- **`spec reopen` stays report-only** (direct dependants, not transitive). `feature/tooling` fixes "It does not change those specs"; a `--cascade` flag would need a feature-spec edit the agent may not make. Revisit at the final review.
- **`--dry-run` on the approval commands** (G1) and **`plan approve` regenerating PLANS.md in the same commit** (G2) are architecture-spec assumptions where `feature/tooling` is silent.
- **`/approve` stays user-only** (`disable-model-invocation: true`); the user may amend the workflow later.

## Addressed findings (kept for traceability)
All review findings from the first CLI/harness plans are resolved. The architecture-spec items (command surface, harness registry, error texts, leak-guard heuristics, plan activity fields, `plan-finish`/`validate` Policy checks, subagent push ownership, check-sync wording, CI triggers, ID pattern) were fixed on plan branches; feature-spec items were applied with user approval in `676b645`; and the remaining CLI/architecture alignment was completed by `2026-10-29-feature-spec-alignment`. Per-step detail is in the archived plans' `HANDOFF.md`.

## Open items
- **G4 accepted limitation**: after an `abandoned` plan has been abandoned once, its `plan/<id>` branch (and any worktree) can only be removed with `git branch -D` / `git worktree remove`. The specs intentionally keep the branch on abandon and `plan cleanup` only handles `done`.
- **Search output drift** (recorded in the alignment plan's step 03): the architecture spec describes grouped output and a `{id, kind, path, root, status, matches}` JSON shape; the CLI emits one hit per line with `type`. Needs its own plan.
- **Warnings backlog**: 20 `validate` warnings (leak-guard and "may contradict" overlay heuristics, 3 stale references in archived plans). Reviewed and accepted; no suppression exists.
- **Publishing metadata**: no remote/`repository.url`/`NPM_TOKEN`; plugin has no icon.
