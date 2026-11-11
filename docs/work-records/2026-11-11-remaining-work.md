# Remaining implementation work (2026-11-11)

Inventory of what the reference CLI and the harness integrations still need to meet the specs, and an ordered backlog to get there. Authority: `docs/requirements/product-requirements.md` > `docs/specifications/features/*` > `docs/specifications/architecture/*` and `harnesses/*/specifications/architecture/*`. Method: code reading and grep over `packages/cli/src`, `harnesses/`, `.claude/`; `npm run build` (passes); `node dist/cli.js --help` and subcommand help; `specplane validate --json` on this repo (0 errors; 24 plan, 4 cite and 1 notes warnings); `specplane spec list` (broken, see below). Tests were not run. No approve or plan workflow was run.

## Summary

The new reading path (frontmatter, sections, cites, requirements, fingerprints, effective status), the notes store (approve, reopen, override, sync, migrate), configuration get/set, the permission engine and documentation, requests, and the plan record and plan commands exist and follow the specs closely. Missing outright: the test runner and declarations, the warnings collector, auto-warn and coverage, the audit reader and retention, steering generation, instruction delivery, command contracts, the harness action registry and the new MCP server, the user-command runner, `isSpecplaneCommand`, the new harness installer, and the generated user/AI documentation. The whole old operation engine (`core/*`, `legacy-plan/`, `legacy-config.ts`, `generate/`, `harness/claude-mcp*`, the old plugin commands and the `specplane-reason-*` skills) is still compiled and partly registered, and `spec list` / `spec show` / `spec new` / `spec complete` / `spec implementation` / `search` / `workflow` / `decision` still run through it. `spec list` currently fails on every spec (`missing required field status; missing required field author`) because it uses the old parser.

## Status by section

Legend: **built** (matches the spec, small gaps at most), **partial**, **missing**, **legacy** (exists in the old model and must be replaced or removed).

### `architecture/reference-cli`

