---
plan: 2026-10-28-reference-cli-core
step: 2
title: Config loader, spec/plan/step parsers, and ID resolver
status: pending
context:
  - spec: architecture/reference-cli#Repository roots
  - spec: architecture/reference-cli#Config loading
  - spec: architecture/reference-cli#Spec resolution
  - spec: architecture/reference-cli#Spec parsing
  - spec: architecture/reference-cli#Plan parsing
  - spec: architecture/reference-cli#Git and forge integration
  - spec: architecture/file-formats
  - spec: feature/configuration
  - spec: feature/spec-system
  - file: packages/cli/src/
---

## Goal

Implement `git/exec.ts`, `git/repo.ts`, `config.ts`, `spec/resolve.ts`, `spec/parse.ts`, `plan/resolve.ts`, `plan/parse.ts`, `decisions/parse.ts`, and supporting types. Each module must be individually unit-tested with realistic fixtures.

## Acceptance criteria

- [ ] `loadConfig()` returns the default config when `.specplane/config.yaml` is absent.
- [ ] `loadConfig()` merges a partial config with defaults correctly.
- [ ] `loadConfig()` throws `ConfigError` for an invalid enum value.
- [ ] `loadConfig()` returns an "Unknown config key" warning (not an error) for an unknown key, and drops it.
- [ ] `mainRoot()` returns the main checkout's root when called from inside a linked worktree.
- [ ] `resolveSpecId('feature/spec-system', config)` returns the correct absolute path when the file exists.
- [ ] `resolveSpecId` throws `SpecNotFoundError` for an unknown ID.
- [ ] `resolveSpecId` throws `UnknownRootError` for a qualified ID naming an undeclared root.
- [ ] `resolveSpecId` without `fromRoot` throws `AmbiguousIdError` when two sibling overlay roots both contain the ID, and resolves via the extends chain when `fromRoot` is given.
- [ ] Architecture specs resolve to `<root>/architecture/<slug>.md` (not `architectures/`).
- [ ] `parseSpec(filePath)` returns a typed `SpecFrontmatter` for all test fixtures.
- [ ] `parseSpec` throws `FrontmatterError` for a missing required field.
- [ ] `parsePlan(planDir)` and `parseStep(stepFile)` return typed objects for all test fixtures.
- [ ] All unit tests pass.

## Tasks

1. Implement `src/git/exec.ts` (`run` via `execFileSync` with an argument array; `GitError` on failure) and `src/git/repo.ts` (`checkoutRoot()`, `mainRoot()`, `defaultBranch()`) per `architecture/reference-cli` § Repository roots. Throw `NotARepoError` outside a repository.
2. Implement `src/config.ts`:
   - Import AJV and the config JSON Schema (inline constant matching `architecture/file-formats` §7.1).
   - `loadConfig(root: string): { config, warnings }` — read and validate `.specplane/config.yaml`, map violations to severities per §7.2, check cross-field rules, deep-merge with `DEFAULT_CONFIG`.
   - Export `DEFAULT_CONFIG` constant matching the defaults in `feature/configuration`.
3. Implement `src/spec/resolve.ts`: `resolveSpecId(id, config, fromRoot?)` per `architecture/reference-cli` §Spec resolution. Handle qualified (`root:type/slug`) and unqualified IDs.
4. Implement `src/spec/parse.ts`: `parseSpec(filePath)` — use `gray-matter` to extract frontmatter, validate with AJV against the common + type-specific schemas.
5. Implement `src/plan/resolve.ts`: `listPlans(config, root)` and `planDir(planId, config, root)` — active (`<plans.dir>/<id>/`) or archived (`<plans.dir>/archive/<id>/`).
6. Implement `src/plan/parse.ts`: `parsePlan(planDir)` and `parseStep(stepFile)`.
6a. Implement `src/decisions/parse.ts`: `listAdrs(config, root)` reading `<decisions.dir>/NNNN-*.md` (absent directory = none).
7. Write test fixtures in `packages/cli/test/fixtures/`:
   - Valid feature spec, architecture spec, feature spec with `allow_architecture`.
   - Valid PLAN.md, step file.
   - Partial config, missing config, config with an unknown key.
   - Two sibling overlay roots containing the same ID.
   - Invalid frontmatter (missing `id`, bad `status` enum, etc.).
8. Write unit tests in `packages/cli/src/**/*.test.ts` for each module (use Node's built-in `node:test`).
9. Run `npm test` and confirm all tests pass.

## Guidance

- AJV v8 uses JSON Schema draft-07 by default. Import `Ajv` from `'ajv'`; no need for additional formats package unless `format: "date"` validation is needed (it is, for ADR `date` field — add `ajv-formats`).
- `gray-matter` throws on YAML it cannot parse; wrap that as `FrontmatterError`. A file that does not start with a `---` line has no frontmatter: throw `FrontmatterMissingError`.
- The `spec/resolve.ts` `extends` chain traversal: build a lookup from root name to root object from `config.spec_roots` and walk `extends` links. Cycles are already rejected by `loadConfig`, so traversal can assume a chain.
- To test `mainRoot()`, create a temp repo with an initial commit and `git worktree add` a second checkout.
- Cross-platform paths: use `path.posix` for all path operations involving spec IDs (which use `/`); use `path.join`/`path.resolve` for actual filesystem operations.
