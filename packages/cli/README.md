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
specplane generate                # regenerate PLANS.md
```

Run `specplane --help` or `specplane <command> --help` for all commands.

## Requirements

- Node.js 20 or later.
- git 2.32 or later. The CLI uses worktrees, `git rev-parse --path-format` (2.31), and `git commit --trailer` (2.32).
- Optional: the GitHub CLI `gh`, signed in. With `plans.forge: auto` (or `github`) and a GitHub `origin`, `plan finish` opens a pull request and `plan list` reports `review` while it is open. Without `gh` or a GitHub remote the CLI behaves as `plans.forge: none`.

## License

No licence has been chosen yet.