| Section | Status | Where / what is missing |
|---|---|---|
| §1 Technology | partial | Node/TS/commander done. Still on `js-yaml` + `gray-matter` (spec: `yaml` round-trip library); requests use structural validation, not `ajv`; no single injectable clock (`now` options only); no `clock.ts`. |
| §2 Module structure | partial | New modules in `spec/`, `perm/`, `requests/`, `plan/`, `audit/`, `repo/`, `verify/`. Missing `verify/rules/*`, `verify/warnings.ts`, `coverage.ts`, `tests.ts`, `harness/actions.ts` etc., `output/text.ts`, `clock.ts`. `harness/`, `output/`, `core/`, `legacy-plan/`, `generate/`, `decisions/`, `agents/` are legacy. New commands still import `core/checkout-coordination.ts` (writer lease) and `docs/bundle.ts` imports `core/contained-files.ts`. |
| §3.1 Roots | built | `git/repo.ts` `checkoutRoot`, `mainRoot`; `NotARepoError` exists but exit code 3 not used. |
| §3.2 Configuration | partial | `config.ts`, `config-edit.ts`, `config-ops.ts`. Reads the **working tree**, not `HEAD:.specplane/config.yaml`; no "differs from HEAD" warning; side effects (hook install, steering regeneration) only print a note. |
| §3.3 Local store | partial | `repo/store.ts`, `plan/ctx.ts` (`readStore`/`writeStore`). `sessions/`, `tmp/`, `logs/` unused; plan code writes the store directly instead of only through `repo/store.ts`. |
| §4.1–§4.5 Parsing, cites, requirements, snapshot | built | `spec/frontmatter.ts`, `sections.ts`, `cites.ts`, `requirements.ts`, `project.ts`, `source.ts`. Gap: §4.2 Test-line collection (`Test T<n> (...)`) and duplicate-label error are not in `sections.ts`. |
| §5.1 Fingerprints | built | `spec/fingerprint.ts`, `plan/status.ts`. |
| §5.2 Effective status | built | `spec/status.ts`, `spec/notes.ts` (`NotesView`). |
| §5.3 Approval | built | `spec/human.ts` `approveSpecs`, `--ref`, groups, request-user creates a request. |
| §5.4 Review state / reopen | built | `reopenSpec`. |
| §5.5 Notes store | built | `spec/notes.ts`. |
| §5.6 Sync | built | `spec/sync.ts`, `specplane sync`, `init` sets refspecs. |
| §5.7 Migration | built | `spec/migrate.ts`, `migrate status`. |
| §6.1 Validation engine | partial | `verify/validate.ts` (one file; families spec-format, cites, requirements, status, notes, config, plans via `plan/validate.ts`). Missing families: `tests`, `permissions`, `harness`; no rule registry; `warnings.report` channel missing. |
| §6.2 Rule details | partial | Plan cycles, cover/implements placement, legacy keys done. Missing: credential heuristic on result summaries; `implementation` record for non-architecture spec warning (unverified). |
| §6.3 Warnings collector, auto-warn | missing | No `warnings` command, no collector, no auto-warn line, despite `auto_warn` setting. |
| §6.4 Coverage | missing | No `coverage` command or module; `coverage.requirement_only` is parsed only. |
| §7.1 Role choice | partial | `perm/permissions.ts` `cliRole`, `role.json`, `switchRole`. `Actor` lacks `session`; no harness front end yet. |
| §7.2 Catalog, presets | built | `perm/permissions.ts`, `perm/catalog.ts`. Adds `plan.step`, which the spec catalog lacks (see contradictions). |
| §7.3 Guard | partial | `guard()` and `Authorized` exist, but reads are not guarded by `info.retrieve` consistently and `Authorized` is not required by every mutating core function (plan code uses `plan/ctx.ts` wrappers). |
| §7.4 Documentation | partial | `specplane permissions [<id>]` (`perm/docs.ts`). Steering text not shown (no generator); preset table test T1 exists (`perm/permissions.test.ts`). |
| §8 Requests | partial | `requests/store.ts`, `hold.ts`, `actions.ts`, `ops.ts`, `commands/requests.ts`. Missing: recorded checkout and accept-in-plan-worktree (refuse when worktree gone); `ajv`; `notify` adapter and dialogue (harness side). |
| §9 Audit | partial | `audit/log.ts` append from guard/commands. Missing: `specplane audit` reader, retention + `audit prune` entry + lock, runner entry for every command (reads included), `cancelled` on interrupt, failure flag into warnings. |
| §10.1 Declarations | missing | No Test-line reader or `specplane-test` block parser. |
| §10.2 Running | missing | No `test run`, no temp worktree runner. |
| §10.3 Recording | partial | Notes record kind `test-result` and `override test` exist (`spec/human.ts`, `spec/results.ts`); no `tests.record` core function with request-user/deny flows; no credential warning. |
| §10.4 Implementation | partial / legacy | `spec/implementation.ts` (`recordImplementation`, state) reached only through legacy `spec complete` / `spec implementation` → `core/index.ts executeOperation` → `core/completion-writer.ts`. No `spec implement` command, no test run, no intelligent-verdict check, no `architecture.llm_may_mark_implemented` check. |
| §10.5 Logs | missing | `tests.logs` settings parsed only. |
| §11.1 Plan parse/validate | built | `plan/model.ts`, `plan/validate.ts`. |
| §11.2 Status, next | built | `plan/status.ts`. |
| §11.3 Start/stop/resume/step-done | built (CLI side) | `plan/run.ts`. Run marker kept only by `plan heartbeat` (no adapter); "hard stop on stale marker after budget hard stop" not implemented. |
| §11.4 Budgets | partial | `plan/budget.ts`, `plan usage`; measurability from env var; no adapter measures usage or ends a session. |
| §11.5 Create/edit | partial | `plan/create.ts` (`plan create`); no `plan.edit` operation, no refusal to edit started steps. |
| §11.6 Review/finish/merge | built | `plan/finish.ts`; `--pr` untested against a real remote. |
| §11.7 Abandon/delete | built | `plan/finish.ts`. |
| §12.1 Actions + MCP channel | missing / legacy | No `harness/actions.ts`. Existing MCP server `harness/claude-mcp.ts` + `claude-mcp-main.ts` is the old workflow conductor (bind/prepare/record tools), declared by `harnesses/claude/plugin/.claude-plugin/plugin.json`. |
| §12.2 User commands | missing / legacy | No `specplane harness run`. Old native-command dispatch in `harnesses/claude/plugin/hooks/commands.ts`, `handlers.ts`, `register.tsx`. |
| §12.3 Instruction delivery | missing | No `instructions.ts`, no `sessions/` epoch files. |
| §12.4 Steering | missing | No `assets/steering/`, `steering.ts`, stamp, `specplane steering`. |
| §12.5 Retrieval, docs | partial / legacy | `docs/bundle.ts`, `docs/operations.ts`, `specplane docs`, `docs search` exist over hand-written `assets/docs/`. No `docs/user/` source, no `build-docs`/`build-ai-docs`, no required-topics test. No `spec.retrieve`. |
| §12.6 Setup, staleness | legacy | `commands/init.ts` uses `legacy-config`, `harness/index.ts`, `containment*.ts`, `agents/standing.ts`, `docs/freshness.ts`; no `capabilities()`; no `harness` validation family. |
| §12.7 CLI block | missing | No `isSpecplaneCommand`; no `specplane-cli-block.sh`. |
| §13.1 Command list | partial | Present: `validate`, `spec approve/reopen/meta/override`, `migrate status`, `sync`, `config`, `permissions`, `role`, `requests`, `plan ...`, `docs`. Missing: `warnings`, `coverage`, `spec implement`, `test run`, `steering`, `audit`, `check` (later), `init --harness` rewrite. Legacy extras to remove: `spec new/list/show/validate/complete/implementation`, `search`, `decision`, `workflow`, `plan approve` (spec: approval of PLAN.md is `spec approve`), `plan heartbeat`/`usage` become adapter-internal. |
| §13.2 Metadata | built | `spec/human.ts` `metaGet`/`metaSet`/`overrideSpec`. |
| §13.3 Output, errors | partial | Ad hoc printing per command; no common `{ok,data,findings,warnings}`; exit codes 2/3/4 unused; `--dry-run` not general. |
| §13.4 What is committed | built | Notes commits and branch commits as specified. |
| §14.1 CI | partial | `validate --json` works; recipe not in user docs. |
| §14.2 Pre-commit (later release) | missing | Settings parsed only. |
| §15 Later releases | n/a | Old `decisions/`, `commands/decision.ts`, overlays code are legacy, not the later-release design. |

