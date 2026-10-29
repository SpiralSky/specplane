# specplane

Reference CLI for [Specplane](../../README.md): manage specs, plans, and worktrees, validate a repository, and generate `PLANS.md`.

## Install

```sh
npm install -g specplane
```

CI workflows pin the major version with `npm install -g specplane@0`. That only resolves once the first `0.x` release has been published.

## Quick start

```sh
cd your-repo
specplane init --harness claude   # create .specplane/config.yaml and install the Claude Code harness
specplane validate                # check specs, plans, and decisions
specplane plan list               # show plans with effective status
specplane search worktree --kind plan   # search plans only
specplane plan restack <id> --dry-run   # show the commits a restack would replay
specplane spec approve architecture/search # approve a spec, re-pinning an overlay's bases
specplane spec reopen architecture/search  # approved -> review, reports the dependants
specplane plan approve 2026-10-29-search   # draft plan -> ready, PLANS.md regenerated
specplane decision new "Cache policy"      # create decisions/0004-cache-policy.md (proposed)
specplane generate                # regenerate PLANS.md
```

Plans keep their gap records in `spec-gaps.md` next to `HANDOFF.md`; `plan finish` lists the open entries for review.

Run `specplane --help` or `specplane <command> --help` for all commands.

## Requirements

- Node.js 22 or later.
- git 2.32 or later. The CLI uses worktrees, `git rev-parse --path-format` (2.31), and `git commit --trailer` (2.32).
- Optional: the GitHub CLI `gh`, signed in. With `plans.forge: auto` (or `github`) and a GitHub `origin`, `plan finish` opens a pull request and `plan list` reports `review` while it is open. Without `gh` or a GitHub remote the CLI behaves as `plans.forge: none`.

## License

[Apache-2.0](https://github.com/specplane/specplane/blob/main/LICENSE).
