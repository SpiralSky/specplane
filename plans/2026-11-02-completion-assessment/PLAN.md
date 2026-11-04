---
id: 2026-11-02-completion-assessment
title: "Implementation declarations and content assessment"
status: ready
specs: ["architecture/reference-cli", "architecture/file-formats", "feature/spec-system", "feature/tooling", "feature/spec-policies"]
depends_on: ["2026-11-01-core-foundation"]
---

# Implementation declarations and content assessment

## Goal

Implementation declarations and content assessment under the settled architecture contracts.

## Scope

- Implement completion schema and versioned fingerprints
- Evaluate completion independently of lifecycle state
- Deliver spec complete and implementation status operations

## Non-goals

No lifecycle approval, automatic merge/publication, host certification, or implicit guidance installation. Preserve existing plan history and user-owned content.

## Specs implemented

- `architecture/reference-cli`
- `architecture/file-formats`
- `feature/spec-system`
- `feature/tooling`
- `feature/spec-policies`

## Acceptance criteria

- [ ] Manual declarations without fingerprints are valid; malformed metadata, duplicate keys and unsupported values follow the specified errors.
- [ ] Canonicalization excludes only specified bookkeeping; recursive root-qualified dependencies handle cycles, anchored references and changed membership.
- [ ] List/show/validation report declaration plus current, reassessment_needed, unrecorded or unverifiable with ordered reasons.
- [ ] Unavailable/unsupported dependencies take unverifiable precedence while retaining mismatches; code changes alone never imply verification.
- [ ] CLI/core parity covers dry-run, no-op repetition, all statuses and preserving prior evidence; complete resolves the entire dependency closure.
- [ ] Lease and preimage checks preserve body, lifecycle, unrelated edits/index on failure; no plan, commit, test execution or fabricated evidence is required.

## Risks

Target/bootstrap selection and readiness are human decisions. Dependencies must be finished and integrated under wait_for_merge. A missing contract becomes a numbered spec gap before dependent implementation. Changes that exceed a small reviewable component must be split before execution.

## Steps

1. [Implement completion schema and versioned fingerprints](steps/01-fingerprints.md)
2. [Evaluate completion independently of lifecycle state](steps/02-assessment.md)
3. [Deliver spec complete and implementation status operations](steps/03-completion-writers.md)

## Execution prerequisites

Create through the existing CLI after proposal approval; readiness and start remain separate human decisions. The current CLI does not support target/comparison inputs: do not synthesize execution metadata. Resolve the bootstrap exception explicitly before execution.
