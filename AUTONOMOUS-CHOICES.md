# Autonomous choices report

The user asked for the repo to be completed without interruption (2026-10-29). Every judgement call made without user input is listed here so it can be revisited. Per-step detail lives in each plan's `HANDOFF.md` (items prefixed `CHOICE:`).

## Process
- Plans were set to `ready` and step/finish flows were run by subagents (one per step); the main session acted as the confirming human for `local_merge`.
- Feature specs (`llm_role: assist`) were never edited. Feature-spec findings became `feature-spec-proposals.md` files in the relevant plan folders, for user review.

## Plan creation
- No ADR commands are planned; no spec defines any.
- `plan restack` is not in `feature/tooling`: it is a feature-spec proposal, documented meanwhile in the architecture spec.
- Proposal-only findings are not implemented (e.g. `worktree_dir`-inside-repo and bad `spec_roots` errors).
- Sequencing: `cli-plan-commands` depends on `cli-spec-search`; `cli-plan-flows` on `cli-plan-commands`; `cli-forge-ci-publish` on `cli-plan-flows`; `cli-claude-harness-init` only on core; `claude-plugin-hardening` on nothing.
- `git/commit.ts` lives in `cli-plan-commands`, not `cli-plan-flows`.
- `specplane-publish.yml` is committed but never triggered; `npm publish` is not run.

## 2026-10-28-reference-cli-core (done, merged)
All 32 `CHOICE:` items are in `plans/archive/2026-10-28-reference-cli-core/HANDOFF.md`. The ones most worth a look:
- Node `>=22`; tests run as `node --test "dist/**/*.test.js"`; tests are co-located `*.test.ts`.
- Severities left open by the specs were set to **error** for HANDOFF-section and step-numbering findings.
- Leak guard: config enum values (`local_merge`, `in_progress`, …) are on the built-in allow list; `Go`/`Express` match case-sensitively. The overlay "may contradict" heuristic treats 4+ letter words minus a stop list as nouns.
- A dependency missing from the plan set counts as not done (plan shows `blocked`).
- `init` writes `merge: pull_request` (schema default) and skips a malformed AGENTS.md block.
- `spec pin` merges into existing `based_on` and writes it as a one-line flow map; a base with uncommitted edits is compared by working-tree hash; an approved spec with a stale pin gets both the warning and the error.
- `skillDirs` stand-in checks `.claude/skills` and `harnesses/claude/templates/skills` (replaced in `cli-claude-harness-init`).
- **Step criterion overridden by specs**: step 05 said an approved stale spec should not error under `pin_bases: off`; `feature/spec-overlays`, `feature/configuration` and `architecture/reference-cli` say stale pins always block approval. The specs were followed.
- Main session fix after merge: `build` now marks `dist/cli.js` executable (a linked global install failed with EACCES).
- Main session fix: three step files written during plan creation had unquoted `spec:` anchors containing `: `, which broke YAML; they were quoted.

## 2026-10-29-claude-plugin-hardening (done, merged)
- Gating hooks fail open: each `on('tool.call', …)` registration has a `.catch` that logs and calls `next(e)`. An inner `gateDenial` try/catch is kept as well.
- Failures go to `console.error` through an exported, replaceable `failureLog.write` sink (no plugin logging API is documented).
- Non-interactive sessions (`isInteractive` false on `session.start`), or a `$.prompt.fill` that throws, get a "Copy HANDOFF path" button that uses `$.ui.copy`. A sentence was added to the Plans pane text in `claude:architecture/claude-integration`.
- **Left for the user**: no LICENSE file or `license` in `plugin.json` (the directory refuses a submission for this, `LICENSE_MISSING`), and no icon. A licence is a legal choice, so none was picked.
