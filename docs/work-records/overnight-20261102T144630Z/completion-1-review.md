# Completion step 1 independent review

Reviewed commit `39fe690cb6990769e3f6ce79398af51a3f073491` in `/workspace/overnight/completion-1`, against step 01 and architecture/file-formats §10 and reference-cli. No source edits or full test suite run. Non-live, bounded Node reproductions used existing built modules.

## Findings

1. **Shared frontmatter extraction regresses existing inputs and violates the specified parser.** `packages/cli/src/frontmatter.ts:16` requires the closing delimiter to occupy the entire line. `architecture/reference-cli` lines 33 and 167 specify gray-matter extraction. With `---\na: b\n--- # comment\nhello\n`, the prior gray-matter reader returns data `{a: 'b'}` and body ` # comment\nhello\n`; the new reader throws `invalid YAML frontmatter: missing closing frontmatter delimiter`. The reader is shared by specs, plans, steps and ADRs. Preserve supported extraction behavior while applying the new strict YAML checks and required canonical-body semantics; add a regression.

2. **Valid configured root names are rejected by completion.** `packages/cli/src/schemas.ts:19` and `packages/cli/src/core/completion.ts:37` require a nonempty root name without whitespace. The configuration schema (`schemas.ts`, `spec_roots[].name`) accepts any string, and `resolveSpecId` supports names such as `docs root`. A valid `docs root:feature/example` identity therefore fails `fingerprintClosure`, and it fails the assessed dependency property-name schema as well. File-formats §10 requires closure against configured root resolution. Accept configured root identities or resolve the spec/config contract discrepancy rather than silently imposing a new restriction.

## Scope and checks

Inspected canonical sorting, literal Unicode and ECMAScript number encoding, excluded fields, newline normalization, duplicate and non-string mapping-key rejection, tags, aliases, future fingerprint syntax, cyclic closure and anchored references. Focused parser probes confirmed rejection of duplicates, non-string mapping keys, non-finite numbers and custom tags. No live host/model calls; no full suite rerun. This review is not a claim of comprehensive testing.
