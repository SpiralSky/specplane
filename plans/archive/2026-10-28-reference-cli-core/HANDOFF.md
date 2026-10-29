# HANDOFF — 2026-10-28-reference-cli-core

## Step 01: TypeScript project scaffold and dependencies

**Date**: 2026-10-29
**Outcome**: done

### What changed

- `packages/cli/package.json`: `specplane` 0.1.0, ESM, bin, scripts, dependencies as specified.
- `packages/cli/tsconfig.json`: ES2022 / NodeNext / strict; comment on `.js` import extensions.
- `packages/cli/.gitignore`: ignores `node_modules/` and `dist/`.
- `packages/cli/package-lock.json`: lockfile from `npm install`.
- `packages/cli/src/cli.ts`: commander program with `--version` (read from package.json) and placeholder subcommands spec, plan, search, validate, generate, init.
- `packages/cli/src/errors.ts`: all error classes from `architecture/reference-cli` § Error classes, with `exitCode`.
- `packages/cli/src/types.ts`: Config, SpecFrontmatter, PlanFrontmatter, StepFrontmatter, AdrFrontmatter, Finding, ValidationReport and related unions.
- `packages/cli/src/**`: stub `export {};` modules for every file in § Module structure.
- `plans/2026-10-28-reference-cli-core/steps/01-project-setup.md`: status done, criteria ticked.

### Deviations from the plan

- CHOICE: `test` script is `npm run build && node --test` (not `node --test dist/`), because `node --test dist/` fails on Node 22 (treats `dist/` as a module). Plain `node --test` auto-discovers `*.test.js` and exits 0 with no tests.
- CHOICE: `package.json` sets `"type": "module"` (required for NodeNext ESM output) and `engines.node >=18`; tsconfig adds `esModuleInterop` and `skipLibCheck`.
- CHOICE: `tsconfig.json` contains `//` comments (tsc accepts JSONC).

### Gaps found in specs

- Gap: `architecture/reference-cli` § Module structure lists no `index.ts`; none were created. Stub modules contain `export {};`.
- Gap: the spec does not give the shape of `Config` after defaults merge; types.ts makes `pin_bases`, `plans.dir`, `decisions.dir` required and the rest optional (TODO for step 2).

### Open issues

None.

### What the next step must know

The CLI package is at `packages/cli/` (run `npm install` there; `npm run build` emits `dist/`, `npm test` builds then runs `node --test`). Source is ESM with NodeNext: relative imports need `.js` extensions. Tests go in `src/**/*.test.ts` and run from `dist/`. All modules under `src/` exist as `export {};` stubs awaiting implementation; `types.ts` is a first draft to refine as parsing lands.

## Step 02: Config loader, spec/plan/step parsers, and ID resolver

**Date**: 2026-10-29
**Outcome**: done

### What changed

- `src/git/exec.ts`, `src/git/repo.ts`: `run`, `checkoutRoot`, `mainRoot`, `defaultBranch` (all take an optional `cwd`).
- `src/schemas.ts`: JSON Schemas (spec common/feature/architecture, plan, step, ADR, config) plus AJV helpers; `src/frontmatter.ts`: shared gray-matter reader (JSON-schema YAML so dates stay strings).
- `src/config.ts`: `DEFAULT_CONFIG`, `loadConfig(root)` with unknown-key warnings, ConfigError mapping and cross-field checks.
- `src/spec/resolve.ts`, `src/spec/parse.ts`, `src/plan/resolve.ts`, `src/plan/parse.ts`, `src/decisions/parse.ts`.
- `src/types.ts`: `Config` fields now required (post-merge shape); added `Warning`.
- Fixtures in `packages/cli/test/fixtures/` and 35 tests in `src/**/*.test.ts` (all pass via `npm test`).

### Deviations from the plan

- CHOICE: `npm test` is now `npm run build && node --test "dist/**/*.test.js"` and `engines.node` is `>=22`; plain `node --test` on Node 22 also picks up `src/*.test.ts`, which fails on `.js` imports. Glob arguments need Node 21+.
- CHOICE: `resolveSpecId(id, config, fromRoot?, repoRoot?)` gains a fourth parameter (checkout root, default `checkoutRoot()`) because `Config` carries no root and the path must be absolute.
- CHOICE: `listPlans` lives in `plan/resolve.ts` (per the step task; the architecture spec places it in `plan/parse.ts`). It lists folder names without parsing PLAN.md, so validation can report bad plans as findings.
- CHOICE: `defaultBranch()` returns the bare branch name (`main`, without `origin/`) and falls back to `main` if neither branch exists.
- CHOICE: `listAdrs` throws `FrontmatterError` on a malformed ADR rather than returning findings; `validateAdrs` (later step) may need a non-throwing variant (`parseAdr` is exported).
- CHOICE: added `listStepFiles(planDir)` and `isInfoFile(path)` helpers; `findHeading` (anchor matching) is not implemented here as no task asked for it.
- CHOICE: JSON schemas omit `default` keywords (AJV strict mode); defaults live in `DEFAULT_CONFIG`.

