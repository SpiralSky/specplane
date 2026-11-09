# Feature Specifications — Specplane

This folder contains the feature specifications for Specplane. Feature specs describe **what** Specplane does from the perspective of users, LLMs and observable behaviour. They do not describe implementation. The format every spec follows is in `docs/work-records/2026-11-09-spec-format.md`, and the requirements they trace to are in `docs/requirements/product-requirements.md`, which wins over everything here.

## Spec set

| ID | Title | Covers |
|----|-------|--------|
| `feature/specifications` | Specifications: types, layers, metadata, approval, IDs | R1, R2, R4, R5, R7, R9, R10, R11, R40, R65, R67, R68 |
| `feature/plans` | Plans: record, steps, status, budgets | R28, R29, R30, R69 |
| `feature/plan-execution` | Starting, running, stopping and finishing plans | R27, R31 |
| `feature/roles-and-permissions` | Roles, permissions, presets and enforcement | R42 to R60 (permissions) |
| `feature/requests` | Requests from the LLM to the user | R52 |
| `feature/steering` | Instructions that steer the LLM | R22, R23, R51, R59 |
| `feature/harness` | Harness integration, commands, instructions | R14, R18 to R21, R26, R34, R35, R38, R47 |
| `feature/cli` | CLI for people | R16, R17, R33 |
| `feature/verification` | Validation, warnings, audit, tests, implemented status | R12, R13, R24, R32, R36, R61, R64 |
| `feature/configuration` | Settings, permissions to change them, permission documentation | R25, R54 |
| `feature/later-releases` | Decision records, subprojects, migration (to be written) | R37, R39, R66 |

All specs are `awaiting-review` until approved with `specplane spec approve`. The old specs `spec-system`, `spec-policies`, `spec-precedence`, `plan-system`, `plan-status`, `plan-steps`, `plan-index`, `tooling` and `agent-integration` have been replaced by the specs above. `decisions` and `spec-overlays` are old text that `later-releases` will replace.

## Conventions

- IDs are path-derived from the filename: a file at `features/plans.md` has ID `feature/plans`.
- A spec cites another spec's section as `<slug> R<n>` or `<slug> §<n>`; a bare requirement ID (`R11`) refers to the requirements page.
- Do not duplicate content between specs. Cross-reference instead.
- Scenarios use Given/When/Then format.
- Feature specs describe behaviour only: no file formats, module names or algorithms. Those belong to architecture specs.
