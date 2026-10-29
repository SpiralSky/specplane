---
id: 2026-10-29-cli-forge-ci-publish
title: Forge integration, CI workflows, and npm publish setup
status: ready
specs:
  - architecture/reference-cli
  - architecture/ci
  - feature/plan-execution
  - feature/plan-status
  - feature/configuration
  - feature/plan-index
  - feature/tooling
depends_on:
  - 2026-10-28-reference-cli-core
  - 2026-10-29-cli-plan-flows
---

# Forge integration, CI workflows, and npm publish setup

## Goal

Add optional forge (GitHub) integration to the CLI, install the CI workflows from `architecture/ci` in this repository, and prepare the npm package for publication.

## Scope

- `architecture/ci` edits for the trigger and hardcoded-path findings.
- `git/forge.ts` with `auto`, `github`, `none`; PR creation in the finish flow; `review` effective status from open PRs.
- `.github/workflows/specplane-validate.yml` and `specplane-generate.yml`, `.gitattributes`.
- npm package metadata, files list, publish workflow, dry-run verification.

## Non-goals

- Actually publishing to npm (needs credentials and the user).
- Other forges.

## Specs implemented

| Spec | Coverage |
|------|----------|
| `architecture/reference-cli` | forge.ts and finish PR path |
| `architecture/ci` | Workflows and corrections |
| `feature/plan-execution` | `pull_request` merge mode |
| `feature/plan-status` | `review` effective status |
| `feature/configuration` | `plans.forge`, `plans.merge` |
| `feature/plan-index` | CI regeneration |
| `feature/tooling` | Distribution |
| `decision/0002` | Language and distribution |

## Acceptance criteria

- [ ] With `plans.forge: auto` and a GitHub `origin` plus `gh`, `plan finish` creates a PR and `plan list` reports `review` while it is open; without them everything behaves as `none`.
- [ ] `architecture/ci` prose and YAML agree, and no path in either hardcodes `plans/`.
- [ ] The two workflows exist under `.github/workflows/` and are consistent with `architecture/ci`.
- [ ] `npm pack --dry-run` in `packages/cli` lists only the intended files, including bundled templates when present; the publish workflow is committed and not triggered.
- [ ] `npm test` passes.

## Risks

1. `gh` output formats change: parse only `--json` output.
2. CI path filters cannot read config: the corrected spec must give a working approach.
3. `npm install -g specplane@0` in the workflow only works after the first publish: note it in the README.

## Steps

1. `ci-spec-edits`: Edit `architecture/ci`.
2. `forge`: Implement forge support.
3. `ci-workflows`: Install the CI workflows.
4. `npm-publish-setup`: Prepare npm publication.
