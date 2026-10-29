# Feature Specifications — Specplane

This folder contains the feature specifications for the Specplane framework. Feature specs describe **what** the framework does from the perspective of users, agents, and observable behaviour. They do not describe implementation.

## Spec set

| ID | Title | Status |
|----|-------|--------|
| `feature/spec-system` | Spec system: roots, types, frontmatter, lifecycle, IDs | approved |
| `feature/spec-policies` | Spec policies: authorship, ordering, architecture-leak guard | approved |
| `feature/spec-precedence` | Implementation precedence and gap/contradiction handling | approved |
| `feature/spec-overlays` | Overlay spec roots: namespacing, extension, validation | approved |
| `feature/configuration` | Configuration schema and defaults | approved |
| `feature/plan-system` | Plan system: layout, IDs, PLAN.md, dependencies | approved |
| `feature/plan-status` | Plan status model: stored vs. derived, status sources | approved |
| `feature/plan-steps` | Step context contract and HANDOFF.md | approved |
| `feature/plan-index` | PLANS.md generation | approved |
| `feature/plan-execution` | Execution backends, start/finish flows, merging, stacking | approved |
| `feature/tooling` | CLI behaviour | approved |
| `feature/agent-integration` | AGENTS.md, skills, policy enforcement | approved |
| `feature/decisions` | Architecture decision records (ADRs) | approved |

## Conventions

- IDs are path-derived from the filename: a file at `features/plan-system.md` has ID `feature/plan-system`.
- Cross-references use the full ID: `feature/spec-system`, `architecture/file-formats`.
- An unqualified cross-reference within this root resolves to the `base` root.
- Do not duplicate content between specs. Cross-reference instead.
- Acceptance scenarios use Given/When/Then format.

## Architecture-leak guard

Feature specs in this folder are subject to the architecture-leak guard: they must not describe implementation details (file paths, module names, technology choices, data schemas, algorithms). If you believe a spec needs an exception, see `feature/spec-policies` for the `allow_architecture` override.
