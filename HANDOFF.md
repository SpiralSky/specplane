# Session handoff — spec review and fixes (2026-10-28)

## Goal
Cross-spec review of all Specplane specs, ADRs, and the first plan; fix every issue found.

## Decisions made (all now in the specs; revisit if you disagree)
- **PLANS.md is deterministic**: committed file shows stored status + `blocked` only; no timestamp. Live git/PR status via `plan list` / `generate --print --live`. (`feature/plan-index`)
- **Effective status**: derived statuses apply only to `ready` plans. (`feature/plan-status`)
- **Frontmatter status mode**: claim commits on the default branch (`in_progress` at start, `review` at finish, before the plan branch picks them up). (`feature/plan-status`)
- **Finish flow order**: readiness (all steps done/skipped) → tests (`plans.test_command`) → rebase → done+archive commit → PR/merge → `plan cleanup`. New `plan abandon`, `plan cleanup`; `plan archive` only moves folders. (`feature/plan-execution`)
- **Stacking**: at most one unmerged dependency; base recorded in an empty marker commit; restack with `rebase --onto`. (`feature/plan-execution`)
- **Step status `blocked`** for unattended contradictions; attended/unattended decided by the harness. (`feature/plan-steps`, `feature/spec-precedence`)
- **Spec edits on a plan branch keep `approved`**; resume skips approval checks. (`feature/spec-precedence` Rule 5)
- **Overlays**: no shadowing; unqualified IDs without root context search all roots (ambiguous → error); contradictions are warnings. (`feature/spec-overlays`)
- **Ordering policy** = error on approved arch spec with unapproved `implements`.
- **Leak guard**: never hard-fails; exempts interface names, Specplane keys, code blocks, `specs.feature.leak_guard_allow`. LLM review is agent-side only (`specs.llm_review`).
- **ADRs**: referenced only as `decision/NNNN`; duplicate numbers are a validation error; `decisions.dir` config.
- **New config keys**: `specs.llm_review`, `specs.feature.leak_guard_allow`, `plans.test_command`, `plans.forge`, `decisions.dir`. Unknown keys → warnings (schema severity mapping in `file-formats` §7.2).
- **Claude harness**: `.claude/skills/<name>/SKILL.md`; fixed pre-commit hook (stdin JSON, exit 2); fresh (non-fork) subagents. `architecture/agent-skills` is now harness-neutral.

## 2026-10-29 — Claude harness spec completed, plan started
- `claude:architecture/claude-integration` completed: template source (`harnesses/claude/templates/`), skill frontmatter (`argument-hint`, `disable-model-invocation`), shared preconditions (no-op without Specplane; CLI-absent fallback), attended/unattended rule for Claude Code, hardened pre-commit hook (`-c k=v`, missing `jq`, non-Specplane repos), optional hook scripts, settings merge, memory (OQ-5 proposed default), `init` CLI modules (`src/harness/`, later plan), tests. `architecture/repository-layout` notes `templates/` and `tests/`.
- New plan `2026-10-29-claude-harness-files` (3 steps, `use_subagent: true`), set `ready` at the user's direction despite feature specs in `review` (override recorded in the plan's HANDOFF.md).
- Initial commit made on `main`; `.gitignore` excludes `.claude/settings.local.json`. Plan runs in worktree `../.specplane-worktrees/specs-framework/2026-10-29-claude-harness-files/` on `plan/2026-10-29-claude-harness-files`.
- Later: a plan for `init --harness claude` (depends on `2026-10-28-reference-cli-core`); core step 04's AGENTS.md template should reuse this repo's AGENTS.md.

## Current state (as of 2026-10-28)
- Feature specs: `status: review` (none approved yet). Architecture specs: `draft`. Plan `2026-10-28-reference-cli-core`: `draft`, steps updated to match.
- Repo has **no commits yet**; everything is untracked.

## Next steps
1. Review the diff of the decisions above; approve feature specs (human sets `status: approved`).
2. Make the initial commit on `main`.
3. Resolve remaining open questions (OQ-1, 5, 6, 7, 9, 10) as needed.
4. Set the plan to `ready` and start step 01.
