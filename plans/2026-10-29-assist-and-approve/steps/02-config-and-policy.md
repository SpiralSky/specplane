---
plan: 2026-10-29-assist-and-approve
step: 2
title: The review role in config, validation, init, and standing instructions
status: pending
context:
  - spec: feature/configuration
  - spec: feature/spec-policies#Meaning of each value
  - spec: feature/agent-integration#Authorship policy enforcement
  - spec: architecture/reference-cli
  - file: packages/cli/src/config.ts
  - file: packages/cli/src/schemas.ts
  - file: packages/cli/src/types.ts
  - file: packages/cli/src/commands/init.ts
  - file: packages/cli/src/agents/standing.ts
  - file: packages/cli/src/spec/leak-guard.ts
---

## Goal

Make `review` a valid `llm_role` everywhere the CLI reads or writes it, and describe both roles correctly in the standing instructions.

## Acceptance criteria

- [ ] Config with `specs.feature.llm_role: review` or `specs.architecture.llm_role: review` validates; an unknown value still fails with the allowed values listed.
- [ ] `init` keeps the defaults (`assist` for feature, `draft` for architecture); the generated config comments list `review | assist | draft | none`.
- [ ] The standing instructions (`.claude/rules/specplane.md` source and the `AGENTS.md` block) describe `review` and the refine-then-write `assist`.
- [ ] The LLM-review stage of the leak guard runs under `review` (it is skipped only under `none`).
- [ ] `npm test` passes.

## Tasks

1. Extend the enum in the schema and types; add tests.
2. Update `init` comments and `agents/standing.ts`; regenerate this repo's rules file and `AGENTS.md` block.
