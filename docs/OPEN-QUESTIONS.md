# Open Questions

This document records design questions where a decision could not be made with certainty. Each open entry includes a proposed default (which the specs currently follow) and the alternatives considered.

Open questions should be resolved before the reference CLI implementation that depends on them. When a question is resolved, its entry moves to the "Resolved questions" table, pointing to where the decision is recorded (a spec section, or an ADR for decisions with significant trade-offs). Question IDs are permanent and are used by other specs.

---

### OQ-12: Where does step orchestration live?

Should the session-by-session loop (spawn a session per step, observe, run the next) live in each
harness or in the CLI?

- **Proposed default:** in the CLI as `specplane plan run`, with each harness supplying a
  spawn/observe adapter; per-harness loops are rejected as duplicated, untestable behaviour.
- **Alternatives:** harness-only conductor (fastest for Claude Code, locks the loop to one harness);
  external orchestrator only (fits `execution.backend: external`, but hooks and permissions differ).
- **Detail:** `docs/design/harness-orchestration.md`; likely needs an ADR.

See `docs/design/harness-orchestration.md`.

### OQ-13: Is auto-run opt-in or the default for `plan start`?

- **Proposed default:** opt-in (`plan start --run`). Without it, behaviour is unchanged: create the
  checkout and report the next step.
- **Alternative:** auto-run by default, with `--no-run` to opt out. Rejected for now because it spends
  quota and starts unattended work without an explicit request.

### OQ-14: Who owns the worktree when a harness runs a background session?

- **Proposed default:** Specplane owns it (`execution.backend: worktree`); the harness launches in
  that checkout (`--cwd`/cwd) and never passes Claude Code's `--worktree`, which would create a
  second worktree and make `claude rm` manage it.
- **Alternative:** let the harness own the worktree and set `execution.backend: external`, tracking
  only the branch. Larger contract change (start would no longer create the checkout).

### OQ-15: How does a background session get its `Specplane-Session` value?

- **Proposed default:** the harness passes a deterministic `--session-id <uuid>` derived from
  `<plan-id>/<step-number>`, making a restarted conductor idempotent and the commit trailer stable.
- **Alternatives:** inject `SPECPLANE_SESSION` through the settings env or the session-context hook;
  or have the session discover its own id from `claude agents --json` by cwd/name. The deterministic
  id is preferred because it needs no shared mutable state.

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
