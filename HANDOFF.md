# Session handoff

> **Standing instruction from the user (2026-10-29)**: read this file and continue the work. When you finish a milestone, rewrite this file (goal, decisions, current state, next steps, and this instruction) and tell the user. The user then starts a new session. Repeat until the project is complete.
>
> **Standing instruction (2026-10-29, later)**: the agent decides open questions itself and verifies them at the plan merge (`/plan-finish`) instead of pausing mid-plan. After the last plan is done, the user will do a full review of the codebase and of the workflow as a whole and make final amendments then; the general structure is to be treated as solid until that review.
>
> **Next session is the user's review session.** No implementation plan is open. Do **not** start new feature work; the user drives the review and decides the amendments. Use the checklist in "Next steps" below, answer questions with references to specs/code, and only change files the user asks for. Record every amendment they approve in a new plan (or a `spec-gaps.md` entry) rather than editing approved specs ad hoc.

## Goal
Build Specplane, a spec and plan management framework, in this repo: specs → plans → reference CLI → Claude harness (`init --harness claude`).

The build-out is **complete** (11 plans done and merged, 20 specs approved). What remains is the user's final review and the release decisions.

## Key decisions (all recorded in specs/ADRs; revisit only if you disagree)
- **PLANS.md is deterministic**: stored status + `blocked` only. Live status via `plan list --live`. (`feature/plan-index`)
- **Finish flow**: readiness → `plans.test_command` → rebase → done+archive commit → PR/merge → cleanup. (`feature/plan-execution`)
- **Stacking**: at most one unmerged dependency; base found via commit trailer; restack with `rebase --onto`.
- **Step status `blocked`** for unattended contradictions. **Spec edits on a plan branch keep `approved`.**
- **Overlays**: no shadowing; `extends` may be a list; contradictions are warnings.
- **Base pins (ADR 0003)**: `based_on` pins referenced specs by git blob hash. A stale pin gives a `base-changed` warning and blocks approval. `specplane spec pin [--check]`, `specs.pin_bases: off|warn|require`, `<id>#<slug>` anchors.
- **Roles**: `llm_role` is `review | assist | draft | none`. `review` = ask/suggest/review only; `assist` = refine-then-write (Describe → Refine → Finalise → Write, `author: mixed`, status unchanged). Approval is always the human's.
- **Approval commands**: `spec approve`/`spec reopen`, `plan approve`, `decision new`/`accept`, each committing via the `approve` workflow trailer. `--dry-run` on the status-changing ones (G1).
- **Claude harness**: Specplane never edits `CLAUDE.md`. Standing instructions go in `.claude/rules/specplane.md` plus the `AGENTS.md` managed block (`specplane:begin v1`). The policy guard enforces `llm_role` and denies any agent edit that sets `approved`/`ready`/`accepted`; `/approve` is user-only.
- **`spec reopen` is report-only**: it lists direct dependants and changes nothing else. A `--cascade` option was deliberately not added.
- **Commits**: Conventional Commits subject plus `Specplane-*` trailers (`architecture/file-formats` §8). The human stays the author.
- **Subagents (2026-10-29)**: all eight agents in `~/.pi/agent/agents/` pin `deepseek/deepseek-flash`.
- **Node baseline (ADR 0004, 2026-10-29)**: the reference CLI requires **Node ≥ 22 LTS**. ADR 0002 is `superseded` and points at 0004; the TypeScript/npm choice itself is unchanged.

## Current state (2026-10-29, after the hygiene pass)
- **11 plans are `done` and merged** into `main`; `plans/` contains only `archive/` plus the generated `PLANS.md` ("Active plans: _None._"). No worktree, no plan branch, no remote.
- **All 20 specs are `approved`.** Three ADRs: 0001 accepted, 0002 superseded by 0004, 0003 accepted, 0004 accepted.
- **`main` is clean and green**: `validate` 0 errors / 20 warnings (17 reviewed "may contradict" overlay heuristics, 3 stale context references in archived plans), `spec pin --check` clean, `npm test` **254/254**, `check-sync.sh` OK, `hooks.test.sh` 73/73.
- **Fixed this session:** `packages/cli/test/fixtures/configs/review-role/` was missing its `docs/specifications/.gitkeep`. It had been created untracked in the plan worktree, so the committed fixture made `llm_role review is accepted for both spec types` fail at HEAD (`npm test` was 253/254, not the 254/254 the previous handoff claimed). Restored in `86867e4`.
- **Decided this session (user-directed):** ADR `0004-raise-the-nodejs-baseline-to-22-lts.md` (accepted in `8e1c94a`) supersedes `decision/0002`'s Node ≥ 18 prerequisite, which contradicted `engines.node`, CI, `architecture/reference-cli`, and the README. `decision/0002` is now `superseded` (`cbc9171`).

## Next steps
1. **The user's full codebase and workflow review — this session's purpose.** Suggested checklist (the last known milestone):
   - **G1–G3** from `plans/archive/2026-10-29-assist-and-approve/spec-gaps.md`: `--dry-run` on the approval commands; `plan approve` regenerating `PLANS.md` in the same commit; `decision new`'s unreachable "already exists" refusal under highest-number-plus-one.
   - Report-only `spec reopen` (no `--cascade`); whether `/approve` should stay user-only.
   - The 20 standing `validate` warnings: accept as-is, or add a suppression mechanism? Note 3 are stale `context` references in archived plans — cheap to fix if wanted.
   - `architecture/reference-cli` still says "See `decision/0002`" for the language; 0002 now forwards to 0004. Decide whether to point it at 0004 (or both).
   - End-to-end sanity of the workflow as documented in `architecture/agent-skills` vs the shipped CLI/skills.
2. **Publishing (user decisions)**: add a remote, set `repository.url`, add the `NPM_TOKEN` secret, then publish via a `v*` tag. The publish workflow exists but has never run.
3. Later follow-ups, not covered by any plan: `architecture/reference-cli` § `search` grouped/JSON output still differs from the CLI (one hit per line with `type`); the plugin has no icon.

## Addressed findings (kept for traceability)
All review findings from the earlier CLI/harness plans are resolved; detail is in the archived plans' `HANDOFF.md`. The `assist-and-approve` plan fixed its own review findings (policy guard compares new and existing status so rewriting an already-approved spec is not denied; overlay re-pinning gated on frontmatter `extends`). This session's fixture regression is fixed and documented above.

## Open items
- **Worktree-only validate warning**: a plan worktree without `.claude/settings.local.json` reports 21 warnings instead of 20. Cosmetic; the main checkout is the reference.
- **Approval is agent-denied but not agent-impossible**: the guard cannot see `Bash` edits (`sed -i`, redirection); the standing instructions cover that gap, as specified.
