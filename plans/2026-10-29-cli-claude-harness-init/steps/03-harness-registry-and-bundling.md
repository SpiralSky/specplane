---
plan: 2026-10-29-cli-claude-harness-init
step: 3
title: Harness registry and template bundling
status: pending
context:
  - spec: claude:architecture/claude-integration#CLI implementation
  - spec: claude:architecture/claude-integration#`specplane init` output for Claude Code
  - spec: feature/tooling#`specplane init`
  - spec: architecture/reference-cli#Module structure
  - file: packages/cli/src/harness/
  - file: packages/cli/src/commands/init.ts
  - file: packages/cli/package.json
---

## Goal

Create `src/harness/index.ts`, wire `init --harness <name>` and detection, and bundle templates in the build.

## Acceptance criteria

- [ ] The registry exposes `{ name, detect(root), install(root, report), skillDirs(root) }` and the `claude` entry is a stub that is completed in step 04.
- [ ] `init --harness unknown` exits 1 listing known names; `init --harness claude` and detection of an existing `.claude/` call `install`; with neither, the "No `.claude/` directory found" hint is printed.
- [ ] The build copies `harnesses/claude/templates/` to `dist/templates/claude/`; a test resolves templates from the compiled module.
- [ ] `npm run build && npm pack --dry-run` includes `dist/templates/claude/`.

## Tasks

1. Implement the registry and `Report` helper (Created/Updated/Skipped lines).
2. Add the copy step to the build script.
3. Tests with a fake harness.

## Guidance

- Templates resolve relative to the compiled module, never the cwd.
