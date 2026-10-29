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

## Current state (2026-10-29, end of session)
- `main` @ `e52414a`, clean except this file. No remote: plans are merged locally. No worktrees.
- Plans `2026-10-29-claude-harness-files` and `2026-10-29-claude-instructions-and-enforcement`: **done, archived** in `plans/archive/`. PLANS.md was updated by hand.
- Pins patch applied (ADR 0003 and related spec changes). All `based_on`/contract pins match the current blobs. Verified: `hooks.test.sh` 62/62, `check-sync.sh` OK, `claude plugin validate` passes (warnings only), `claude plugin test` 9/9.
- Specs: all 18 feature specs are `status: review` (**none approved**). Architecture specs are `draft`.
- Remaining plan: `2026-10-28-reference-cli-core` (`draft`, 4 steps). `specplane` CLI is not built, so skills and hooks run in their no-CLI fallback.

## Next steps
1. **Update the CLI-core plan for pins** (gap: no step covers it). Add `pins.ts` (stale check, status/author-only normalisation, frontmatter rewrite, anchor check), the `base-changed`/missing-pin/anchor/`skill-drift` validation rules, the `specs.pin_bases` config, and the `specplane spec pin [--check]` command. Do this in step 03 (validation) or a new step, following `architecture/reference-cli` and `feature/spec-overlays#base-pins`.
2. **User**: review and approve feature specs (`status: approved`). `plans.require_approved_specs: feature` blocks CLI-core otherwise, or the user can override it explicitly, as was done for harness-files.
3. Set `2026-10-28-reference-cli-core` to `ready` and run `/plan-step` in a worktree (`../.specplane-worktrees/specs-framework/<id>/`).
4. After the CLI exists, run `specplane spec pin --check` and `specplane validate`, then regenerate PLANS.md with `specplane generate`.
5. Later: plan for `init --harness claude` (depends on CLI-core). CLI-core step 04's AGENTS.md template should reuse this repo's managed block.

## Open items
- Plugin: `.catch` guards are missing on gating hooks (validate warnings). The pane's "Read HANDOFF" button is a no-op in `claude -p`.
- Open questions in `docs/OPEN-QUESTIONS.md` (OQ-1, 5, 6, 7, 9, 10) are still unresolved.
