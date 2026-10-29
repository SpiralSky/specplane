---
id: architecture/ci
title: "CI: PLANS.md regeneration and validation"
status: approved
author: llm
implements: [feature/plan-index, feature/tooling]
---

# CI: PLANS.md regeneration and validation

This spec defines the CI jobs that keep `PLANS.md` fresh and run Specplane validation on every push.

---

## Jobs

Two CI jobs are provided as a reference implementation. Both are expressed as GitHub Actions workflows (the most common CI platform for open-source repositories); other CI systems follow the same logic.

---

## Job 1: Validate (`specplane-validate.yml`)

**Trigger**: every push to any branch (`branches: ["**"]`, which covers `main` and plan branches, to catch spec errors early), and every pull request targeting `main`.

**Purpose**: enforce that config, specs, plans, steps, and ADRs pass every check of `specplane validate` with no errors (valid frontmatter, no dangling IDs, no dependency cycles, no duplicate ADR numbers, ordering policy respected). Stale base pins (`base-changed`), anchors, and skill drift are warnings, except that a spec with a stale pin cannot be `approved` (error). The hash comparison needs no history, so `fetch-depth: 0` is optional for these checks and only lets the message include a usable `git diff <pin> <current>`. Architecture-leak and overlay findings are warnings and never fail the job.

**Steps**:

```yaml
name: Specplane validate
on:
  push:
    branches: ["**"]
  pull_request:
    branches: [main]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # git branch checks; pin checks compare blob hashes and work with a shallow clone (a missing pinned object only omits the diff hint)

      - uses: actions/setup-node@v4
        with:
          node-version: "22"

      - run: npm install -g specplane@0   # pin the major version

      - name: Validate
        run: specplane validate
```

**Exit behaviour**: the job fails if `specplane validate` exits non-zero (any error). Warnings are printed but do not fail the job.

**Pull requests validate the merged result**: on `pull_request` events, `actions/checkout` checks out the merge of the PR into `main`, so checks that only fail after combining branches — duplicate ADR numbers, dependency cycles across plans, dangling references — are caught before merge.

---

## Job 2: Regenerate PLANS.md (`specplane-generate.yml`)

**Trigger**: push to `main` only (after a plan branch is merged), and only when a `PLAN.md` at any path or `.specplane/config.yaml` changed (see Path filter).

**Purpose**: keep `PLANS.md` fresh after plan files change on `main`. Because `PLANS.md` is derived only from committed plan files (see `feature/plan-index`), a push that changes no plan file cannot make it stale, and regeneration is deterministic.

**Steps**:

```yaml
name: Regenerate PLANS.md
on:
  push:
    branches: [main]
    paths:
      - "**/PLAN.md"
      - ".specplane/config.yaml"

concurrency:
  group: specplane-generate
  cancel-in-progress: false

jobs:
  generate:
    runs-on: ubuntu-latest
    permissions:
      contents: write   # needed to commit PLANS.md back to main

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          ref: main
          token: ${{ secrets.GITHUB_TOKEN }}

      - uses: actions/setup-node@v4
        with:
          node-version: "22"

      - run: npm install -g specplane@0

      - name: Regenerate
        run: specplane generate

      - name: Commit if changed
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add -A   # the fresh checkout changes only what `specplane generate` wrote
          if git diff --cached --quiet; then
            echo "PLANS.md unchanged; no commit needed."
          else
            git commit -m "chore(specplane): regenerate PLANS.md [skip ci]" \
              --trailer "Specplane-Workflow: generate" --trailer "Specplane-Agent: ci"
            git push
          fi
```

**Message**: follows `architecture/file-formats` §8 (`Specplane-Workflow: generate`, `Specplane-Agent: ci`; `--trailer` needs git ≥ 2.32, which hosted runners provide). **`[skip ci]`**: the commit message includes `[skip ci]` to prevent this push from re-triggering the generate job (avoiding an infinite loop on CI systems that do not filter their own commits).

**Idempotence**: generation is deterministic, so if no plan file changed in a way that affects the index, `PLANS.md` is byte-identical and no commit is made.

**Concurrency**: the `concurrency` group serialises runs, so two quick pushes do not race to push the regenerated file. If `git push` is still rejected (a newer commit landed), the next run regenerates from that commit.

---

## Path filter

The regeneration job uses a `paths` filter so it only runs when the inputs of `PLANS.md` change: `PLAN.md` files (active or archived, including moves into `archive/`) and the config (which sets `plans.dir` and `dependency_mode`). The filter is config-independent: `**/PLAN.md` matches a plan file under whatever `plans.dir` is configured, and the workflow never names `plans.dir` or the `PLANS.md` path (`git add -A` stages only what `specplane generate` wrote). A stray `PLAN.md` elsewhere merely triggers a run in which `specplane generate` makes no change and no commit. Step files and branch or PR activity do not affect the committed index.

---

## Protected branch considerations

The regeneration job requires write access to `main`. On repositories with branch protection rules that prevent direct pushes:

1. Use a GitHub App token with write permissions instead of `GITHUB_TOKEN`.
2. Or use a bot account's PAT.
3. Or disable the regeneration job and use on-demand generation (`specplane generate` run locally and committed via a PR).

Document the trade-off in the repository's `AGENTS.md` or `README.md` so contributors know which mode is active.

---

## Validation in plan branches

Running `specplane validate` in plan branch PRs catches errors before they reach main. This is the primary value of the validate job: specs edited on a plan branch are checked in the PR, not after merge.

The validate job runs on `branches: ["**"]` to cover all branches. Plan branches (`plan/*`) benefit most because they contain spec and plan file edits.

---

## `.gitattributes` recommendation

To prevent GitHub's linguist from counting `PLANS.md` as a Markdown document (and thus skewing language statistics), add to `.gitattributes` (a pattern without a slash matches at any depth, so it follows `plans.dir`; prefix it with the directory to narrow it):

```
PLANS.md linguist-generated=true
```

This is a cosmetic change and does not affect CI behaviour.