### `architecture/agent-skills`

| Section | Status | Notes |
|---|---|---|
| §1 Contract structure | missing | No `assets/commands/<command>.md`. Current skills are `specplane-reason-*` written for the old engine. |
| §2 Standing instructions | partial / legacy | `.claude/rules/specplane.md` and template exist but describe the old model (mention `llm_role`, CLI use, `spec_roots`); no version/stamp. Codex block generated by `agents/standing.ts` (old text). |
| §3 Instruction assembly | missing | |
| §4 Steering | missing | |
| §5 Requests/soft stop in contracts | missing | Core side exists (`requests/hold.ts`, blocking requests). |
| §6 Retrieval | missing | `spec.retrieve`, `spec.review-context`. |
| §7.1–§7.10 Contracts | missing | |
| §8 Keeping LLM off CLI | missing | |
| §9 Contracts in step | missing | Version headers, validation warning. |

### `architecture/repository-layout`

§1 partial (`docs/user/` absent); §2 partial (as reference-cli §3.3); §3 built (`plan/run.ts` `worktreePathFor`, `outpath` kind); §4 built (nothing generated is tracked; old `generate` command removed from CLI routing but code remains); §5 legacy (installer is old); §6 partial (plan ID length checked; case-collision and symlink rules not verified); §7 mostly built.

### `architecture/claude-integration` (harnesses/claude)

| Section | Status | Notes |
|---|---|---|
| §1 Files produced | legacy | Templates still ship `specplane-policy-guard.sh`, `specplane-generate.sh`, `specplane-handoff-check.sh` (to remove) and `specplane-reason-*` skills (should be `specplane-<command>`); no version headers. |
| §2 Standing instructions | legacy | Rules file text is the old one. |
| §3 Command skills | missing | |
| §4 Hooks | partial | `specplane-session-context.sh`, `specplane-pre-commit.sh`, `specplane-statusline.sh` exist (old behaviour); `specplane-cli-block.sh` and `specplane-compact.sh` missing. |
| §5 Settings merge | partial / legacy | In `harness/claude.ts` (old installer); verify against the six rules when moved. |
| §6 Subagent step execution | missing | Contract text. |
| §7 Worktree/cloud sessions | partial / legacy | `harnesses/claude/plugin/hooks/session-adapter.ts` (`claude -p` route) exists for the old engine. |
| §8 Memory | missing | Contract text only. |
| §9 Testing | partial | `hooks.test.sh`, `check-sync.sh` exist for old hooks; T2 missing. |
| §10 Action channel | legacy | Plugin declares the old MCP server. |

### `architecture/codex-integration` (harnesses/codex)

§1 legacy (`harnesses/codex/templates/skills/specplane/` has `SKILL.md`, `references/shared-procedure.md`, `scripts/workflow.mjs`, contracts dir holds only `codex-integration.md`); §2 legacy (block from `agents/standing.ts`); §3 missing (no contracts, no MCP registration, no capabilities); §4 missing; §5 missing; §6 missing; §7 partial (`harness/codex*.test.ts` test the old installer).

## Contradictions and gaps found

Specs against each other:

