---
id: decision/0004
title: "Raise the Node.js baseline to 22 LTS"
date: 2026-10-29
status: accepted
superseded_by: ""
related_specs: [architecture/reference-cli]
---

# Raise the Node.js baseline to 22 LTS

## Context

`decision/0002` chose TypeScript on Node.js for the reference CLI and recorded a Node.js ≥ 18 prerequisite, which was the current LTS when it was written. Since then the implementation has moved to APIs and tooling that either require or are only tested on newer runtimes:

- `node:test` with its current runner semantics, `fs.cpSync`, and `structuredClone` are used throughout the CLI and its tests.
- `packages/cli/package.json` already declares `"engines": { "node": ">=22" }`.
- All CI workflows (`specplane-validate`, `specplane-generate`, `specplane-publish`) run on `node-version: "22"`.
- `architecture/reference-cli` states the language as TypeScript (Node.js ≥ 22) and the README says Node 22+.

So the ADR is the only place that still records ≥ 18, and it now contradicts the spec, the manifest, and CI. Node 18 and 20 are past or near end of life, so supporting them would mean polyfills and an untested runtime for no user benefit.

## Options considered

### Keep Node.js ≥ 18

**Pros**: widest possible install base, no change to the recorded prerequisite.  
**Cons**: contradicts the spec, the `engines` field, and CI; the code uses newer standard-library and test-runner behaviour; 18 is end-of-life and 20 is approaching it, so the promise could not be tested and would likely be false in practice.

### Raise to Node.js ≥ 22 LTS

**Pros**: matches what is declared, built, and tested; Node 22 is the current LTS, so it is the version users are most likely to have; no polyfills; the `engines` field, CI, docs, and the ADR agree.  
**Cons**: users on 18/20 must upgrade, and `npm install` will warn (or fail with `engine-strict`) on older runtimes.

### Pin the runtime more tightly (for example an exact major via `volta`/`.nvmrc`)

**Pros**: fully reproducible contributor environments.  
**Cons**: does not change the supported baseline, only the development environment; the CLI still needs a stated minimum for users. Orthogonal to this decision and can be added separately.

## Decision

Raise the reference CLI's baseline to **Node.js ≥ 22 LTS**, superseding `decision/0002`'s Node.js ≥ 18 prerequisite. The language and distribution choice from `decision/0002` (TypeScript on Node.js, distributed via npm) is unchanged.

## Consequences

- `packages/cli/package.json` `engines.node` stays `>=22`; it is now authoritative and no longer in conflict with the ADR.
- CI keeps a single Node 22 job; there is no need for a multi-version matrix.
- `architecture/reference-cli` and the README already say Node 22+ and need no edit.
- Users on Node 18/20 get an npm `EBADENGINE` warning; this is intentional and is the supported behaviour.
- `decision/0002` is marked `superseded` and points here. Its remaining content (TypeScript, npm distribution, language-agnostic format) still stands and is not reopened.
- A future runtime bump (for example to Node 24 LTS) likewise requires a new ADR superseding this one.
