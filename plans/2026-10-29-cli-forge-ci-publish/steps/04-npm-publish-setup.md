---
plan: 2026-10-29-cli-forge-ci-publish
step: 4
title: npm package and publish workflow
status: pending
context:
  - spec: architecture/reference-cli#Technology choices
  - decision: decision/0002
  - spec: feature/tooling#General conventions
  - file: packages/cli/package.json
  - file: .github/workflows/
---

## Goal

Make `packages/cli` publishable as `specplane` without publishing it.

## Acceptance criteria

- [ ] `package.json` has name `specplane`, version, `bin`, `files`, `engines.node >=20`, license, repository/keywords, and `prepack` builds.
- [ ] `npm pack --dry-run` lists only `dist/`, the README, and license; no tests or sources.
- [ ] A README for the package covers install, quick start, and requirements (git version, optional `gh`).
- [ ] `.github/workflows/specplane-publish.yml` publishes on a version tag with provenance, and is not triggered by this change.
- [ ] `npm test` passes.

## Tasks

1. Fill in package metadata and files.
2. Write the README and the publish workflow.
3. Verify with `npm pack --dry-run`.

## Guidance

- Templates for harnesses are copied into `dist/` by the harness plan; leave a note in the files list that `dist/templates/` is expected.
- Do not run `npm publish`.