1. **Config read point.** `reference-cli §3.2` reads `.specplane/config.yaml` at `HEAD` ("an uncommitted change is ignored"); `reference-cli §13.4` says "Configuration is read from the working tree (§3.2), so it takes effect at once". `§3.2` matches `R40` and `file-formats §6.2`; fix `§13.4`. Code currently follows `§13.4`.
2. **Plan status on create.** `reference-cli §11.5` says `plan.create` writes PLAN.md "with `status: awaiting-review`"; `file-formats §5.2` ("A plan has no stored status or approval") and `agent-skills §7.3` ("no status") say none. Code writes none. Fix `§11.5`.
3. **Step-done permission.** `reference-cli §11.3` and `file-formats §7.1` give `plan step-done` no permission; `R50` says a new command brings its own permission. Code added `plan.step` (allow everywhere). Add it to `file-formats §7.1/§7.2` or drop it from code.
4. **Reading documentation needs a permission?** `reference-cli §7.3` guards every read-only operation by `info.retrieve`; `reference-cli §13.1` and `file-formats §13.1` list `permissions`, `steering`, `docs` as needing none. Code follows "none". Make `§7.3` name these exceptions.
5. **Stale text in `reference-cli §5.3`.** "Pending the requests step: the reference build only refuses under `request-user`" is obsolete; requests exist and approve sends one.
6. **Codex MCP registration.** `codex-integration §3` says the MCP server is "registered in Codex's configuration"; `codex-integration §1` says "Setup never writes Codex configuration". Either the user registers it by hand (document it, and `capabilities()` reports the channel missing until registered) or setup may add the one MCP entry. Needs a spec decision before the Codex unit.
7. **Standing text uniformity.** `agent-skills §2` says the standing text is "the same for every harness" and has no procedures; `claude-integration §2` adds a list of slash commands. Minor; state that the command list is invocation detail.

Requirements without feature coverage: `R62`, `R62.1`–`R62.5` (non-goals) and `R63` (unwanted outcomes) appear in no feature spec's `covers` and are not cited anywhere. `reference-cli §6.4` says nothing is exempt, so coverage will warn on them. Either cover them in a feature spec (e.g. `roles-and-permissions` for `R62.1`, `R62.4`, `R63`; `plan-execution` for `R62.5`; `later-releases` for `R62.3`) or list them in `coverage.requirement_only` in `.specplane/config.yaml`. Retired IDs `R3`, `R6`, `R8`, `R15`, `R41`, `R45`, `R53` are correctly unused.

Not contradictions but open: the page flaw about sub-requirement order (`R27.5` before `R27.4`, `R27.1.1` before `R27.2`) reported in `HANDOFF.md` is still unanswered. The harness feature/architecture specs under `harnesses/*/specifications` are subprojects and are not read by `validate` (later release), so their cites are unchecked.

## Implementation units

Each unit is sized for one subagent session and under about 1,000 changed lines of new or edited code; pure deletions are listed separately and do not count toward that budget. "Accept" lists the checks the unit must add or pass; every unit also runs `npm run build`, `sh scripts/test.sh` (or the touched suites) and `node dist/cli.js validate` on this repo.

### U0 Spec corrections

- **Status:** done. Contradictions 1-7 fixed in the specs. Decisions: 3 `plan.step` is dropped (no page or feature spec justifies a separate step permission; code must remove it); 6 setup writes exactly the one MCP registration entry into Codex config. R62 and R63 stay requirement-only (scope and non-goals), so no feature spec covers them; the unit that touches `.specplane/config.yaml` should list them in `coverage.requirement_only` if coverage warns.
- **Goal:** fix contradictions 1–5 and 7 in the specs, and record the R62/R63 decision (cover in feature specs or add to `coverage.requirement_only`). Contradiction 6 is settled here too (recommended: setup prints the one-line MCP registration and `capabilities()` reports the channel missing until it is present; setup still writes no Codex config).
- **Specs:** `reference-cli §3.2`, `§5.3`, `§7.3`, `§11.3`, `§11.5`, `§13.4`; `file-formats §7.1`, `§7.2`; `codex-integration §1`, `§3`; `agent-skills §2`; possibly `.specplane/config.yaml`.
- **Depends:** none. **Accept:** `validate` 0 errors; one separate-agent review of the change set (`spec-review-policy`). **Deletes:** none.

### U1 Command runner, output and audit

- **Status:** done. One commit (runner, audit reader and retention, clock, exit codes, `audit`). Deferred: old `output/human.ts` stays for legacy callers until U12; auto-warn line and `Actor.session` belong to U4/U2; legacy commands (`spec list`, `search`, `decision`, ...) are not on the runner yet.
- **Goal:** one command runner that returns `{ok,data,findings,warnings}`, prints text or JSON, maps errors to exit codes 0–4, writes the runner audit entry for every command (reads included, `cancelled` on SIGINT), runs audit retention at start with the `audit prune` entry and lock file, and adds `specplane audit [--since] [--branch] [--actor] [--json]`. Introduce `clock.ts` (injectable time and random).
- **Specs:** `reference-cli §1` (clock, output), `§9`, `§13.3`; `file-formats §10`.
- **Files:** new `output/text.ts`, `output/json.ts` (rewrite), `commands/runner.ts`, `audit/retention.ts`, `commands/audit.ts`, `clock.ts`; edit `audit/log.ts`, `errors.ts`, `cli.ts`, the new command files (`commands/config.ts`, `requests.ts`, `spec-human.ts`, `plan-cli.ts`, `validate.ts`) to return results.
- **Depends:** none. **Accept:** tests for retention (entries older than N dropped, `forever` keeps, concurrent append kept), exit codes per error class, audit entry for a read command, JSON shape.
- **Deletes:** old `output/human.ts` once no new command uses it (legacy callers keep it until U12).

