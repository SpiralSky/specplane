# Session handoff

> **Standing instruction from the user (2026-10-29)**: read this file and continue the work. When you finish a milestone, rewrite this file (goal, decisions, current state, next steps, and this instruction) and tell the user. The user then starts a new session. Repeat until the project is complete.
>
> **Standing instruction (2026-10-29, later)**: the agent decides open questions itself and verifies them at the plan merge (`/plan-finish`) instead of pausing mid-plan. After the last plan is done, the user will do a full review of the codebase and of the workflow as a whole and make final amendments then; the general structure is to be treated as solid until that review. This is recorded in every plan HANDOFF added since.

## Goal
Build Specplane, a spec and plan management framework, in this repo: specs → plans → reference CLI → Claude harness (`init --harness claude`).

## Key decisions (all recorded in specs/ADRs; revisit only if you disagree)
- **PLANS.md is deterministic**: stored status + `blocked` only. Live status via `plan list --live`. (`feature/plan-index`)
- **Finish flow**: readiness → `plans.test_command` → rebase → done+archive commit → PR/merge → cleanup. (`feature/plan-execution`)
- **Stacking**: at most one unmerged dependency; base found via commit trailer; restack with `rebase --onto`.
- **Step status `blocked`** for unattended contradictions. **Spec edits on a plan branch keep `approved`.**
- **Overlays**: no shadowing; `extends` may be a list; contradictions are warnings.
- **Base pins (ADR 0003)**: `based_on` pins referenced specs by git blob hash. A stale pin gives a `base-changed` warning and blocks approval. `specplane spec pin [--check]`, `specs.pin_bases: off|warn|require`, `<id>#<slug>` anchors, and skills carry `<!-- specplane-contract: …@blob -->` markers.
- **Roles (2026-10-29)**: `llm_role` is `review | assist | draft | none`. `review` = ask/suggest/review only; `assist` = refine-then-write (Describe → Refine → Finalise → Write, `author: mixed`, status unchanged). Approval is always the human's.
- **Approval commands**: `spec approve`/`spec reopen`, `plan approve`, `decision new`/`accept`, each committing via the `approve` workflow trailer (`docs(specs): approve|reopen <id>`, `docs(<plan-id>): approve plan`, `docs(decisions): accept <id>`). `--dry-run` on the status-changing ones (G1).
- **Claude harness**: Specplane never edits `CLAUDE.md`. Standing instructions go in `.claude/rules/specplane.md` plus the `AGENTS.md` managed block (`specplane:begin v1`). The policy guard enforces `llm_role` (`none`→deny, `review`/`assist`→ask, `draft`→allow) and denies any agent edit that sets `approved`/`ready`/`accepted`; `/approve` is user-only (`disable-model-invocation: true`).
- **`spec reopen` is report-only**: it lists direct dependants and changes nothing else. A `--cascade` option was considered and deliberately not added (it would need a feature-spec edit).
- **Commits**: Conventional Commits subject plus `Specplane-Workflow/Plan/Step/Agent/Session` trailers. The human stays the author.
- **Subagents (2026-10-29)**: all eight agents in `~/.pi/agent/agents/` pin `deepseek/deepseek-flash`, matching pi's global default. The OpenRouter ids (`z-ai/glm-5.3*`, `anthropic/claude-sonnet-5.5`) were dropped when that key ran out of credits.

## Current state (2026-10-29, `assist-and-approve` merged)
- **11 plans are `done` and merged** into `main`; no worktree, no plan branch, no remote. The newest, `2026-10-29-assist-and-approve`, is archived at `plans/archive/2026-10-29-assist-and-approve/` (6/6 steps done, merged locally by its own `plan finish`).
- That plan implemented the `review` role and refine-then-write `assist` across the architecture specs, config, standing instructions, five slash commands, and the guard; and added `spec approve`/`reopen`, `plan approve`, `decision new`/`accept` with tests.
- **All 20 specs are `approved`.** Nothing is waiting for `/approve`.
- **`main` is clean and green**: `validate` 0 errors / 20 warnings (17 "may contradict" overlay heuristics reviewed as fine, 3 stale context references in archived plans), `spec pin --check` clean, `npm test` 254/254, `check-sync.sh` OK, `hooks.test.sh` 73/73, `PLANS.md` freshly generated and committed.
- **Three open `spec-gaps.md` entries**, archived with the plan: G1 (`--dry-run` on the approval commands), G2 (`plan approve` regenerates `PLANS.md` in the same commit), G3 (`decision new`'s "already exists" refusal is unreachable under the highest-number-plus-one rule). All are implemented/settled as described; they need the user's verdict at the final review.

## Next steps
1. **The user's full codebase and workflow review** (the standing instruction above) — the last known milestone. Candidates for that pass: G1–G3, the report-only `spec reopen`, whether `/approve` should stay user-only, and whether the 20 warnings deserve a suppression mechanism.
2. **Publishing (user decisions)**: add a remote, set `repository.url`, add the `NPM_TOKEN` secret, then publish via a `v*` tag. The publish workflow exists but has never run.
3. Decide whether to supersede `decision/0002` (it records Node ≥18; everything else is now ≥22).
4. Later follow-ups, not covered by any plan: `architecture/reference-cli` § `search` grouped/JSON output still differs from the CLI (one hit per line with `type`); the plugin has no icon.

## Addressed findings (kept for traceability)
All review findings from the earlier CLI/harness plans are resolved; detail is in the archived plans' `HANDOFF.md`. The `assist-and-approve` plan additionally fixed its own review findings: the policy guard now compares the new status with the existing one (so rewriting an already-approved spec is not denied), and overlay re-pinning is gated on frontmatter `extends` rather than the root chain.

## Open items
- **Worktree-only validate warning**: a plan worktree without `.claude/settings.local.json` reports 21 warnings instead of 20. Cosmetic; the main checkout is the reference.
- **Approval is agent-denied but not agent-impossible**: the guard cannot see `Bash` edits (`sed -i`, redirection); the standing instructions cover that gap, as specified.
