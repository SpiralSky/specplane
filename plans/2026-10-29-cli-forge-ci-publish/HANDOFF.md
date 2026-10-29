# HANDOFF — 2026-10-29-cli-forge-ci-publish

## Step 01: Architecture edits for ci

**Date**: 2026-10-29
**Outcome**: done

### What changed

- `docs/specifications/architecture/ci.md`: Job 1 prose trigger now matches the YAML (push to any branch, PR to `main`); Job 2 trigger prose states the path filter; YAML filter is `**/PLAN.md` plus `.specplane/config.yaml`; commit step uses `git add -A` instead of `plans/PLANS.md`; Path filter section explains the config-independent approach; `.gitattributes` snippet uses slash-free `PLANS.md`.

### Deviations from the plan

None.

### Gaps found in specs

None.

### Open issues

None.

### What the next step must know

- CHOICE: workflows must use `**/PLAN.md` and `.specplane/config.yaml` as the generate path filter and `git add -A` after `specplane generate`; never hardcode `plans/`.
- No spec or skill marker pins `architecture/ci`; `specplane spec pin --check` and `validate` pass (0 errors).

## Step 02: forge.ts and PR integration

**Date**: 2026-10-29
**Outcome**: done

### What changed

- `packages/cli/src/git/forge.ts`: `createPR`, `getOpenPR` (gh via argument arrays, `--json url`), `hasOpenPR`; `ForgeError` (exit 2) for `github` mode and gh failures.
- `plan/flows.ts`: finish with `pull_request` pushes, then `createPR` with title = plan title and body = plan id plus acceptance criteria; prints the URL, or manual instructions on `null`.
- `commands/plan.ts`, `generate/plans-md.ts`: effective status uses `hasOpenPr`; `plan/status.ts` comment updated.
- Tests: `git/forge.test.ts` and new cases in `plan/finish.test.ts`, all with a stub `gh` first on `PATH`; no network.

### Deviations from the plan

None.

### Gaps found in specs

- reference-cli gives `createPR(branch, base, title, body)` without saying how config and cwd reach it.

### Open issues

None.

### What the next step must know

- CHOICE: functions take a trailing `{ cwd, forge }` options argument.
- CHOICE: GitHub detection reads raw `remote.origin.url` via `git config` (not `remote get-url`, which applies `insteadOf`; tests rely on this).
- CHOICE: status queries (`hasOpenPR`) swallow forge errors and report no PR, so `plan list` never fails on auth or network problems; `createPR` errors propagate.
- CHOICE: the PR body is built before the final commit because `archive_done` moves PLAN.md.

## Step 03: CI workflows in this repository

**Date**: 2026-10-29
**Outcome**: done

### What changed

- `.github/workflows/specplane-validate.yml` and `specplane-generate.yml`: copied from the corrected `architecture/ci` YAML.
- `.gitattributes`: `PLANS.md linguist-generated=true`.
- `packages/cli/src/workflows.test.ts`: parses both workflows with js-yaml and asserts triggers, path filter, commit-if-changed logic, trailers, and the `.gitattributes` line.

### Deviations from the plan

None.

### Gaps found in specs

- The step's acceptance criterion says "merge setting" for `.gitattributes`, but `architecture/ci` recommends only `linguist-generated=true`; no merge attribute is specified.
- `architecture/repository-layout` still shows `plans/PLANS.md linguist-generated=true`, while `architecture/ci` uses slash-free `PLANS.md`.

### Open issues

None.

### What the next step must know

- CHOICE: used the `architecture/ci` form `PLANS.md linguist-generated=true` (matches at any depth); added no merge attribute.
- `actionlint` is not installed; validation is the js-yaml unit test. `npm test` passes (211 tests).

## Step 04: npm package and publish workflow

**Date**: 2026-10-29
**Outcome**: done

### What changed

- `packages/cli/package.json`: keywords, `repository` (directory only), `engines.node >=20` (was >=22), `files` (`dist`, minus `*.test.js`, `fixtures.js`, `test-repo.js`, plus `README.md`), `prepack` runs the build. No `license` field.
- `packages/cli/README.md`: install, quick start, requirements (Node 20, git 2.32, optional `gh`), note that `specplane@0` resolves only after the first publish.
- `.github/workflows/specplane-publish.yml`: triggers only on `v*` tags, `npm publish --provenance` with `id-token: write`.
- `docs/specifications/architecture/repository-layout.md`: `.gitattributes` line now `PLANS.md linguist-generated=true`, matching `architecture/ci`.

### Deviations from the plan

- The `license` field is omitted by instruction; the first acceptance criterion is therefore not fully met.

### Gaps found in specs

- `architecture/reference-cli` says Node >= 18; the step and CI say 20. Used 20; the spec line was not edited.

### Open issues

- OPEN (user): choose a licence, add a LICENSE file and the `license` field.
- OPEN (user): set the `repository.url` (no git remote exists) and an `NPM_TOKEN` secret (or npm trusted publishing).

### What the next step must know

- CHOICE: engines `>=20` to match CI and the step.
- CHOICE: `dist/templates/claude` is already copied by the build, so it ships in the tarball (15 entries); `npm pack --dry-run` shows 63 files, no tests or sources.
- CHOICE: workflow uses `NODE_AUTH_TOKEN` from `secrets.NPM_TOKEN` with provenance.
- `npm test` passes (211); `validate` 0 errors; pins current.