### U2 Configuration from HEAD and roots

- **Status:** done. Config read from `HEAD` (`config-source.ts`, `loadSettings`, `activePreset`) with a differs-from-HEAD warning; `Config.abs` holds checked absolute folders; `Actor.session` and `cliActor`; `config set` effects go through `config-effects.ts` (stubs until U9/U19). Deferred: core readers still use the relative `paths.*` strings rather than `abs`.
- **Goal:** load config from `git show HEAD:.specplane/config.yaml`; warn when the working tree differs; resolve and check `paths.*`/`plans.dir` once; pass one `Config` down; `config set` side effects call hooks (stub until U17/U9 provide them); `Actor.session`; `NotARepoError` → exit 3; `docs`/`--help` work outside a repo.
- **Specs:** `reference-cli §3.1`, `§3.2`, `§7.1`; `file-formats §6.2`, `§7.3`.
- **Files:** `config.ts`, `config-ops.ts`, `spec/paths.ts`, `perm/permissions.ts`, `verify/validate.ts`.
- **Depends:** U0 (contradiction 1), U1. **Accept:** fixture repo: uncommitted preset change ignored with warning; committed change applies on next command; missing file at HEAD → defaults.
- **Deletes:** none.

### U3 Rule registry, warnings, auto-warn and coverage

- **Goal:** move `verify/validate.ts` into `verify/rules/*` families with `{id,severity,source,run}`; add the `permissions` family (`§7.4`); add `verify/warnings.ts` (rule warnings plus audit-unwritable, stale steering/harness placeholders), `specplane warnings [<id>]`, auto-warn line / JSON `warnings` field in the U1 runner, `verify/coverage.ts` and `specplane coverage [--uncovered]` with `requirement_only` annotation.
- **Specs:** `reference-cli §6.1`, `§6.3`, `§6.4`; `verification R24`, `R24.1`, `R64`.
- **Files:** `verify/validate.ts` → `verify/rules/{spec-format,cites,requirements,status,notes,config,plans,permissions}.ts`, `verify/warnings.ts`, `verify/coverage.ts`, `commands/warnings.ts`, `commands/coverage.ts`, `cli.ts`.
- **Depends:** U1. **Accept:** existing `verify/validate.test.ts` passes unchanged in substance; coverage tests (uncovered requirement warned, `requirement_only` annotated but still counted, absent layer skipped, several coverers shown); auto-warn line present and collector failure prints `warnings unavailable`.
- **Deletes:** `report.ts` usage from validate (file goes in U12).

### U4 Spec list and show on the new model

- **Goal:** `spec list` and `spec show <id>` print effective status, reasons, authors, current results and implementation from the notes store; `spec validate` becomes an alias of `validate` or is dropped; `spec new` is removed (spec content is edited in an editor, `§13.1`).
- **Specs:** `reference-cli §13.1`, `§5.2`, `§10.3`, `§10.4`.
- **Files:** new `commands/spec-read.ts`; `cli.ts` registration.
- **Depends:** U1. **Accept:** `spec list` on this repo lists all 15 specs without errors; JSON output test.
- **Deletes:** registration of `spec new/list/show/validate` from `commands/spec.ts` (the file stays for legacy importers until U12).

### U5 Test declarations and runner

- **Goal:** collect `Test T<n> (deterministic|intelligent):` lines per section and preamble (duplicate label is an error); parse `specplane-test` blocks; effective declaration with inheritance; `specplane test run [<id>[#section]] [--all] [--timeout]` in a temporary detached worktree under `<store>/tmp/`, argv without shell, clean env plus `SPECPLANE_TEST=1`, `expect` keys; logs per `tests.logs` with retention; `tests` validation family.
- **Specs:** `reference-cli §4.2` (Test lines), `§10.1`, `§10.2`, `§10.5`, `§14.1`; `file-formats §11.2`, `§11.4`; `verification R36.1`, `R36.2`, `R61.4`.
- **Files:** `spec/sections.ts`, new `verify/tests.ts`, `verify/logs.ts`, `verify/rules/tests.ts`, `commands/test.ts`.
- **Depends:** U1, U3. **Accept:** fixture specs with passing, failing, no-definition and intelligent tests; dirty tree note; timeout; temp worktree removed on failure; `tests.logs: git` warning.
- **Deletes:** none.

### U6 Test recording and `spec implement`

