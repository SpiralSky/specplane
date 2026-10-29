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
