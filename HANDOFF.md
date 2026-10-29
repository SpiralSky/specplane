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

## Current state (2026-10-29, later session)
- `main` clean after the OQ/step-05 commit. No remote. No worktrees.
- Plans `2026-10-29-claude-harness-files` and `2026-10-29-claude-instructions-and-enforcement`: **done, archived**.
- **All open questions resolved** (`docs/OPEN-QUESTIONS.md`): OQ-1 keep "Specplane" (npm name free; Specwright/Groundplan/Keel/spec-manager taken, Plane confusion accepted); OQ-5 recommended memory names, not enforced; OQ-6 warnings; OQ-7 warn; OQ-9 GitHub only, plus fully local via `local_merge` + `forge: none`; OQ-10 error.
- OQ-5 spec text is a pending patch for the user: `docs/proposals/oq-5-memory-names.patch` (`git apply` it; feature specs are assist-only).
- CLI-core plan now has **step 05 `05-base-pins`** (pins, `pin_bases`, anchors, skill drift, `spec pin`). PLAN.md, step 04 guidance, and PLANS.md updated to match.
- Specs: all 18 feature specs `status: review` (**none approved**); architecture specs `draft`. `specplane` CLI not built.

## Spec gaps found (recorded in step 05)
- `architecture/file-formats` lacks the sections "Pin, anchor, and skill-contract findings" and "Skill contract comment" that `reference-cli` and `agent-skills` cite. Fixable by Claude (architecture `llm_role: draft`), but editing re-stales pins; needs a re-pin commit afterwards.
- `feature/tooling` does not list `specplane spec pin` (defined in `feature/spec-overlays`). Needs a user-authored edit or patch.
- "Skill directory registered by an installed harness" is undefined until the `init --harness` plan; step 05 uses a stand-in `skillDirs()`.

## Next steps
1. **User**: apply (or reject) the OQ-5 patch; optionally switch this repo's `plans.merge` to `local_merge` (there is no remote).
2. Decide on the spec gaps above (Claude can add the two `file-formats` sections, then re-pin).
3. **User**: approve feature specs, or explicitly override `require_approved_specs` for CLI-core.
4. Set `2026-10-28-reference-cli-core` to `ready` and run `/plan-step` (5 steps) in a worktree (`../.specplane-worktrees/specs-framework/<id>/`).
5. After the CLI exists: `specplane spec pin --check`, `specplane validate`, `specplane generate`.
6. Later: plan for `init --harness claude` (depends on CLI-core); it should define harness skill-dir registration.

## Open items
- Plugin: `.catch` guards are missing on gating hooks (validate warnings). The pane's "Read HANDOFF" button is a no-op in `claude -p`.
