---
id: decision/0003
title: Track base-spec changes with git blob pins and section anchors
date: 2026-10-29
status: accepted
superseded_by: ""
related_specs: [feature/spec-overlays, feature/spec-system, feature/agent-integration, claude:feature/claude-integration]
---

# Track base-spec changes with git blob pins and section anchors

## Context

Overlay specs and harness skills are written against base specs, and restate or depend on their contracts. When a base spec changes, nothing tells the overlay's author: the overlay drifts silently, and the only safeguard is a human remembering to re-read the base. Skills had the same problem: each restated the workflow contract and could fall behind it. Section references written as prose (`<id> § <Heading>`) also break silently when a heading is renamed.

Forces: the record must be cheap to maintain, survive rebases and squash merges (plans merge to the main branch by squash), and not raise noise on edits that do not change meaning.

## Options considered

### Manual version numbers

A `version` field on each spec, bumped by authors, with dependents recording the version they follow.  
**Pros**: simple to read.  
**Cons**: relies on authors remembering to bump, which is exactly the failure being fixed; says nothing about what changed.

### Commit SHAs

Pin the commit at which the referenced spec was reviewed.  
**Pros**: native to git.  
**Cons**: SHAs do not survive squash merges or rebases, so pins break on the normal merge path; a commit changes whenever any file does, not just the referenced spec.

### Whole-file hash including frontmatter

Hash the referenced file as a whole and compare.  
**Pros**: simple.  
**Cons**: `status` and `author` edits (for example approving the base spec) would trigger warnings in every dependent without any change in meaning. This option is a variant of the blob pin below; the decision keeps the blob pin and filters those fields.

## Decision

Specs may pin each spec they extend or implement to its **git blob hash** (`based_on` frontmatter), `validate` warns when a pinned spec has changed (ignoring `status`/`author`-only changes) and blocks approval until the change is reviewed and re-pinned with `specplane spec pin`, and specs reference sections by heading anchor (`<id>#<heading-slug>`), which `validate` checks.

## Consequences

- Pins are content-addressed: they survive rebases and squash merges, and `git diff <pin> <current>` shows exactly what changed since review.
- Overlay and skill drift is reported instead of silent; harness skills reference and pin the contract they implement instead of restating it.
- Authors must run `specplane spec pin` after reviewing a base change; pinning is an explicit act of review, and an agent must not do it on a human's behalf without that review.
- Shallow clones may lack the pinned blob: the warning still fires, but the diff is unavailable.
- Pins are optional; `specs.pin_bases` (`off`, `warn`, `require`) sets how hard missing pins are enforced.
- Anchors are checked, but the prose `§` form remains allowed and unchecked.
- Because pinning needs committed content, a base spec with uncommitted changes cannot be pinned.
