# Open Questions

This document records design questions where a decision could not be made with certainty. Each open entry includes a proposed default (which the specs currently follow) and the alternatives considered.

Open questions should be resolved before the reference CLI implementation that depends on them. When a question is resolved, its entry moves to the "Resolved questions" table, pointing to where the decision is recorded (a spec section, or an ADR for decisions with significant trade-offs). Question IDs are permanent and are used by other specs.

---

_No open questions._

---

## Resolved questions

| ID | Question | Resolution | Where recorded |
|----|----------|------------|----------------|
| OQ-2 | Slash commands as skill files vs. bash aliases? | Project skills (`.claude/skills/<name>/SKILL.md`) | `claude:feature/claude-integration` § Slash commands; `claude:architecture/claude-integration` |
| OQ-3 | Subagents per step by default? | Off by default; per-step opt-in via `use_subagent: true`; fresh (non-fork) subagent | `claude:feature/claude-integration` § Subagents per step |
| OQ-4 | Which Claude Code hooks enabled by default? | Pre-commit validation only; others opt-in | `claude:feature/claude-integration` § Hooks |
| OQ-8 | Step file frontmatter? | Yes — `plan`, `step`, `title`, `status`, `context`, optional `use_subagent` | `feature/plan-steps` § Step frontmatter |
| OQ-11 | Worktree path collision across repos? | `<worktree_dir>/<repo-name>/<plan-id>/`, resolved against the main checkout | `feature/configuration` § `execution.worktree_dir`; `feature/plan-execution` |
| OQ-6 | Architecture-leak guard: heuristic vs. hard failure? | Warnings only; a human reviewer decides | `feature/spec-policies` §3 |
| OQ-7 | PLANS.md freshness: hard-fail or warn? | Warn only | `feature/plan-index` |
| OQ-9 | Forge integration scope in v1? | GitHub only (PR status for `review`, open PR in finish flow). Fully local use is supported via `plans.merge: local_merge` + `plans.forge: none` with worktrees | `feature/configuration`; `feature/plan-execution` |
| OQ-10 | `INFO.md` with frontmatter: error or warn? | Error (almost always a misnamed spec) | `feature/spec-system` |
| OQ-5 | Standard memory keys for Claude Code? | Recommended set (`specplane-active-plan`, `specplane-open-questions`, `specplane-spec-gaps`), not enforced; pending patch `docs/proposals/oq-5-memory-names.patch` | `claude:feature/claude-integration` § Memory integration |
| OQ-1 | Name of the framework? | Keep "Specplane" (npm name free as of 2026-10-29; alternatives checked were taken) | this table |
