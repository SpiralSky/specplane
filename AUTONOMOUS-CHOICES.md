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

## 2026-10-29-cli-claude-harness-init (done, merged)
Full list: `plans/archive/2026-10-29-cli-claude-harness-init/HANDOFF.md`. Notable:
- Skill contracts now include a leak self-check (`spec-assist`, `spec-draft-architecture`, `validate`) and an ordering check (`plan-create`, `plan-step`). Without the CLI, `plan-create` and `validate` fall back to manual checks, but **`plan-finish` stops and asks the user to install the CLI** (it used to run the flow by hand).
- In the `plan-step` subagent branch, the parent does the push (step 10).
- `Harness` registry: `skillDirs(root)` returns repo-relative skill paths; an optional `rulesTemplate` field holds the bundled rules path. `UnknownHarnessError` lives in `harness/index.ts`.
- `--harness` installs only the named harness; detection runs only when the flag is absent.
- Unchanged files print `Skipped <path> (up to date)`. A `settings.json` with an unexpected structure is left untouched, the same as invalid JSON.
- A fresh `.claude/rules/specplane.md` counts as delivering the standing block, so AGENTS.md is then optional.
- The dogfood AGENTS.md Workflows line was refreshed by `init`.
- The pack test installs with `--prefer-offline`, so it needs the npm cache or network.

## 2026-10-29-cli-spec-search (done, merged)
Full list: `plans/archive/2026-10-29-cli-spec-search/HANDOFF.md`. Feature-spec proposals: `plans/archive/2026-10-29-cli-spec-search/feature-spec-proposals.md` (**needs review**). Notable:
- `spec new` without a TTY takes the title from the de-slugged slug, lowercases the slug, and writes the heading scaffold from file-formats §1.3/§1.4.
- `search` is a case-insensitive literal match, at most 3 snippets per file, and includes archived plans. Output is `<id>  <path>:<line>  <snippet>`; `--root` excludes plans.
- Leak guard: the bare-file-name rule uses a fixed extension list and skips `.md`. `Node.js` is not built in, so add it to `leak_guard_allow` if wanted. "JSON Schema" now warns twice in `feature/spec-policies` (lines ~180-182). The fix is to reword it or allow-list it; that's your call.
- The deprecated-reference warning has type `reference` (file-formats §1.5 has no row for it).
- The human `validate` report now goes to stderr; `--json` goes to stdout.
- Merge note: rebasing onto harness-init had one test-file conflict, resolved by keeping both sides.

## 2026-10-29-cli-plan-commands (done, merged)
Full list: `plans/archive/2026-10-29-cli-plan-commands/HANDOFF.md`. Proposals: `plans/archive/2026-10-29-cli-plan-commands/feature-spec-proposals.md` (**needs review**). Notable:
- Plan activity gains `backend` and `where`. `where` is `local` when a local branch exists, `remote` when only the `origin/` branch exists, and `none` otherwise.
- `review` is never derived without a forge (`hasOpenPr`). An abandoned dependency means `blocked` under `wait_for_merge`; under `stack` it is a validate error.
- `generate --live` requires `--print`, so live statuses never reach the committed PLANS.md. `generate --live` never fetches.
- `plan new` prompts only on a TTY; otherwise `--id`, `--title` and `--specs` are required. `steps/` is created empty; HANDOFF.md has the header only.
- `plan list` sorts by ID descending and prints `No plans.` when empty. `plan graph` prints the Mermaid block from PLANS.md without a fence. `plan show` prints the whole PLAN.md.
- Proposal: a stack-mode `ready` plan with 2+ unmerged dependencies shows as `blocked`. Plan-index Scenario 5 is split into 5 and 5a.

