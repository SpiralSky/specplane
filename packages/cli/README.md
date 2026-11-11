# specplane

Reference CLI for [Specplane](../../README.md): validate specs, approve them, record evidence, run plans, and serve the harness actions to an LLM.

## Install

```sh
npm install -g specplane
```

Nothing is published yet; until then build from source (`npm install && npm run build` here).

## Quick start

```sh
cd your-repo
specplane init --harness claude   # notes refspecs and the Claude Code harness; or --harness codex
specplane validate                # format, citations, requirement IDs, status
specplane spec list               # specs with effective status
specplane spec approve feature/login
specplane coverage --uncovered
specplane plan list
```

The documentation is bundled and works offline: `specplane docs` lists the topics, `specplane docs <topic>` reads one and `specplane docs search <text>` searches them. Run `specplane --help` or `specplane <command> --help` for every command.

## Documentation build

`npm run build` compiles the CLI, then builds the documentation: `scripts/build-docs.mjs` copies `docs/user/` (in the repository) to `assets/docs/` with a manifest and fails when a command, permission, configuration key with its default, or one of the five mandatory notes is undocumented; `scripts/build-ai-docs.mjs` derives `assets/ai-docs/essentials.md` (under an 8 KiB limit) from it. Both outputs are generated and never edited by hand.

## Requirements

- Node.js 22 or later.
- git 2.32 or later (worktrees, `git rev-parse --path-format`, `git commit --trailer`).
- Optional: the GitHub CLI `gh`, signed in, for `plan merge --pr`.

## License

[Apache-2.0](https://github.com/specplane/specplane/blob/main/LICENSE).
