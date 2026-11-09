# Architecture Specifications — Specplane

This folder contains the architecture specifications for Specplane. Architecture specs describe **how** the framework is built: file formats, module structure, data schemas, algorithms, and technology choices. They were rewritten on 2026-11-09 from the approved feature specs (`docs/work-records/2026-11-09-architecture-rewrite-plan.md`).

## Spec set

| ID | Title | Role |
|----|-------|------|
| `architecture/file-formats` | File formats | Frontmatter, approval record, cites, content fingerprint, plan record files, configuration schema, permission presets, request records, audit log, test results and logs |
| `architecture/repository-layout` | Repository layout | Where files live, plan worktrees, local state, generated and ignored files, harness-installed files |
| `architecture/reference-cli` | Reference CLI | Modules, parsing, fingerprints and status, validation, permissions, requests, audit, tests, plan flows, harness actions, human commands, pre-commit and CI checks |
| `architecture/agent-skills` | Agent skills | Harness-neutral command contracts, standing instructions, steering and context retrieval |

The specs start as `awaiting-review` and are approved by a person or by an approver with the permission, as the feature specs are. The CI spec was deleted because the `PLANS.md` index it checked no longer exists; pre-commit and CI checks are in `architecture/reference-cli`.

Harness specifications under `harnesses/*/specifications` define how the harness-neutral contracts in `architecture/agent-skills` are packaged; their citations are fixed in a later pass.

## Conventions

- Architecture specs list the feature sections they build in `implements` and every other cite in `references`; each body section states which feature sections it implements.
- Templates for each file type are specified in `architecture/file-formats`, not as separate code files.
- Cross-references use full IDs. Do not duplicate content from feature specs: reference the spec for the "what" and add the "how" here.