## 2026-10-29-cli-plan-flows (done, merged by its own `plan finish`)
Full list: `plans/archive/2026-10-29-cli-plan-flows/HANDOFF.md`. Proposals: `plans/archive/2026-10-29-cli-plan-flows/feature-spec-proposals.md` (**needs review**: adds `plan restack` to `feature/tooling`, latest-wins HANDOFF sections for re-run blocked steps, slash-free example paths in `feature/plan-steps`). Notable:
- `PlanStateError` now takes a full message, so the feature-spec texts can be used verbatim.
- Start: on a setup-hook failure only the worktree is removed; the branch and any claim commit stay, so a retry is a resume. The default branch tip is the local branch, or `origin/<default>` when the local one is strictly behind.
- Finish: the merge commit is a plain `Merge plan/<id>` with no trailers (§8.3 has no merge workflow). Without `--yes` and without a TTY it stops at "ready to merge" and exits 0. Untracked files don't count as uncommitted. `pull_request` without `origin` fails before any write. The forge call was a stub until `cli-forge-ci-publish`.
- Finish doesn't regenerate PLANS.md, which matches the spec (CI or a hook does). Locally a separate `generate` commit follows.
- Restack onto the default branch appends an empty "unstack" marker so a later finish doesn't rebase from a stale base. Restack needs the plan branch checked out and clean.
- Abandoning an abandoned plan skips the commit but still cleans up; abandoning a `done` plan fails. Cleanup of a branch that isn't `done` fails with no writes.
- Process note: one step-01 subagent briefly used `git commit --no-verify` and then amended with the hook active, so the final commit passed the hook. Later subagents were told never to do this.
- Process note: one subagent wrote its own model in `Co-Authored-By` (Sonnet 5.5) instead of the shared line.

## 2026-10-29-cli-forge-ci-publish (done, merged by `plan finish`)
Full list: `plans/archive/2026-10-29-cli-forge-ci-publish/HANDOFF.md`. Notable:
- Forge functions take a trailing `{cwd, forge}` argument. GitHub detection reads the raw `remote.origin.url` (`insteadOf` is ignored). Status queries treat forge errors as "no PR"; `createPR` errors propagate. The PR body (plan ID + acceptance criteria) is built before the archive move.
- CI: the generate workflow filters on `**/PLAN.md` plus `.specplane/config.yaml` and stages with `git add -A` after `specplane generate`, so it never names `plans/`. `.gitattributes` is `PLANS.md linguist-generated=true` with no merge attribute (the step criterion said "merge setting"; `architecture/ci` doesn't). `architecture/repository-layout` was aligned.
- `engines.node` is `>=20` (CI uses 20), but `architecture/reference-cli` still says `>=18`, and the test script's `dist/**` glob needs Node 21+ to *run tests*. Pick one and align the spec.
- The published package excludes test helpers. The publish workflow runs on `v*` tags with `--provenance` and `secrets.NPM_TOKEN`. It was never triggered, and `npm publish` was never run.

---

# Needs your decision (summary)
1. ~~**Licence**~~ Resolved 2026-10-29: the user chose Apache-2.0 (official text in `LICENSE`, `packages/cli/LICENSE`, `harnesses/claude/plugin/LICENSE`, plus `license` fields). The plugin still has no icon (a warning only).
2. **Publishing**: `repository.url` (the repo has no remote) and the `NPM_TOKEN` secret. Node version resolved 2026-10-29: `>=22` everywhere (`engines`, `@types/node`, CI, `architecture/reference-cli`, `architecture/ci`); Node 20 is end-of-life. `decision/0002` still records ≥ 18 as the original decision.
3. **Feature-spec proposals** (agents may not edit feature specs): `plans/archive/2026-10-29-cli-spec-search/feature-spec-proposals.md`, `…/2026-10-29-cli-plan-commands/feature-spec-proposals.md`, `…/2026-10-29-cli-plan-flows/feature-spec-proposals.md`. Applied 2026-10-29 with user approval (pasted verbatim; a2 as the `--kind` rename), and spec-search (d) Rule 6, which the user redirected to a per-plan `spec-gaps.md` record instead of HANDOFF.md. The CLI and architecture specs do not yet implement the applied changes (see HANDOFF.md next steps).
4. ~~**Leak-guard hits in feature specs**~~ Resolved 2026-10-29: reviewed with the user; all accepted and added to `leak_guard_allow`. The remaining 18 warnings are "may contradict" overlay heuristics (reviewed, fine) and 3 stale context references in archived plans; neither has a suppression mechanism.
5. **Behaviour changes worth a look**: `plan-finish` without the CLI now stops instead of running by hand (confirmed 2026-10-29; the leftover by-hand sentence was removed from the skill preconditions and `claude:architecture/claude-integration`); severities set to error for HANDOFF-section and step-numbering findings; a step criterion about `pin_bases: off` was overridden by the specs (stale pins always block approval).
