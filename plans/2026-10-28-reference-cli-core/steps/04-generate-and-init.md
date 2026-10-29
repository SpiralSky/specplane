---
plan: 2026-10-28-reference-cli-core
step: 4
title: Generate command, init command, and integration tests
status: pending
context:
  - spec: architecture/reference-cli#Plan status
  - spec: architecture/reference-cli#Dependency graph
  - spec: architecture/reference-cli#PLANS.md generation
  - spec: feature/plan-index
  - spec: feature/tooling
  - spec: architecture/file-formats#PLANS.md
  - spec: feature/configuration
  - spec: architecture/repository-layout
  - spec: architecture/agent-skills#Standing instructions
  - file: packages/cli/src/agents/
  - file: packages/cli/src/plan/
  - file: packages/cli/src/generate/
  - file: packages/cli/src/commands/
---

## Goal

Implement `specplane generate` (writes `plans/PLANS.md`), `specplane init` (scaffolds a new repo), and end-to-end integration tests that run the CLI against the `specs-framework` repository itself.

## Acceptance criteria

- [ ] `specplane generate` writes `plans/PLANS.md` matching `architecture/file-formats` §5.1–5.2, using index statuses (no git state) and no timestamp.
- [ ] Running `specplane generate` twice yields byte-identical output; `specplane validate` warns when the committed `PLANS.md` differs from the generated one.
- [ ] The generated Mermaid graph has correct colour-coded node classes for each status.
- [ ] `specplane generate --print` writes to stdout instead of the file.
- [ ] `specplane init` in a clean temp git directory creates the expected directories and files without error.
- [ ] `specplane init` does not overwrite existing files except the `AGENTS.md` managed block; with an existing `AGENTS.md`, text outside the block is byte-identical after two runs; reports each file it creates, updates, or skips.
- [ ] Running `specplane validate && specplane generate` in the `specs-framework` repo exits 0.
- [ ] All unit tests pass.

## Tasks

1. Implement `src/plan/status.ts`: `getIndexStatus(plan, plansById, config)` per `architecture/reference-cli` § Plan status (committed files only; `getEffectiveStatus` belongs to the live-status plan).
2. Implement `src/generate/mermaid.ts`: `toMermaid(graph, statuses)` per `architecture/file-formats` §5.2 (node key `p_<id with - replaced by _>`, slug label, deterministic order, all seven `classDef` lines).
3. Implement `src/generate/plans-md.ts`: `generatePlansMd(config, root): string` — read all PLAN.md files, compute index statuses, build the graph, emit PLANS.md per §5.1–5.2.
4. Implement `src/commands/generate.ts`: call `generatePlansMd`; if `--print`, write to stdout; otherwise write `<root>/<plans.dir>/PLANS.md` only if the content changed. Add the PLANS.md freshness check to `validate`.
5. Implement `src/commands/init.ts` per `feature/tooling` § `specplane init` (without `--harness`):
   - Find the checkout root; use the existing config's paths if a config exists, else the defaults.
   - Write `.specplane/config.yaml` if absent, from the full default config in `feature/configuration` § Full schema with defaults.
   - Write `features/INFO.md` and `architecture/INFO.md` in the base root if absent.
   - Write the `AGENTS.md` managed block with `upsertBlock` from `src/agents/standing.ts` (create, append, update, or report malformed).
   - Write `<plans.dir>/.gitkeep` if the plans directory is empty.
   - Print one line per file: "Created <path>", "Updated <path> (...)", or "Skipped <path> (...)".
6. Wire `generate` and `init` commands into `src/cli.ts`.
7. Write integration test in `packages/cli/test/integration.test.ts`:
   - Run `specplane validate` in the `specs-framework` repo root (use `child_process.execSync`).
   - Run `specplane generate --print` and verify the output contains `## Active plans` and a Mermaid block.
   - Both must exit 0.
8. Run all tests and fix any failures.

## Guidance

- The `## Active plans` table lists plans in `plans/` but not `plans/archive/`; `## Archived plans` lists plans in `plans/archive/`. Empty sections render as `_None._`.
- The generated `PLANS.md` starts with the `<!-- GENERATED FILE ... -->` comment line from §5.1.
- The integration test should use an absolute path to the `specs-framework` repo root, derived from `__dirname`.
- Base pins, anchors, and skill drift come in step 05; the integration test here should not assert on `base-changed` or `skill-drift` findings.
