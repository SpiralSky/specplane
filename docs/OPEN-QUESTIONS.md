# Open Questions

This document records design questions where a decision could not be made with certainty. Each open entry includes a proposed default (which the specs currently follow) and the alternatives considered.

Open questions should be resolved before the reference CLI implementation that depends on them. When a question is resolved, its entry moves to the "Resolved questions" table, pointing to where the decision is recorded (a spec section, or an ADR for decisions with significant trade-offs). Question IDs are permanent and are used by other specs.

---

## OQ-1: Name of the framework

**Question**: The framework name throughout the specs is "Specplane." Is this the final name?

**Proposed default**: Keep "Specplane."

**Alternatives**: Planspec, Speculo, Manifold, Blueprint, other.

**Why it matters**: The name determines the config directory (`.specplane/`), the CLI command name, and the npm package name (`specplane` vs. `@specplane/cli`). Renaming after implementation is possible but disruptive.

**Where it appears**: everywhere (config dir, CLI, README, all spec IDs).

---

## OQ-5: Standard memory keys for Claude Code

**Question**: Should Specplane define a standard set of memory key names for Claude Code's memory system (e.g. for recording the active plan, current step, open gaps)?

**Proposed default**: Define a recommended set in `claude:feature/claude-integration` but do not enforce or validate them. Memory is per-user and per-project; standardising names helps teams coordinate but should not be required.

**Alternative**: Leave memory entirely to the user's preference. Less prescriptive but less useful for teams.

**Related spec**: `claude:feature/claude-integration` § Memory integration.

---

## OQ-6: Architecture-leak guard — heuristic vs. hard failure

**Question**: Should any architecture-leak finding ever be a hard failure?

**Proposed default** (current spec): No. Heuristics and LLM review produce warnings only; a human reviewer decides. Noise is controlled with `specs.feature.leak_guard_allow` and per-spec `allow_architecture`.

**Alternative**: Certain high-confidence heuristics (e.g. a source-file path like `/src/components/Button.tsx` outside a code block) are hard failures. More reliable enforcement, but a false positive blocks a spec update entirely.

**Related spec**: `feature/spec-policies` §3.

---

## OQ-7: PLANS.md freshness enforcement

**Question**: Should `specplane validate` hard-fail if `PLANS.md` is stale, or only warn?

**Proposed default** (current spec): Warning only. Since `PLANS.md` is now deterministic (derived from committed plan files only), a stale file always means "regeneration was skipped", never a false alarm — so a hard failure would be reliable if wanted.

**Alternative**: Hard fail in CI, warn locally, via a `--ci` flag on `specplane validate` that escalates staleness to an error. Only sensible for teams using on-demand regeneration (Option B in `feature/plan-index`), since with CI regeneration main is fixed up after every push.

**Related spec**: `feature/plan-index`.

---

## OQ-9: Forge integration scope

**Question**: How much forge (GitHub, GitLab, etc.) integration should the first version support?

**Proposed default** (current spec): Minimal, selected by `plans.forge` (`auto | github | none`). The first version reads open PR status for the derived `review` status and opens a PR in the finish flow, for GitHub only. It does not create issues, post comments, or manage labels.

**Alternative**: No forge integration in v1. `review` is never derived, and the finish flow only pushes the branch. Simpler first implementation.

**Related spec**: `feature/plan-status`, `feature/plan-execution`, `feature/configuration`.

---

## OQ-10: `INFO.md` validation behaviour

**Question**: `INFO.md` files are free-form documentation and "never have spec frontmatter." Should validation error or warn if an `INFO.md` has frontmatter?

**Proposed default**: Error. An `INFO.md` with frontmatter is almost certainly a mistake (a spec file named incorrectly). Message: "`.../INFO.md` has frontmatter but INFO.md is reserved for free-form documentation. Rename the file to use it as a spec."

**Alternative**: Warning only. More permissive.

**Related spec**: `feature/spec-system`.

---

## Resolved questions

| ID | Question | Resolution | Where recorded |
|----|----------|------------|----------------|
| OQ-2 | Slash commands as skill files vs. bash aliases? | Project skills (`.claude/skills/<name>/SKILL.md`) | `claude:feature/claude-integration` § Slash commands; `claude:architecture/claude-integration` |
| OQ-3 | Subagents per step by default? | Off by default; per-step opt-in via `use_subagent: true`; fresh (non-fork) subagent | `claude:feature/claude-integration` § Subagents per step |
| OQ-4 | Which Claude Code hooks enabled by default? | Pre-commit validation only; others opt-in | `claude:feature/claude-integration` § Hooks |
| OQ-8 | Step file frontmatter? | Yes — `plan`, `step`, `title`, `status`, `context`, optional `use_subagent` | `feature/plan-steps` § Step frontmatter |
| OQ-11 | Worktree path collision across repos? | `<worktree_dir>/<repo-name>/<plan-id>/`, resolved against the main checkout | `feature/configuration` § `execution.worktree_dir`; `feature/plan-execution` |
