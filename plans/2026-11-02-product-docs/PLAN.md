---
id: 2026-11-02-product-docs
title: "Offline product documentation and release orientation"
status: done
specs: ["architecture/reference-cli", "architecture/file-formats", "architecture/agent-skills", "feature/agent-integration", "feature/tooling"]
depends_on: ["2026-11-01-manual-lifecycle", "2026-11-02-completion-assessment", "2026-11-02-plan-index"]
---

# Offline product documentation and release orientation

## Goal

Offline product documentation and release orientation under the settled architecture contracts.

## Scope

- Build versioned documentation manifest and topic bundle
- Expose shared offline docs index, topic and search
- Detect managed guidance drift without implicit upgrades

## Non-goals

No lifecycle approval, automatic merge/publication, host certification, or implicit guidance installation. Preserve existing plan history and user-owned content.

## Specs implemented

- `architecture/reference-cli`
- `architecture/file-formats`
- `architecture/agent-skills`
- `feature/agent-integration`
- `feature/tooling`

## Acceptance criteria

- [ ] Manifest hashes, source bytes, unique topics and related links validate; minimum topics and release orientation are packaged.
- [ ] Command examples match delivered inventory; future designs are labelled rather than advertised as runtime capability.
- [ ] Operations work outside Git without config or network; CLI/core content, order and version fields agree.
- [ ] Unknown/traversal IDs, empty queries and corrupt bundles follow specified errors; literal search has deterministic excerpts and empty success results.
- [ ] Version/hash checks report stale or missing owned guidance without writing files or fetching.
- [ ] Explicit refresh consumes reviewed release assets and preserves user/custom content; integration into both installers is owned by extension-packaging.

## Risks

Target/bootstrap selection and readiness are human decisions. Dependencies must be finished and integrated under wait_for_merge. A missing contract becomes a numbered spec gap before dependent implementation. Changes that exceed a small reviewable component must be split before execution.

## Steps

1. [Build versioned documentation manifest and topic bundle](steps/01-docs-bundle.md)
2. [Expose shared offline docs index, topic and search](steps/02-docs-operations.md)
3. [Detect managed guidance drift without implicit upgrades](steps/03-guidance-freshness.md)

## Execution prerequisites

Create through the existing CLI after proposal approval; readiness and start remain separate human decisions. The current CLI does not support target/comparison inputs: do not synthesize execution metadata. Resolve the bootstrap exception explicitly before execution.
