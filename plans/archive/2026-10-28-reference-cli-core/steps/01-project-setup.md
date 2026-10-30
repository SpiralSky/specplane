---
plan: 2026-10-28-reference-cli-core
step: 1
title: TypeScript project scaffold and dependencies
status: done
context:
  - spec: architecture/reference-cli
  - decision: decision/0002
  - file: plans/archive/2026-10-28-reference-cli-core/PLAN.md
---

## Goal

Create the TypeScript project scaffold for the `specplane` CLI: `package.json`, `tsconfig.json`, source layout matching `architecture/reference-cli`, installed dependencies, a working `npm run build`, and a stub CLI entry point that prints the version.

## Acceptance criteria

- [x] `npm install` completes without errors.
- [x] `npm run build` compiles TypeScript to `dist/` without type errors.
- [x] `node dist/cli.js --version` prints a version string (e.g. `0.1.0`).
- [x] Directory structure under `src/` matches `architecture/reference-cli` §Module structure exactly.
- [x] `npm test` runs (even if there are no tests yet) and exits 0.

## Tasks

1. Create `packages/cli/` at the repository root as the CLI package directory.
2. Write `packages/cli/package.json`:
   - `name`: `specplane` (or `@specplane/cli`).
   - `version`: `0.1.0`.
   - `bin`: `{ "specplane": "./dist/cli.js" }`.
   - `scripts`: `build: tsc`, `test: npm run build && node --test dist/`, `start: node dist/cli.js`.
   - Dependencies: `commander@^12`, `js-yaml@^4`, `gray-matter@^4`, `ajv@^8`, `ajv-formats@^3`.
   - Dev dependencies: `typescript@^5`, `@types/node@^20`, `@types/js-yaml@^4`.
3. Write `packages/cli/tsconfig.json`: `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`, `outDir: dist`, `rootDir: src`, `strict: true`.
4. Create the full `src/` directory tree from `architecture/reference-cli` §Module structure (empty `index.ts` files where needed to satisfy imports).
5. Write `src/cli.ts`: import `commander`, create a `program` with `--version` using the `version` from `package.json`, add a placeholder for each subcommand (spec, plan, search, validate, generate, init), parse `process.argv`.
6. Write `src/errors.ts`: define all error classes from `architecture/reference-cli` §Error classes.
7. Write `src/types.ts`: define the `Config`, `SpecFrontmatter`, `PlanFrontmatter`, `StepFrontmatter`, `AdrFrontmatter`, `Finding`, and `ValidationReport` TypeScript types, derived from the JSON Schemas in `architecture/file-formats` and the output format in `architecture/reference-cli`.
8. Run `npm install` and `npm run build` and verify the acceptance criteria.

## Guidance

- Place the CLI package at `packages/cli/` so the repository root stays clean. The `specplane` binary path in the plan's `setup_hook` (if added later) will be `cd packages/cli && npm install`.
- `module: NodeNext` requires explicit `.js` extensions on relative imports in TypeScript source. This is correct for Node ESM; note it in a comment in `tsconfig.json`.
- The `src/types.ts` types do not need to be 100% final in this step — they will be refined in step 2 as parsing is implemented. Write the shape you know from the schemas and add a `// TODO` comment for fields to verify.