- **Goal:** `tests.record` core function (allow writes a `test-result` note; request-user stores the request with fingerprints and re-checks on accept; deny shows "not recorded"; credential heuristic warning); `specplane spec implement <id>` running all deterministic tests, requiring current intelligent verdicts (`needs harness` from CLI), refusing on current `failed`, honouring `architecture.llm_may_mark_implemented` for `llm`.
- **Specs:** `reference-cli §10.3`, `§10.4`, `§6.2` (credential heuristic); `verification R36`, `R36.1`, `R61.1`–`R61.3`.
- **Files:** `verify/tests.ts` (record), `verify/implementation.ts` (move from `spec/implementation.ts`), `requests/actions.ts` (record action), `commands/spec-implement.ts`, `cli.ts`.
- **Depends:** U5. **Accept:** recorded result current/outdated after content change; request accept with changed HEAD records nothing; implement refused on failure and on missing intelligent verdict; LLM refused when the setting is off.
- **Deletes:** CLI `spec complete` and `spec implementation`, `spec/completion.ts`, `core/completion-writer.ts`, `core/completion.ts` (and their tests), the `spec.complete`/`spec.implementation` operations in `core/index.ts`.

### U7 Requests in plan worktrees and plan edit

- **Goal:** request records carry the plan checkout; `accept` runs in the plan's worktree from any checkout and refuses (stays pending) when the worktree is gone; `plan.edit` operation that refuses edits to started steps and commits `docs(<slug>): edit plan`; stale-marker hard stop after a logged budget hard stop; route plan store writes through `repo/store.ts`; `ajv` schema for request records.
- **Specs:** `reference-cli §8`, `§11.3`, `§11.5`, `§3.3`; `file-formats §9.2`.
- **Files:** `requests/store.ts`, `requests/ops.ts`, `requests/hold.ts`, `plan/create.ts`, `plan/run.ts`, `plan/ctx.ts`, `repo/store.ts`, `commands/plan-cli.ts`.
- **Depends:** U0 (contradictions 2, 3), U1. **Accept:** accept from main checkout applies a spec-edit patch in the plan worktree; removed worktree refuses; plan edit of a started step refused.
- **Deletes:** none.

### U8 YAML library switch

- **Goal:** replace `js-yaml` and `gray-matter` with `yaml` (eemeli) using the document API for round-trip edits; fold `spec/fm-edit.ts` and `config-edit.ts` textual editors onto it; `ajv` for the config schema.
- **Specs:** `reference-cli §1`, `§4.1`, `§3.2`.
- **Files:** `spec/frontmatter.ts`, `spec/fm-edit.ts`, `config.ts`, `config-edit.ts`, `plan/model.ts`, `plan/ctx.ts`, `plan/create.ts`, `perm/permissions.ts`, `package.json`.
- **Depends:** U12 (so the legacy importers of `frontmatter.ts`/`js-yaml` are already gone). **Accept:** fingerprints of every spec in this repo unchanged before/after; round-trip edit keeps comments byte for byte.
- **Deletes:** root `frontmatter.ts`, `js-yaml`, `gray-matter`, `@types/js-yaml` dependencies.

### U9 Steering generation

- **Goal:** `assets/steering/` templates; `harness/steering.ts` builds role, permission and case steering from preset modes and `steering.custom`; stamp; `specplane steering <command|permission>`; `permissions <id>` shows the full steering; regeneration hook for `config set permissions.preset|steering.custom`; failure notice.
- **Specs:** `reference-cli §12.4`, `§7.4`; `agent-skills §4`; `steering R51`, `R59`, `R59.1`; `configuration R54`.
- **Files:** `packages/cli/assets/steering/*.md`, `harness/steering.ts` (new; the current `harness/` legacy files are untouched), `perm/docs.ts`, `config-ops.ts`, `commands/steering.ts`.
- **Depends:** U2. **Accept:** agent-skills §4 T1 (every permission steering non-empty with no-bypass text), custom steering ordering, stamp changes with preset.
- **Deletes:** none.

### U10 Command contracts and instruction delivery

- **Goal:** write `assets/commands/<command>.md` for every contract of `agent-skills §7` (spec-assist, spec-draft-architecture, plan-create, plan-start, plan-step, plan-finish, plan-status, validate, verify, approve, requests, plan-abandon) with version headers; `harness/instructions.ts` assembles contract + docs (+ `harness.instructions.<command>` replacement) + steering (+ separation check) and implements `deliver(session,key)` with `sessions/<id>.json` epochs.
- **Specs:** `agent-skills §1`, `§3`, `§5`, `§6`, `§7`, `§9`; `reference-cli §12.3`.
- **Files:** `packages/cli/assets/commands/*.md`, `harness/instructions.ts`, `repo/store.ts`.
- **Depends:** U9. **Accept:** deliver once per epoch, again after `epoch++`, always when the adapter cannot report; replacement keeps `[code]` steps; every contract has the five parts and names no `specplane` command (test greps).
- **Deletes:** none yet (old skills go in U14).

### U11 Harness action registry and MCP server

