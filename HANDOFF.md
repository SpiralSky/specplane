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
- **Step records** live in `plans/<id>/HANDOFF.md`, not here. **Gaps/assumptions/proposals** live in `plans/<id>/spec-gaps.md` with status `open | applied | rejected` (`file-formats` §4.2).

## Current state (2026-10-29, feature-spec alignment merged)
- **10 plans are `done` and merged** into `main`; no worktrees, no plan branches, no remote. The newest is `2026-10-29-feature-spec-alignment`, archived at `plans/archive/2026-10-29-feature-spec-alignment/` (6/6 steps done, merged locally with its own `plan finish`).
- That plan aligned the architecture specs, CLI, skills, and standing instructions with the feature specs applied earlier: `spec-gaps.md` parsing/validation and finish listing, latest-HANDOFF-section rule, stack-mode `blocked`, abandon guard, `--no-fetch` on start/finish, `search --kind`, `restack --dry-run` commit listing, config spec-root path checks, ADR supersession rules, and Node 22 docs.
- **All 4 `spec-gaps.md` entries are dispositioned**: G1–G3 `applied` (G2 `init` spec-root exemption and G3 `ConfigError` null-key texts are now in `architecture/reference-cli`), G4 `rejected` — no CLI route deletes an already-abandoned plan's branch; `feature/plan-execution` deliberately keeps it, and `git branch -D` is the documented workaround.
- `plans/PLANS.md` was regenerated and committed after the merge. `main` is at **0 errors, 20 warnings** (reviewed leak-guard/overlay heuristics and 3 stale references in archived plans); `specplane spec pin --check` clean; `npm test` 228/228; `check-sync.sh` OK; `hooks.test.sh` 62/62.
- **`2026-10-29-assist-and-approve` is `draft`**, 6 pending steps, dependency satisfied. **The user must set `status: ready` by hand** before it can start.
- **Every judgement call is in `AUTONOMOUS-CHOICES.md`**, which ends with a "Needs your decision" list.

## Next steps
1. Set `status: ready` in `plans/2026-10-29-assist-and-approve/PLAN.md` (the user does this; the CLI's `plan approve` arrives with this plan). Then `specplane plan start 2026-10-29-assist-and-approve` and `/plan-step` in the checkout. It carries the `review` role, refine-then-write `assist`, `spec approve`/`reopen`, `plan approve`, `decision new`/`accept`, and the five new Claude slash commands.
2. After it merges, approve the specs still in `review` with the new `/approve` command: `architecture/agent-skills`, `architecture/reference-cli`, `architecture/repository-layout`, `architecture/ci`, `claude:architecture/claude-integration`. (`architecture/file-formats` and all feature specs are already `approved`.) The agent must not run the approval; it lists the command.
3. **Publishing (user decisions)**: add a remote, set `repository.url`, add the `NPM_TOKEN` secret, then publish via a `v*` tag. The publish workflow exists but has never run.
4. Decide whether to supersede `decision/0002` (it records Node ≥18; everything else is now ≥22).
5. Later follow-ups, not covered by any active plan: `architecture/reference-cli` § `search` grouped/JSON output still differs from the CLI (one hit per line with `type`); the plugin has no icon; the 20 validate warnings have no suppression mechanism.

## Addressed findings (kept for traceability)
All review findings from the first CLI/harness plans are resolved. The architecture-spec items (command surface, harness registry, error texts, leak-guard heuristics, plan activity fields, `plan-finish`/`validate` Policy checks, subagent push ownership, check-sync wording, CI triggers, ID pattern) were fixed on plan branches; feature-spec items were applied with user approval in `676b645`; and the remaining CLI/architecture alignment was completed by `2026-10-29-feature-spec-alignment`. Per-step detail is in the archived plans' `HANDOFF.md`.

## Open items
- **G4 accepted limitation**: after an `abandoned` plan has been abandoned once, its `plan/<id>` branch (and any worktree) can only be removed with `git branch -D` / `git worktree remove`. The specs intentionally keep the branch on abandon and `plan cleanup` only handles `done`.
- **Search output drift** (recorded in the alignment plan's step 03): the architecture spec describes grouped output and a `{id, kind, path, root, status, matches}` JSON shape; the CLI emits one hit per line with `type`. Needs its own plan.
- **Warnings backlog**: 20 `validate` warnings (leak-guard and "may contradict" overlay heuristics, 3 stale references in archived plans). Reviewed and accepted; no suppression exists.
- **Publishing metadata**: no remote/`repository.url`/`NPM_TOKEN`; plugin has no icon.
