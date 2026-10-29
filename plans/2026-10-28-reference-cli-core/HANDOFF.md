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