- **Goal:** `harness/actions.ts` registry of the `§12.1` actions calling the same core functions with `Actor{role:llm}`; `spec.retrieve` and `spec.review-context` (`retrieve.ts`); `spec.create`/`spec.edit`/`spec.delete` with author append and legacy-key rejection; `warnings.report`; a new minimal stdio MCP server (one tool per action, permission check in-process) as `specplane mcp` or `dist/harness/mcp-main.js`; instruction text attached through U10.
- **Specs:** `reference-cli §12.1`, `§12.5` (retrieval), `§6.1` (`warnings.report`); `agent-skills §6`; `harness R19`, `R19.1`, `R20`, `R26`.
- **Files:** `harness/actions.ts`, `harness/retrieve.ts`, `harness/mcp.ts`, `harness/mcp-main.ts`, `spec/edit.ts` (create/delete), `cli.ts`.
- **Depends:** U3, U6, U7, U10. Likely the largest unit; if it exceeds the budget, split into U11a (registry + retrieve + spec writes) and U11b (MCP transport). **Accept:** per action: allow/request/deny paths; `llm` has no accept/decline/role switch; supplied `status:`/`approval:` rejected; MCP `tools/list` returns one tool per action with its schema.
- **Deletes:** see U12 (the old server is removed right after the new one exists).

### U12 Legacy engine removal (deletion unit)

- **Goal:** delete the old operation engine now that its replacements (U4, U6, U11) exist, and drop CLI routes with no spec counterpart.
- **Deletes:** `core/*` (keep nothing; replace `withCheckoutLease` in the new commands with a small lock in `repo/store.ts` or drop it, and move `readContainedFile` into `docs/`); `legacy-plan/`; `legacy-config.ts`; `generate/`; `harness/claude-mcp*.ts`, `claude-suites.ts`, `conformance*.ts`, `release-evidence.ts`, `rollout.ts`; `commands/{spec.ts, spec-approve.ts, plan-approve.ts, plan.ts, generate.ts, workflow.ts, spec-pin.ts, approval-read-tree.ts, search.ts, decision.ts}`; `spec/{parse,validate,pins,leak-guard,overlay-check,skill-drift,resolve,slug}.ts` where unused; `decisions/` (later release, to be rebuilt behind `decisions.enabled`); `schemas.ts`, `lazy-validator.ts`, `report.ts`, `types.ts` leftovers, `fixtures.ts`/`test-repo.ts` if unused; their tests. CLI: `plan approve` (use `spec approve plan/<id>`), `search`, `decision`, `workflow`.
- **Depends:** U4, U6, U11. **Accept:** build passes; `grep -r legacy` in `src` finds nothing; test suite green; `specplane --help` lists only `§13.1` commands (plus `harness run`/`mcp`).
- **Note:** existing decision records in this repo are kept as files (`reference-cli §2`: migration must preserve source records).

### U13 User-command runner and CLI block

- **Goal:** `specplane harness run <command> [args]` (allow-list of harness commands, `standard-user` or switched role, no model call; no-argument `plan-step` shows next step); `isSpecplaneCommand(shellText)` in core with the shell forms of `§12.7`; adapter interface with `capabilities()`.
- **Specs:** `reference-cli §12.2`, `§12.6` (capabilities), `§12.7`; `harness R18`, `R35.1`, `R47`.
- **Files:** `harness/run.ts`, `harness/cli-block.ts`, `harness/adapter.ts`, `commands/harness.ts`.
- **Depends:** U11. **Accept:** table test for `isSpecplaneCommand` (`;`, `&&`, `|`, subshell, `env`, `sh -c`, `npx`, `bunx`, path-qualified; negatives); runner refuses a command outside the list.
- **Deletes:** none.

### U14 Harness installer and `init`

- **Goal:** `harness/install.ts`: owned files with version header, marked block (unbalanced → error, no change), `harness.install_block: off`, customised-file kept and reported, symlink refusal; `init --harness <name>` creates config on request, sets notes refspecs, installs; `harness` validation family and staleness warnings (version header, stamp).
- **Specs:** `reference-cli §12.6`, `§13.1` (init); `repository-layout §5`; `agent-skills §2`, `§9`.
- **Files:** `harness/install.ts`, `commands/init.ts` (rewrite), `verify/rules/harness.ts`, `verify/warnings.ts`.
- **Depends:** U9, U10, U13. **Accept:** install twice changes nothing; text outside block byte-identical; begin without end refused; older header warned.
- **Deletes:** `harness/claude.ts`, `codex.ts`, `codex-channel.ts`, `index.ts`, `package-builder.ts`, `claude-package.ts`, `codex-package.ts`, `containment*.ts` (fold the symlink check into `install.ts`), `agents/standing.ts`, `agents/` remainder, `docs/freshness.ts`, and their tests.

### U15 Claude Code templates, hooks and plugin

