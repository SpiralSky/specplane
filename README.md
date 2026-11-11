# Specplane

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](https://nodejs.org/)

**Specs, review and evidence for AI-assisted development: structured markdown that keeps agents on track.**

Specplane is a set of file conventions, a reference CLI and agent-harness integrations. You write down what a project should do and how it is built. Specplane tracks, separately, what has been reviewed and approved, what is declared implemented, and what evidence exists. Plans are optional: they let an agent work through small steps on its own branch.

> **Status:** v0.1.0, not published to npm. Install from source (see [Install](#install)). This repository uses Specplane to describe itself; its product requirements are in [`docs/requirements/product-requirements.md`](docs/requirements/product-requirements.md).

## What it does

- **Specs say what and how.** Requirements say what the product must do, feature specs describe behaviour, architecture specs describe the implementation. Each layer cites the one above.
- **Approval is bound to content.** Status is computed, never written in the file. Change a spec, or a part it cites, and it returns to review with a reason. Approvals, test results and implementation records live in git notes, so they travel with `sync` and survive rebases.
- **Roles and permissions decide who may do what.** A person is a Standard User or an Administrator; an agent is the LLM role. Four default presets set each permission to `allow`, `request-user` or `deny`. A `request-user` action becomes a request you accept or decline.
- **Evidence is separate from declaration.** Tests declared in specs run on committed content; results bind to fingerprints and go stale when content changes. An architecture spec is marked implemented only when its checks pass.
- **Agents use actions, not the CLI.** A harness serves the same operations to an LLM as an MCP server and blocks the model from running the CLI. People use the CLI and the harness's typed commands.
- **Plans are optional.** A plan is a folder of steps run on branch `plan/<id>` with budgets, soft and hard stops, requests and a final review.

## Install

Requirements: **Node.js 22+** and **git**. The `gh` CLI is optional, for pull requests.

```sh
git clone <this-repo> specplane
cd specplane/packages/cli
npm install
npm run build
npm install -g --prefix ~/.local .   # puts `specplane` on your PATH (if ~/.local/bin is on it)
```

## Quick start

```sh
cd your-project
specplane init --harness claude   # or --harness codex; omit to skip the harness
specplane validate                # format, citations, requirement IDs, status
specplane spec list               # every spec with its effective status
specplane spec approve feature/login
specplane warnings
```

Run `specplane --help`, or read the bundled documentation offline with `specplane docs` and `specplane docs search <text>`.

## Documentation

The user documentation is written in [`docs/user/`](docs/user/) and shipped inside the package; `specplane docs` reads it. The package build (`npm run build` in `packages/cli`) copies it to `assets/docs/` with a manifest, checks that every command, permission, configuration key and mandatory note is covered, and derives a short essentials file for LLMs plus the searchable rest (`docs essentials`, `docs.search`).

| Topic | Contents |
|-------|----------|
| [`getting-started`](docs/user/getting-started.md) | Setting up a repository and approving a first spec |
| [`concepts`](docs/user/concepts.md) | Specs, approval, evidence, roles, plans |
| [`specification-format`](docs/user/specification-format.md) | Files, frontmatter, citations, status |
| [`plans`](docs/user/plans.md) | Plan folder format and lifecycle |
| [`configuration`](docs/user/configuration.md) | `.specplane/config.yaml` and every setting with its default |
| [`commands`](docs/user/commands.md) | Every command |
| [`permissions`](docs/user/permissions.md) | Roles, presets and every permission |
| [`verification`](docs/user/verification.md) | Tests, implementation, warnings, audit, logs, CI |
| [`harnesses`](docs/user/harnesses.md) | Claude Code and Codex support |

## Continuous integration

Run `specplane validate --json` on the checked-out commit; a non-zero exit fails the job. It reads committed content only and needs no permission, local store or harness. A project can also run `specplane test run --all` to execute the deterministic tests of its architecture specs.

## Harnesses

`specplane init --harness claude` installs the Claude Code files under `.claude/` (rules, skills, hooks, settings merge) and the MCP server entry. `specplane init --harness codex` installs `.agents/skills/specplane/`, the managed block in `AGENTS.md` and a `[mcp_servers.specplane]` table in project `.codex/config.toml`. Each prints which capabilities that harness lacks; Specplane refuses an action that needs a missing capability instead of substituting a weaker one. Support per harness is listed in [`docs/user/harnesses.md`](docs/user/harnesses.md).

## Repository layout

```
.specplane/config.yaml          configuration (this repo uses Specplane on itself)
docs/
  requirements/                 the product requirements page (owned by the user)
  specifications/
    features/                   feature specs: what the framework does
    architecture/               architecture specs: how it is built
  user/                         user documentation source (copied into the package)
  work-records/                 dated work records
packages/cli/                   the reference CLI (TypeScript, Node 22+)
harnesses/claude/               Claude Code specs, installed templates, plugin, tests
harnesses/codex/                Codex specs and templates
plans/                          plan records
.claude/                        this repo's own installed copy of the Claude harness
```

## Development

```sh
cd packages/cli && npm run build && sh scripts/test.sh   # build, then the full suite
sh harnesses/claude/tests/hooks.test.sh                  # hook tests
sh harnesses/claude/tests/check-sync.sh                  # .claude/ matches the templates
node packages/cli/dist/cli.js validate                   # must report 0 errors
```

In this repository the Claude CLI-block hook denies agents running the installed `specplane` name; use `node packages/cli/dist/cli.js`.

## License

[Apache-2.0](LICENSE)
