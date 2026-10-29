---
plan: 2026-10-28-reference-cli-core
step: 3
title: Validation engine and validate command
status: pending
context:
  - spec: architecture/reference-cli#Spec validation
  - spec: architecture/reference-cli#Architecture-leak guard
  - spec: architecture/reference-cli#Plan parsing and validation
  - spec: architecture/reference-cli#ADR validation
  - spec: architecture/reference-cli#Dependency graph
  - spec: architecture/reference-cli#Validation output format
  - spec: feature/spec-policies
  - spec: feature/spec-system
  - spec: feature/plan-system
  - spec: feature/plan-steps
  - spec: architecture/file-formats
  - file: packages/cli/src/spec/
  - file: packages/cli/src/plan/
---

## Goal

Implement the full `specplane validate` command: config findings, spec frontmatter validation, ID–path matching, overlay rules, authorship and ordering checks, architecture-leak and overlay-contradiction heuristics, plan dependency graph and cycle detection, step and ADR rules, and cross-reference resolution. Output in both human-readable and JSON formats. (PLANS.md freshness is added in step 04, once the generator exists.)

## Acceptance criteria

- [ ] `specplane validate` run in the `specs-framework` repo exits 0 with no errors.
- [ ] `specplane validate --json` outputs valid JSON matching the schema in `architecture/reference-cli` §Validation output format.
- [ ] A spec with a mismatched ID produces an error: "ID `X` does not match path-derived ID `Y`."
- [ ] A feature spec containing the string `src/foo.ts` produces a warning of type `path`; the same string inside a fenced code block or listed in `leak_guard_allow` produces none.
- [ ] A feature spec containing "TypeScript" produces a warning of type `tech_name`; one mentioning the config key `status_source` produces none.
- [ ] An `approved` architecture spec with a non-approved spec in `implements` produces an `ordering` error; a `draft` one produces nothing.
- [ ] An overlay spec with the same ID as a base spec produces a shadowing error.
- [ ] Two ADRs numbered `0003` produce a duplicate-number error.
- [ ] A plan with a dependency cycle produces an error.
- [ ] A step file with `step: 3` in a file named `02-foo.md` produces an error.
- [ ] All unit tests pass.

## Tasks

1. Implement `src/spec/validate.ts`:
   - `validateSpec(...)` — checks 1–7 from `architecture/reference-cli` § Spec validation.
   - `validateSpecs(config, root): ValidationReport` — iterate all specs across all roots; run the ordering policy (error), the leak guard, and overlay heuristics.
2. Implement `src/spec/leak-guard.ts` and `src/spec/overlay-check.ts` per `architecture/reference-cli`, including the preprocessing (code blocks, link targets, built-in and configured allow-lists).
3. Implement `src/plan/graph.ts`:
   - `buildGraph(plans): DirectedGraph`.
   - `detectCycle(graph): string[] | null` — DFS with three-colour marking.
   - Validate dangling `depends_on` IDs (reference to non-existent plan = error).
4. Implement `src/plan/validate.ts` per `architecture/reference-cli` § Plan parsing and validation, including step `context` resolution (spec IDs with `#heading` anchors via `findHeading`, `decision/NNNN` IDs, file paths as warnings) and HANDOFF.md entries for skipped/blocked steps.
4a. Implement `src/decisions/validate.ts` per `architecture/file-formats` §6.2.
5. Implement `src/commands/validate.ts`: wire together config warnings, `validateSpecs`, plan and ADR validation, and the AGENTS.md section check; merge results; output via `src/output/human.ts` or `src/output/json.ts`.
6. Implement `src/output/human.ts` and `src/output/json.ts` matching the formats in `architecture/reference-cli` §Validation output format.
7. Write unit tests for: leak guard (each type, plus each exclusion), overlay rules, ordering policy, cycle detection (no cycle, simple cycle, multi-node cycle), step contiguity (missing step, duplicate step number), anchors, ADR rules.
8. Wire `validate` command into `src/cli.ts`.

## Guidance

- `detectCycle` uses the standard DFS: white=unvisited, grey=in-stack, black=done. When grey is encountered, a cycle exists; reconstruct the path by following parent pointers.
- The ordering check fires only when `config.specs.architecture.require_approved_features` is true and only for `approved` architecture specs, so progressive work on `draft`/`review` specs is never flagged.
- Expect warnings (not errors) from the leak guard on this repository's own specs; the acceptance criterion is zero errors.