### Gaps found in specs

- Gap: `architecture/reference-cli` § Spec resolution gives `resolveSpecId(id, config, fromRoot?)` but no way to know the checkout root (see CHOICE above).
- Gap: the spec does not say whether `defaultBranch()` returns `origin/main` or `main`, nor what happens when no candidate exists (see CHOICE above).

### Open issues

None.

### What the next step must know

Parsers throw typed errors (`FrontmatterError`, `FrontmatterMissingError`); validation code should catch them and convert to findings. `readFrontmatter` in `src/frontmatter.ts` is the shared reader. Schemas and `validator()`/`describeErrors()` are in `src/schemas.ts`. Test helper `fixture(...parts)` in `src/fixtures.js` resolves paths under `test/fixtures` (config fixtures are directories with `.specplane/config.yaml`). `loadConfig` calls `mainRoot()` for the `worktree_dir` check and falls back to the given root outside a git repo.

## Step 03: Validation engine and validate command

**Date**: 2026-10-29
**Outcome**: done

### What changed

- `src/spec/validate.ts`: `loadSpecs`, `validateSpec` (checks 1-9), `validateSpecs` (ordering policy, leak guard, overlay heuristics, INFO.md rule).
- `src/spec/leak-guard.ts`, `src/spec/overlay-check.ts`, `src/spec/slug.ts` (slugs, `headings`, `findHeading`, `hasAnchor`).
- `src/plan/graph.ts` (`buildGraph`, `detectCycle`), `src/plan/validate.ts` (`validatePlans`, `handoffOutcomes`), `src/decisions/validate.ts` (`loadAdrs`, `validateAdrs`).
- `src/agents/standing.ts` (`STANDING_VERSION`, `standingText`, `upsertBlock`, `findBlock`, `checkStanding`), `src/report.ts` (finding/report helpers), `src/output/human.ts`, `src/output/json.ts`, `src/commands/validate.ts`, `validate [--json]` wired in `src/cli.ts`.
- Tests: `leak-guard`, `slug`, `graph`, `standing` unit tests and `src/validate.test.ts` (end-to-end over temp repos built by `src/test-repo.ts`); 78 tests pass.
- Step file: status done, criteria ticked.

### Deviations from the plan

- CHOICE: `validatePlans(plans, adrs, config, root)` drops the `specs` parameter (specs are resolved by ID from disk) and adds `root`; `validateSpec(spec, config, repoRoot)` takes a `LoadedSpec` and returns a `ValidationReport`; `buildGraph` takes `{id, depends_on}` objects (`PlanRecord` has no `depends_on`).
- CHOICE: `ValidationReport` gains optional `checked: string[]` (subjects for the human "Checking X... OK" lines); JSON output omits it.
- CHOICE: leak guard tech names `Go` and `Express` match case-sensitively (the case-insensitive rule would flag the words "go" and "express"); an identifier match equal to a `tech_name` match on the same line is suppressed (otherwise `TypeScript` warns twice).
- CHOICE: built-in leak-guard allow list also contains the config enum values `local_merge`, `pull_request`, `wait_for_merge`, `in_progress`, `feature_and_architecture`, plus the snake_case config/frontmatter names.
- CHOICE: overlay heuristic treats "significant nouns" as lowercase words of 4+ letters minus a stop list (no POS tagging), skips pairs where both sentences are negated, and reports one match per negated sentence. It is noisy on this repo (warnings only).
- CHOICE: freshness check only inspects `AGENTS.md` (against the harness-neutral Workflows line); no harness registry exists until `init` (step 04), so harness-owned delivery files are not yet recognised. Pin freshness (`base-changed`, missing-pin, `pin_bases`) and skill drift are not implemented here; only the `based_on` key rule is.
- CHOICE: `skipped`/`blocked` steps without a matching HANDOFF.md section, missing/duplicate step numbers, unresolved spec/decision context, and unresolved plan `specs` are errors; missing context files, draft context specs, unmatched anchors and deprecated plan specs are warnings. Step contiguity uses the filename prefixes.
- CHOICE: unresolved/ambiguous IDs in plan `specs` and step context are resolved with no root context; an ambiguous ID is reported as an error.

