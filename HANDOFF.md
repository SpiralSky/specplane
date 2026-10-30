# Session handoff

> **Standing instruction from the user (2026-10-29)**: read this file and continue the work. When you finish a milestone, rewrite this file (goal, decisions, current state, next steps, and this instruction) and tell the user. The user then starts a new session. Repeat until the project is complete.
>
> **Standing instruction (2026-10-29, later)**: the agent decides open questions itself and verifies them at the plan merge (`/plan-finish`) instead of pausing mid-plan. After the last plan is done, the user will do a full review of the codebase and of the workflow as a whole and make final amendments then; the general structure is to be treated as solid until that review.
>
> **Standing instruction (2026-10-30)**: the user asked for every remaining review item to be resolved and committed with reasoning. That pass is done; see "Resolved this session". Feature specs (`llm_role: assist`) were still not edited ad hoc — amendments that need feature-spec text are listed under "Next steps" for user approval. The user is still driving the review.

## Goal
Build Specplane, a spec and plan management framework, in this repo: specs → plans → reference CLI → Claude harness (`init --harness claude`).

The build-out is complete and merged (11 plans, 20 approved specs). The remaining work is the user's review, a few user-only release decisions, and one recorded design question.

## Current state (2026-10-30, after the resolution pass)
- `main` is clean; `plans/` contains `archive/` and the generated `PLANS.md` ("Active plans: _None._"). No worktree, no plan branch, no remote.
- **All 20 specs are `approved`.** ADRs: 0001 accepted, 0002 superseded by 0004, 0003 accepted, 0004 accepted.
- Green: `validate` **0 errors / 17 warnings** (all reviewed `claude` overlay heuristics), `spec pin --check` clean, `npm test` **256/256**, `check-sync.sh` OK, `hooks.test.sh` 73/73.
- `architecture/agent-skills` is now pinned to `feature/agent-integration` (blob `9e3a0cf`); its 22 skill contract pins were refreshed to blob `396f26e`.

## Resolved this session (commits on `main`)
- `4d69392` — archived plan `context` references that no longer resolved: the pre-archive `PLAN.md` path and two headings removed when the harness was redesigned (`#AGENTS.md`, `#CLAUDE.md structure`). This removed the only 3 non-overlay validate warnings.
- `23dc1af` — committed the prepared `based_on` pin for `architecture/agent-skills` (`implements: feature/agent-integration`, opt-in under the default `pin_bases: warn`).
- `37de49f` — refreshed the 22 skill contract pins (11 skills × project + harness template) to the new committed blob.
- `71e9eee` — `search` now follows `architecture/reference-cli`: one block per file, 3 snippets maximum, JSON `{id, kind, path, root, status, matches: [{line, text}]}`, `PLAN.md` + step files only (not `HANDOFF.md`), step files labelled `<plan> (step <NN-slug>)`. Tests rewritten; 256/256.
- `099bf88` — closed the assist-and-approve gaps G1–G3: G1/G2 were already specified in the architecture spec and are now `applied`; G3's defensive `decision new` check is now stated in `architecture/reference-cli`.
- `98cde6c` — removed stale "pending" markers: OQ-5 cited a patch deleted in `d188bb9`, and three archived proposal files contradicted their own "Applied" header.

## Decisions worth knowing
- **Search precedence**: the architecture spec wins over the archived plan's step-06 acceptance criteria (which had asked for the flat `--type` shape). The new JSON shape is a pre-release contract change; nothing else consumes it.
- **Skill-pin churn (open design question)**: `normalisedHash` ignores only `status`/`author`, so a spec's own `based_on` line changes its blob and invalidates every skill anchored to it. That is why the pin needed 22 mechanical edits. See Next steps 2.
- **17 overlay warnings are accepted**: `OQ-6` decided warnings only, and the pairs are heuristic false positives (unrelated sentences that share a noun). There is no suppression mechanism; adding one would be a feature change.

## Next steps (user)
1. **Publishing (user-only)**: add the remote, set `repository.url` in `packages/cli/package.json`, add the `NPM_TOKEN` secret, then push a `v*` tag. The workflow (`.github/workflows/specplane-publish.yml`) exists but has never run. README is accurate today ("nothing is published to npm yet").
2. **Decide the skill-pin normalisation** (recommended fix, needs a plan): ignore `based_on` in `normalisedHash` and/or hash only the anchored section, so spec metadata and unrelated sections stop churning all 22 pins. It changes user-visible `base-changed`/`skill-drift` behaviour, so it needs `feature/spec-overlays` (assist), `architecture/file-formats` §1.6, and `architecture/agent-skills` edits plus a `pins.test.ts` update.
3. **Optional feature-spec enrichment (assist)**: `feature/tooling` § `specplane search` still says only "list of matching files with a snippet" while `architecture/reference-cli` now defines the block and JSON shape. Approval would let the user-visible contract be stated at the feature level.
4. **Plugin icon**: still absent (warning-level for a marketplace submission). The licence was resolved as Apache-2.0.
5. **Cosmetic**: validating inside a plan worktree without `.claude/settings.local.json` reports one extra warning (17 → 18). The main checkout is the reference.

## Open items
- No open `spec-gaps.md` entries, no open questions in `docs/OPEN-QUESTIONS.md`, no active plans.
- The publish flow and the skill-pin design question above are the only substantive outstanding work.
