# Session handoff — 2026-10-29

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

## 2026-10-29 — Plan merged, next plan ready

**Plan `2026-10-29-claude-harness-files` is done and merged to main.**
- Commit `f9fd282`. Branch deleted. Worktree removed.
- All arch and feature specs updated (standing instructions, commit trailers, policy guard, session context hooks, live view plugin, `plan list --live`, worktree/cloud session rules).
- `2026-10-29-claude-instructions-and-enforcement` is now `ready` (3 steps; depends on harness-files ✓).

**Next**: start plan `2026-10-29-claude-instructions-and-enforcement` — produces the new enforcement hooks, rules file, and updated templates. Run `/plan-step` in a new worktree.

**Open items** (from previous sessions, still unresolved):
- `feature/agent-integration` doesn't define the step-commit message format for AGENTS.md; now moot (the format is in `file-formats §8`).
- Later: plan for `init --harness claude` (depends on `2026-10-28-reference-cli-core`); CLI-core step 04's AGENTS.md template should reuse this repo's AGENTS.md.

---

## 2026-10-29 — Claude harness spec completed, plan started
- `claude:architecture/claude-integration` completed: template source (`harnesses/claude/templates/`), skill frontmatter (`argument-hint`, `disable-model-invocation`), shared preconditions (no-op without Specplane; CLI-absent fallback), attended/unattended rule for Claude Code, hardened pre-commit hook (`-c k=v`, missing `jq`, non-Specplane repos), optional hook scripts, settings merge, memory (OQ-5 proposed default), `init` CLI modules (`src/harness/`, later plan), tests. `architecture/repository-layout` notes `templates/` and `tests/`.
- New plan `2026-10-29-claude-harness-files` (3 steps, `use_subagent: true`), set `ready` at the user's direction despite feature specs in `review` (override recorded in the plan's HANDOFF.md).
- Initial commit made on `main`; `.gitignore` excludes `.claude/settings.local.json`. Plan runs in worktree `../.specplane-worktrees/specs-framework/2026-10-29-claude-harness-files/` on `plan/2026-10-29-claude-harness-files`.
- **All 3 steps done** on the plan branch (commits 2d62c45, f2a5266, d0f1045 regex fix for `(git commit)`, ffb7285, ea894c8 step gaps folded into the Claude arch spec). Hook tests 23/23, `check-sync.sh` OK. Branch not pushed; finish flow not run.
- Next: review the branch, then run the finish flow by hand (`feature/plan-execution` § Finish flow; no remote, so merge locally instead of a PR) and `git worktree remove`. After merge, a new session in this repo picks up `/plan-step` etc. and the pre-commit hook (no-op until `specplane` is installed).
- Open for the user: `feature/agent-integration` doesn't define the step-commit message format for AGENTS.md (AGENTS.md uses the plan-step skill's format); AGENTS.md is 82 lines (step aimed for 100–150).
- Later: a plan for `init --harness claude` (depends on `2026-10-28-reference-cli-core`); core step 04's AGENTS.md template should reuse this repo's AGENTS.md.

## 2026-10-29 (later) — agent instructions, commit format, enforcement redesign
All edits are **uncommitted in the plan worktree** (`../.specplane-worktrees/specs-framework/2026-10-29-claude-harness-files/`), on top of the unmerged plan branch.
- **Decisions**: Specplane never edits user-owned `CLAUDE.md`. Standing instructions (about 20 lines: config, llm_role meanings, precedence, plans/commits, workflows) go in `.claude/rules/specplane.md` (Claude) plus an `AGENTS.md` managed block (`<!-- specplane:begin v1 … -->`); procedures live only in skills. Authorship policy is enforced by a PreToolUse **policy guard** hook (none→deny, assist→ask, draft→allow). A SessionStart hook scopes each session to its plan and step, and a status line is added. Commits use a Conventional Commits subject plus `Specplane-Workflow/Plan/Step/Agent/Session` trailers. The author stays the human; tools read trailers (restack finds the marker by trailer). Plugin (plans pane + `step`/`spec` mode) is optional and local-only (cloud sessions don't install plugins).
- **Architecture specs edited**: `file-formats` §8 (new), `agent-skills` (§ Standing instructions, plan-step steps 1/9/10), `reference-cli` (`git/commit.ts`, `agents/standing.ts`, § Plan activity for `plan list --live`, flow commit messages), `ci`, `claude:architecture/claude-integration` (rules file, hooks, settings merge, § Worktree and cloud sessions, § Live view and Specplane mode, tests).
- **Feature specs NOT edited** (`llm_role: assist`): suggested changes are in `docs/proposals/2026-10-29-feature-spec-changes.patch` (agent-integration, plan-steps, plan-execution, tooling, claude feature spec). Apply with `git apply` after review.
- **Plans**: new `2026-10-29-claude-instructions-and-enforcement` (draft, 3 steps, depends on harness-files); CLI-core steps 03/04 updated for `agents/standing.ts` and the managed block. PLANS.md updated by hand.
- Next: review the arch diff and the patch → apply the patch → commit on the plan branch → finish harness-files plan → set the new plan ready.

## Current state (as of 2026-10-28)
- Feature specs: `status: review` (none approved yet). Architecture specs: `draft`. Plan `2026-10-28-reference-cli-core`: `draft`, steps updated to match.
- Repo has **no commits yet**; everything is untracked.

## Next steps
1. Review the diff of the decisions above; approve feature specs (human sets `status: approved`).
2. Make the initial commit on `main`.
3. Resolve remaining open questions (OQ-1, 5, 6, 7, 9, 10) as needed.
4. Set the plan to `ready` and start step 01.

## Step 01: Standing instructions, AGENTS.md block, and skill commit format
**Date**: 2026-10-29
**Outcome**: done

### Changes
- Added `harnesses/claude/templates/rules/specplane.md` (standing text `v1`, Claude Workflows line, Claude Code section, no `paths:` frontmatter); deleted `templates/CLAUDE.md` and the root `CLAUDE.md`.
- Replaced `AGENTS.md` with only the managed block (begin/end markers, harness-neutral Workflows line).
- `plan-step` template: step 1 fetch/fast-forward/stop on divergence, step 9 section 8 commit with trailers, new step 10 push; subagent branch now covers steps 3-10; old `plan/<id> step NN:` format removed.
- All six skill preconditions now check only `.specplane/config.yaml`.
- `check-sync.sh` no longer maps `CLAUDE.md`; `templates/rules/` maps to `.claude/rules/` via the generic rule. Copied templates to `.claude/rules/` and `.claude/skills/`; `check-sync.sh` exits 0.
- Sample commit message checked with `git interpret-trailers --parse`: trailers parse in order.

### Gaps
- The step prompt gave `Specplane-Workflow: plan-step` and `Specplane-Agent: claude`; `architecture/file-formats` section 8.2/8.3 define `step` and `<harness>[/<model>]` (e.g. `claude-code`). Architecture wins, so `step` and `claude-code` are used.
- The step file and HANDOFF.md were edited in the worktree copies (committed on the plan branch), not the main checkout.

### Open issues
None.

### Spec coverage
`architecture/agent-skills` (Standing instructions, Delivery, plan-step), `architecture/file-formats` section 8, `claude-integration` (Files produced, Template source, Standing instructions, Shared preamble, Worktree and cloud sessions).

### Next
Step 02: enforcement hooks.
