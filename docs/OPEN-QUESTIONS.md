# Open Questions

This document records design questions where a decision could not be made with certainty. Each open entry includes a proposed default (which the specs currently follow) and the alternatives considered.

Open questions should be resolved before the reference CLI implementation that depends on them. When a question is resolved, its entry moves to the "Resolved questions" table, pointing to where the decision is recorded (a spec section, or an ADR for decisions with significant trade-offs). Question IDs are permanent and are used by other specs.

---

## Resolved questions

| ID | Question | Resolution | Where recorded |
|----|----------|------------|----------------|
| OQ-2 | Slash commands as skill files vs. bash aliases? | Project skills (`.claude/skills/<name>/SKILL.md`) | `claude:feature/claude-integration` § Slash commands; `claude:architecture/claude-integration` |
| OQ-3 | Subagents per step by default? | Off by default; per-step opt-in via `use_subagent: true`; fresh (non-fork) subagent | `claude:feature/claude-integration` § Subagents per step |
| OQ-4 | Which Claude Code hooks enabled by default? | Pre-commit validation, the policy guard, and session context (plus the status line unless one exists); others opt-in. Widened from "pre-commit only" when the enforcement plan added the guard and session context | `claude:feature/claude-integration` § Hooks |
| OQ-8 | Step file frontmatter? | Yes — `plan`, `step`, `title`, `status`, `context`, optional `use_subagent` | `feature/plan-steps` § Step frontmatter |
| OQ-11 | Worktree path collision across repos? | `<worktree_dir>/<repo-name>/<plan-id>/`, resolved against the main checkout | `feature/configuration` § `execution.worktree_dir`; `feature/plan-execution` |
| OQ-6 | Architecture-leak guard: heuristic vs. hard failure? | Warnings only; a human reviewer decides | `feature/spec-policies` §3 |
| OQ-7 | PLANS.md freshness: hard-fail or warn? | Warn only | `feature/plan-index` |
| OQ-9 | Forge integration scope in v1? | GitHub only (PR status for `review`, open PR in finish flow). Fully local use is supported via `plans.merge: local_merge` + `plans.forge: none` with worktrees | `feature/configuration`; `feature/plan-execution` |
| OQ-10 | `INFO.md` with frontmatter: error or warn? | Error (almost always a misnamed spec) | `feature/spec-system` |
| OQ-5 | Standard memory keys for Claude Code? | Recommended set (`specplane-active-plan`, `specplane-open-questions`, `specplane-spec-gaps`), not enforced (applied in d188bb9) | `claude:feature/claude-integration` § Memory integration |
| OQ-1 | Name of the framework? | Keep "Specplane" (npm name free as of 2026-10-29; alternatives checked were taken) | this table |
| OQ-12 | Where does step orchestration live? | The conductor is in the shared core and each extension supplies its own adapter | `decision/0005` |
| OQ-13 | Is auto-run opt-in or the default for `plan start`? | Neither: the standalone CLI never launches a session; automated runs start only from an extension | `decision/0005` |
| OQ-14 | Who owns the worktree when a harness runs a background session? | Specplane owns it, and the adapter launches in that checkout | `claude:architecture/claude-integration` § Claude session adapter |
| OQ-15 | How does a background session get its `Specplane-Session` value? | A session id is deterministic per plan and step, and the adapter persists its own native id | `claude:architecture/claude-integration` § Claude session adapter |
