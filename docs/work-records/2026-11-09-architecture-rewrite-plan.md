# Architecture rewrite plan

Written 2026-11-09 (session 17). Rewrites `docs/specifications/architecture/` from the 11 approved feature specs. The page (`docs/requirements/product-requirements.md`) wins; old architecture text is reference, adapted or scrapped. Old text stays in git.

## Spec set (decided by the agent; the user owns only the page)

| ID | Replaces | Role |
|----|----------|------|
| `architecture/file-formats` | file-formats | Frontmatter, approval record, cites, plan record files, config schema, test/audit records |
| `architecture/repository-layout` | repository-layout | Where files live, worktrees, generated/ignored files |
| `architecture/reference-cli` | reference-cli | Modules, parsing, content fingerprint, validation, permissions, requests, audit, tests, plan flows |
| `architecture/agent-skills` | agent-skills | Harness-neutral command contracts, standing instructions, steering, retrieval |
| (deleted) | ci | PLANS.md and its CI job no longer exist; pre-commit/CI checks belong to `reference-cli` |

Harness specs under `harnesses/*/specifications` only get their citations fixed in a later pass.

## Format

Same as `2026-11-09-spec-format.md`, except the frontmatter lists `implements` (feature sections, as `<slug> R<n>` or `<slug> §<n>`) instead of `covers`, plus `references` for every other cite. Body sections are headed by topic (`## §1 ...`) and each states which feature section it implements. Architecture may hold file formats, modules and algorithms. Status starts `awaiting-review`; one separate-agent review of the set, then approval (`spec-review-policy`).

## Order

1. file-formats  2. repository-layout  3. reference-cli  4. agent-skills  5. review  6. approve  7. CLI reads the new format (code)
