---
id: 2026-10-28-reference-cli-core
title: Reference CLI core — validate and generate commands
status: ready
specs:
  - feature/tooling
  - feature/configuration
  - feature/spec-system
  - feature/plan-system
  - feature/plan-steps
  - feature/plan-index
  - feature/spec-overlays
  - architecture/reference-cli
  - architecture/file-formats
  - architecture/repository-layout
  - architecture/agent-skills
depends_on: []
---

# Reference CLI core — validate and generate commands

## Goal

Implement the core of the `specplane` CLI: project initialisation, config loading, spec/plan parsing, the `validate` command (frontmatter validation, ID checks, architecture-leak guard heuristics, dependency cycle detection), and the `generate` command (PLANS.md regeneration).

This plan delivers a working, installable CLI that can validate a Specplane repository and regenerate its plan index. It is the foundation all other CLI commands build on.

## Scope

- TypeScript project setup (Node 20, npm, `tsc`, `commander`, `js-yaml`, `ajv`, `ajv-formats`, `gray-matter`).
- Repository-root detection (checkout root and main checkout root) and shell-free git execution.
- Config loading with defaults, JSON Schema validation, and unknown-key warnings.
- Spec ID resolution from config roots.
- Spec and plan frontmatter parsing with typed output.
- `specplane init` command (scaffolds directories and config).
- `specplane validate` command with `--json` output (config, specs, plans, steps, ADRs, PLANS.md freshness).
- `specplane generate` command (writes a deterministic `plans/PLANS.md` from committed plan files).
- Mermaid dependency graph generation.
- Base pins (ADR 0003): `based_on` checks, `specs.pin_bases`, `<id>#<slug>` anchor checks, skill contract drift, and `specplane spec pin [--check]`.
- Unit tests for the parser, resolver, validator, and graph builder.

## Non-goals

- `spec new/list/show` (but `spec pin` is in scope), `plan new/list/show/start/finish/archive`, `search` commands (separate plan).
- Git worktree operations and the start/finish/abandon/cleanup flows (separate plan).
- Live effective statuses (`plan list`, `generate --print --live`) and `init --harness` (separate plan).
- Forge integration (separate plan).
- npm publish setup (separate plan).
- Architecture-leak and overlay LLM review (performed by agents, never by the CLI; see `architecture/agent-skills`).

## Specs implemented

| Spec | Coverage |
|------|----------|
| `feature/tooling` | `init`, `validate`, `generate` commands |
| `feature/configuration` | Full config loading and validation |
| `feature/spec-system` | Spec frontmatter parsing and ID validation |
| `feature/plan-system` | Plan frontmatter parsing |
| `feature/plan-steps` | Step frontmatter parsing and validation |
| `feature/plan-index` | PLANS.md generation |
| `feature/spec-overlays` | Base pins and section anchors |
| `architecture/reference-cli` | Module structure, parsing, validation engine |
| `architecture/file-formats` | JSON Schemas used for validation |
| `architecture/repository-layout` | Directory/file naming constraints |
| `architecture/agent-skills` | Skill contract drift check |

## Acceptance criteria

- [ ] `npm install -g .` (from the CLI package) installs `specplane` globally.
- [ ] `specplane validate` run in this repository exits 0 and reports no errors (warnings are acceptable).
- [ ] `specplane validate --json` produces valid JSON matching the schema in `architecture/reference-cli`.
- [ ] `specplane generate` writes `plans/PLANS.md` with a status table and Mermaid graph.
- [ ] `specplane init` in a clean git repo creates the expected directories and files.
- [ ] All unit tests pass (`npm test`).
- [ ] `specplane spec pin --check` exits 0 in this repository, and a committed change to a pinned base spec produces a `base-changed` warning.
- [ ] The architecture-leak heuristic fires a warning on a synthetic feature spec containing a path like `src/foo.ts`.
- [ ] Running `specplane generate` twice produces byte-identical output, and `specplane validate` reports `plans/PLANS.md` as fresh afterwards.

## Risks

1. `ajv` v8 API changes — use pinned version; confirm JSON Schema draft-07 compatibility.
2. `gray-matter` frontmatter extraction on specs with multi-line values — test with realistic frontmatter.
3. Cross-platform path handling (Windows backslash vs. POSIX slash) — normalise all paths to POSIX in the code.

## Steps

1. `01-project-setup`: TypeScript project scaffold, dependencies, build configuration.
2. `02-config-and-parsing`: Config loader, spec/plan/step parsers, ID resolver.
3. `03-validation-engine`: Validate command — frontmatter checks, ID checks, overlay rules, ordering policy, dependency cycles, step and ADR rules, architecture-leak heuristics.
4. `04-generate-and-init`: Generate command (PLANS.md + Mermaid), init command, integration tests.
5. `05-base-pins`: Base pins, section anchors, skill contract drift, and the `spec pin` command.