### Gaps found in specs

- Gap: `architecture/reference-cli` § Spec validation check 9 says anchors are "heading slugs" while `file-formats` §3.2 matches heading text; `hasAnchor` accepts either.
- Gap: the spec does not say how an `extends` entry is resolved when the overlay root is standalone beyond "error"; used the root's `extends` parent as `fromRoot`.
- Gap: severity of HANDOFF-section and numbering findings is unspecified (see CHOICE above); `type` `step` is used for step-file findings and `plan` for plan-level (cycle, stored status).

### Open issues

None. `specplane validate` on this checkout: exit 0, 0 errors, 53 warnings (leak-guard path/tech_name/identifier on feature specs, overlay "may contradict", unmatched anchors in other plans' step contexts).

### What the next step must know

`runValidate(root)` in `src/commands/validate.ts` merges config, spec, ADR, plan and freshness reports; step 04 adds PLANS.md freshness there (use `mergeReports`/`finding` from `src/report.ts`). `src/agents/standing.ts` exports `upsertBlock(content, workflowsLine?)` for `init`. `src/test-repo.ts` `makeRepo` builds temp repos for tests (config uses `ext` root extending `base`, decisions dir `decisions`). Spec IDs in tests need at least two characters after the `/`.

## Step 04: Generate command, init command, and integration tests

**Date**: 2026-10-29
**Outcome**: done

### What changed

- `src/plan/status.ts` (`getIndexStatus`, `IndexStatus`), `src/generate/mermaid.ts` (`toMermaid`, `nodeKey`, `slugOf`), `src/generate/plans-md.ts` (`generatePlansMd`, `plansMdPath`).
- `src/commands/generate.ts` (`generate [--print]`, writes only when content differs), `src/commands/init.ts` (`init`, `runInit`, `DEFAULT_CONFIG_YAML`), both wired in `src/cli.ts`.
- `src/commands/validate.ts`: `checkPlansMd` adds a `freshness` warning when `PLANS.md` differs from the generated output (or is missing while plans exist).
- Tests: `src/generate/generate.test.ts` (status, mermaid, plans-md, freshness, init) and `src/integration.test.ts` (validate and `generate --print` against this repo); 87 tests pass. Generated `plans/PLANS.md` is byte-identical to the hand-written one, so it is unchanged.

### Deviations from the plan

- CHOICE: the integration test lives at `src/integration.test.ts`, not `test/integration.test.ts`, because `tsconfig` compiles only `src` and `npm test` runs `dist/**/*.test.js`. The repo root is derived from `dist/` (three levels up).
- CHOICE: `getIndexStatus` treats a dependency missing from `plansById` as not done (`blocked`).
- CHOICE: `generatePlansMd(config, root)` has no `live` option yet (belongs to the live-status plan); it throws if a PLAN.md is unparsable, and the freshness check then stays silent (plan validation reports it).
- CHOICE: Dependencies are listed sorted by ID, comma-separated links; the Specs column keeps frontmatter order. Mermaid nodes carry labels in node lines and edges use keys only.
- CHOICE: freshness warns for a missing `PLANS.md` only when at least one plan exists.
- CHOICE: `generate` prints `Wrote <path>` or `Unchanged <path>`; `init` skips (reports) a malformed `AGENTS.md` block and an up-to-date block, and prints `Skipped plans/.gitkeep` when the plans directory is non-empty.
- CHOICE: `init` writes the full default config with `merge: pull_request` as in the spec's schema, and short boilerplate `INFO.md` texts (no frontmatter). Not-a-repo exits 1 with "Not in a git repository". `--harness` is not implemented (out of scope for this step).

### Gaps found in specs

- Gap: `architecture/reference-cli` gives `generatePlansMd(config, root, { live })`; the step omits `live`, so it is deferred.
- Gap: the spec does not define the content of `features/INFO.md` and `architecture/INFO.md`, or whether config comments are kept in the generated default.

### Open issues

None. `specplane validate && specplane generate` on this checkout: exit 0, 0 errors, 53 warnings; two `generate` runs are byte-identical.

### What the next step must know

`checkPlansMd(config, root)` and `checkFreshness(root)` are merged in `runValidate`; step 05 should add pin/anchor/skill-drift findings there. `runInit(root)` returns report lines and is reusable for `--harness`. `src/test-repo.ts` `makeRepo` does not run `git init`; CLI-level init tests need a real git directory.

## Step 05: Base pins, section anchors, skill drift, and spec pin command

**Date**: 2026-10-29
**Outcome**: done

### What changed

- `src/git/blobs.ts` (`committedBlob`, `hasUncommittedChanges`, `readBlob`, plus `workingBlob`, `abbrev`), `src/spec/slug.ts` (`headingSlugs` with `-1`/`-2` duplicate suffixes; `hasAnchor` now uses it).
- `src/spec/pins.ts` (`normalisedHash`, `comparePin`, `refTargets`, `checkPins`, `approveGuard`, `writePins`), `src/spec/skill-drift.ts` (`skillDirs`, `checkSkillDrift`).
- `src/spec/validate.ts`: `based_on` key check moved into `checkPins`; new `checkBodyAnchors` for `<id>#<slug>` references in spec bodies (fenced code skipped). `src/commands/validate.ts` merges skill-drift findings.
- `src/commands/spec-pin.ts` (`spec pin <id> [<ref-id>...]`, `spec pin --check`), registered under a `spec` command group in `src/cli.ts` (replaces the `spec` placeholder).
- Tests: `src/spec/pins.test.ts` (real temp git repos), slug and integration tests extended; 100 tests pass.
- Step file: status done, criteria ticked. No pins in this repo needed refreshing (`spec pin --check` exits 0).

### Deviations from the plan

- CHOICE: git helpers take the repo root as `cwd` (`committedBlob(relPath, cwd, ref)`), since `ref:path` needs a repo-relative path.
- CHOICE: the "current" version of a base is the committed blob, or the working-tree file when it has uncommitted changes or is untracked (spec: working tree compared as-is for the check); `spec pin` refuses uncommitted bases.
- CHOICE: stale pin on an `approved` spec emits both the `base-changed` warning and the "Cannot approve" error; messages use the root-qualified ID (`claude:feature/...`) for specs in an extending root.
- CHOICE: `spec pin` merges into existing `based_on` (untouched keys kept); `writePins` writes the flow form `based_on: { k: "hash" }` on one line, inserted after `extends`/`implements`, and removes the key when given no pins.
- CHOICE: `spec pin --check` fails on any error, any `base-changed`, or missing pins under `require`; it prints each finding then "All pins are current." when clean.
- CHOICE: body anchor scan is strict (GitHub slug incl. duplicate suffixes); frontmatter `extends`/`implements`/`supersedes` anchors keep the lenient `hasAnchor` (slug or heading text). Unresolvable body references are not reported as anchor findings. Skill contract anchors are strict slugs.
- CHOICE: a malformed `specplane-contract` comment is reported as "has a malformed ... comment"; a contract spec that does not resolve is reported as an unmatched anchor.

### Gaps found in specs

- Gap: skill discovery ("directory registered by an installed harness") is undefined until the `init --harness` plan; `skillDirs(config, root)` in `src/spec/skill-drift.ts` checks `.claude/skills/*/` and `harnesses/claude/templates/skills/*/` when present, for the later plan to replace.
- Gap: this step's criterion "with `specs.pin_bases: off` [an approved stale spec] does not [error]" contradicts `feature/spec-overlays` (§ Base pins: under `off`, stale pins "still block approval"), `feature/configuration`, and `architecture/reference-cli`. The specs win: the error is kept under `off` (tested). Not treated as BLOCKED because the specs agree with each other.
- Gap: `architecture/reference-cli` § Base pins does not say whether `<new>` for an uncommitted base is the working-tree hash; it is (see CHOICE).

### Open issues

None. Pre-existing warnings remain (leak guard, overlay heuristics, two unmatched anchors in an archived plan's step context).

### What the next step must know

This is the last step of the plan; finish by hand per `feature/plan-execution` § Finish flow. `runValidate` now includes pin, anchor, and skill-drift findings; `checkAllPins(config, root)` and `pinSpec(config, root, id, only)` in `src/commands/spec-pin.ts` are reusable. Plan acceptance verified with `specplane` installed via `npm install -g --prefix ~/.local .`: validate exits 0 (0 errors) and `--json` has `valid/errors/warnings`; `generate` twice prints `Unchanged` and PLANS.md is fresh; `init` in a clean temp git repo creates `docs/`, `plans/.gitkeep`, `AGENTS.md`, `.specplane/`; `spec pin --check` exits 0 here; a committed body change to `feature/agent-integration` in a temp clone gives `base-changed` and exit 1; a synthetic `src/foo.ts` fires a `path` leak warning; `npm test` passes (100).
