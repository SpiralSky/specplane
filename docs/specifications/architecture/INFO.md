# Architecture Specifications — Specplane

This folder contains the architecture specifications for the Specplane framework. Architecture specs describe **how** the framework is built: file formats, module structure, data schemas, algorithms, and technology choices.

## Spec set

| ID | Title | Status | Implements |
|----|-------|--------|-----------|
| `architecture/repository-layout` | Repository layout | approved | feature/spec-system, feature/configuration, feature/plan-system, feature/decisions |
| `architecture/file-formats` | File formats: frontmatter schemas, naming, templates | approved | feature/spec-system, feature/plan-system, feature/plan-steps, feature/decisions |
| `architecture/reference-cli` | Reference CLI: modules, parsing, git integration, validation, plan flows | approved | feature/tooling, feature/plan-execution, feature/plan-index, feature/configuration |
| `architecture/agent-skills` | Agent skills: config resolution and harness-neutral prompt contracts | approved | feature/agent-integration |
| `architecture/ci` | CI: PLANS.md regeneration and validation | approved | feature/plan-index, feature/tooling |

Harness-specific architecture specs live in their overlay roots and define how the harness-neutral contracts in `architecture/agent-skills` are packaged:
- `claude:architecture/claude-integration` (`harnesses/claude/specifications/architecture/claude-integration.md`)

## Conventions

- Architecture specs have a non-empty `implements` list.
- Templates for each file type are specified in `architecture/file-formats`, not as separate code files.
- Cross-references use full IDs. Do not duplicate content from feature specs — reference the spec for the "what" and add the "how" here.
