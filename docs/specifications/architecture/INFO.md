# Architecture Specifications — Specplane

This folder contains the architecture specifications for the Specplane framework. Architecture specs describe **how** the framework is built: file formats, module structure, data schemas, algorithms, and technology choices.

## Spec set

| ID | Title | Status | Implements |
|----|-------|--------|-----------|
| `architecture/repository-layout` | Repository layout | review | feature/spec-system, feature/configuration, feature/plan-system, feature/decisions |
| `architecture/file-formats` | File formats: frontmatter schemas, naming, templates | approved | feature/spec-system, feature/plan-system, feature/plan-steps, feature/decisions, feature/configuration, feature/plan-index, feature/tooling |
| `architecture/reference-cli` | Reference CLI: modules, parsing, git integration, validation, plan flows | approved | feature/tooling, feature/plan-execution, feature/plan-index, feature/configuration, feature/spec-system, feature/spec-overlays, feature/spec-policies, feature/plan-system, feature/plan-status, feature/plan-steps, feature/decisions, feature/agent-integration |
| `architecture/agent-skills` | Agent skills: config resolution and harness-neutral prompt contracts | approved | feature/agent-integration, feature/spec-precedence, feature/spec-policies, feature/spec-system, feature/plan-steps, feature/plan-execution, feature/tooling |
| `architecture/ci` | CI: PLANS.md regeneration and validation | approved | feature/plan-index, feature/tooling |

Harness-specific architecture specs live in their overlay roots and define how the harness-neutral contracts in `architecture/agent-skills` are packaged:
- `claude:architecture/claude-integration` (`harnesses/claude/specifications/architecture/claude-integration.md`)
- `codex:architecture/codex-integration` (`harnesses/codex/specifications/architecture/codex-integration.md`)

The status column reflects stored lifecycle metadata, not approval of uncommitted revisions. The 2026-11-02 reconciliation covers optional coordination, target-aware plans/index/CI, completion assessment and bundled docs across all architecture contracts; runtime delivery and human review remain separate.

## Conventions

- Architecture specs have a non-empty `implements` list.
- Templates for each file type are specified in `architecture/file-formats`, not as separate code files.
- Cross-references use full IDs. Do not duplicate content from feature specs — reference the spec for the "what" and add the "how" here.