- **Goal:** templates per `claude-integration §1`–`§5`, `§8`–`§10`: new rules text with version and stamp; `skills/specplane-<command>/SKILL.md` generated from the contracts with the `disable-model-invocation` table; hooks `specplane-cli-block.sh`, `specplane-compact.sh`, rewritten `specplane-session-context.sh`, `specplane-pre-commit.sh` (core validation), `specplane-statusline.sh`; settings merge rules; plugin declares the new MCP server and its slash-command handler calls `specplane harness run`; copy to `.claude/`.
- **Specs:** `claude-integration §1`–`§5`, `§8`–`§10`; `agent-skills §2`, `§8`.
- **Files:** `harnesses/claude/templates/**`, `harnesses/claude/plugin/**`, `.claude/**`, `harnesses/claude/tests/hooks.test.sh`, `check-sync.sh`, `package.json` build copy step.
- **Depends:** U13, U14. **Accept:** `hooks.test.sh` cases of `§9`, settings-merge cases, `check-sync.sh` T1, contract-version T2.
- **Deletes:** templates and installed copies of `specplane-policy-guard.sh`, `specplane-generate.sh`, `specplane-handoff-check.sh`, all `specplane-reason-*` skills; old `plugin/hooks/commands.ts` dispatch and `handlers.ts` parts tied to the old tools. The dogfood `.claude/` change alters this repo's own hooks; the maintainers' policy guard is removed per `claude-integration §1`.

### U16 Claude session adapter

- **Goal:** adapter for Claude Code: `plan.start` launches the plan session via `claude -p` in the worktree (else prints the command as an error); keeps the run marker heartbeat and clears it on clean end; measures usage and calls budget `evaluate` (soft instruction, hard stop with `stop.kind: hard`); compaction epoch from the hook; `notify` and request dialogue where the host allows; resume after a blocking request is answered while a session is active; subagent step execution per `§6`.
- **Specs:** `claude-integration §6`, `§7`; `reference-cli §8` (notifications, dialogue, resume), `§11.3`, `§11.4`, `§12.3`; `plan-execution R27.1`, `R27.5`.
- **Files:** `harnesses/claude/plugin/hooks/session-adapter.ts`, `register.tsx`, `harness/adapter-claude.ts`.
- **Depends:** U15. **Accept:** fake-host tests for heartbeat, soft and hard stop, launch fallback; live check only with the user's approval.
- **Deletes:** `plan heartbeat` and `plan usage` CLI routes become adapter calls (keep functions).

### U17 Codex integration

- **Goal:** `AGENTS.md` block with standing text; `.agents/skills/specplane/SKILL.md` table plus `contracts/` generated from U10; MCP channel per the U0 decision; `capabilities()` reports no typed commands and no command blocking until verified; `codex exec` launch with fallback; model identity.
- **Specs:** `codex-integration §1`–`§7`.
- **Files:** `harnesses/codex/templates/**`, `harness/adapter-codex.ts`, tests.
- **Depends:** U0 (contradiction 6), U14. **Accept:** T1–T3 of `codex-integration §7`.
- **Deletes:** `scripts/workflow.mjs`, `references/shared-procedure.md`, `contracts/codex-integration.md` (old), old codex tests.

### U18 User and AI documentation

- **Goal:** move hand-written docs to `docs/user/`; `build-docs` copies to `assets/docs/` with a manifest; required-topics build test (every catalog permission, command, configuration key with default, five mandatory notes, per-harness support table); `build-ai-docs` essentials file under a tested size limit plus searchable remainder; CI recipe documented (`§14.1`).
- **Specs:** `reference-cli §12.5`, `§14.1`; `steering R22`, `R23`; `repository-layout §1`.
- **Files:** `docs/user/**`, `packages/cli/scripts/build-docs.mjs`, `build-ai-docs.mjs`, `validate-docs.mjs`, `docs/bundle.ts`, `packages/cli/assets/docs/**` (generated).
- **Depends:** U12–U17 (commands and harness support must be final). **Accept:** `§12.5` T1 fails on a missing key/command/permission; size-limit test.
- **Deletes:** hand-written `assets/docs/topics/**` and `sources/` copies of specs, replaced by generated output.

### U19 Pre-commit checks (later release)

- **Goal:** `specplane check requirement-ids --staged`, `check tests --staged`, `git/hooks.ts` section install/remove driven by `config set pre_commit.*`, validation warning when on and missing.
- **Specs:** `reference-cli §14.2`; `verification R32`, `R36.3`.
- **Depends:** U5, U2. Build only after the first release is complete.

## Order and parallelism

U0 → U1 → (U2, U3, U4 in any order) → U5 → U6 → U7 → U9 → U10 → U11 → U12 → U8 → U13 → U14 → U15 → U16 → U17 → U18 → U19. U4 and U7 can run alongside U3/U5 since they touch different files. U8 waits for U12 because most `js-yaml`/`gray-matter` importers are legacy code that U12 deletes.
