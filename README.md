# Specplane

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](https://nodejs.org/)

**Write down what your project should do, get it reviewed, and keep your AI coding agents inside the lines.**

Specplane is spec-driven development for projects where an AI agent writes some, or most, of the code. You keep your requirements and specifications as plain markdown in the repository. Specplane tracks who approved them, what has been built, and what evidence says it works. It works with [Claude Code](https://claude.com/claude-code) and Codex.

Writing a spec is the easy part. What this adds is the memory around it: which version was approved, by whom, and whether the code and tests still match it. You decide how much an agent may do on its own, from "ask me first" to "go ahead", and everything it does is recorded.

## Why

Anyone who has turned an agent loose on a repository knows the pattern. It does something plausible, and you find out later that it wasn't what you meant. A longer prompt doesn't fix that. A written description of what the project should do, one that you reviewed and the agent works from, does.

That is all Specplane adds: a structure for that description, a record of who approved it, and a way to check that the code still matches it. There is no service to run and nothing hidden. The specs are markdown files in your repo, and the records live in git.

## What you get

- **Three layers of specs.** Requirements say what the product must do, feature specs describe behaviour, and architecture specs describe how it is built. Each layer cites the one above it.
- **Approval that follows the content.** A spec's status is computed, never typed into the file. Change a spec, or something it cites, and it goes back to review with the reason. Approvals, test results and implementation records live in git notes, so they travel with `specplane sync` and survive rebases.
- **Clear limits for the agent.** Every permission is `allow`, `request-user` or `deny`, set per role. When an agent hits a `request-user` action, it files a request and you accept or decline it. An agent uses the same operations through the harness (an MCP server) instead of running the CLI, and the harness blocks it from running the CLI itself.
- **Evidence kept apart from claims.** Tests declared in a spec run against committed content. Results are tied to the spec's fingerprint and go stale when it changes. An architecture spec is only marked implemented once its checks pass.
- **Plans, if you want them.** A plan is a folder of small steps that an agent works through on its own branch, with budgets, soft and hard stops, and a final review. Skip them if you only want the specs.

## A quick look

A spec is a markdown file with a little frontmatter, and a requirement is a short marker in a requirements file. This is a real run of [`docs/demo/demo.sh`](docs/demo/demo.sh), trimmed:

```console
$ specplane spec list
feature/login                     awaiting-review (never-approved)
requirement/product-requirements  approved

$ specplane spec approve feature/login
Approved feature/login as Demo (notes commit 583f96e).

# ...later, someone edits the spec and commits...

$ specplane spec list
feature/login                     awaiting-review (edited)
requirement/product-requirements  approved
```

Approval is tied to what you actually reviewed, so an edited spec stops counting as approved until someone approves the new text. That holds for an agent's edits too, and it's the whole point. Run `sh docs/demo/demo.sh` to watch it happen in a throwaway folder.

## Install

You need **Node.js 22+** and **git 2.32+**. The `gh` CLI is optional and only used for pull requests.

```sh
npm install -g specplane
```

Or build it from source, which is also how you work on Specplane itself:

```sh
git clone https://github.com/SpiralSky/specplane.git
cd specplane/packages/cli
npm install
npm run build
npm install -g --prefix ~/.local .   # puts `specplane` on your PATH (if ~/.local/bin is on it)
```

Then, in your own project:

```sh
cd your-project
specplane init --harness claude   # or --harness codex; leave it out to skip the harness
specplane validate
specplane warnings
```

`specplane --help` lists every command. The full documentation also ships with the tool: `specplane docs` reads it offline and `specplane docs search <text>` searches it.

## Working with an agent

`specplane init --harness claude` sets up Claude Code: rules, skills, hooks and the Specplane MCP server. `specplane init --harness codex` sets up Codex with a skill, an `AGENTS.md` block and the same server. From then on the agent calls Specplane through the harness, and your permission settings decide what it may do on its own.

When the agent needs your say-so, it files a request. In Claude Code, with the optional plugin, that opens an approve-or-decline dialogue right in the session, and it can ping your phone through Remote Control if you're away. The plugin lives in this repository and isn't part of the npm package, so you build it from source to use it (see [`harnesses`](docs/user/harnesses.md)). In Codex, or without the plugin, you answer in a terminal with `specplane requests accept <id>`. What each harness supports is listed in [`harnesses`](docs/user/harnesses.md).

## Documentation

The user documentation lives in [`docs/user/`](docs/user/) and is bundled into the package, which is what `specplane docs` reads.

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

For CI, run `specplane validate --json` on the checked-out commit and fail the job on a non-zero exit. See [`verification`](docs/user/verification.md#continuous-integration).

## Status

Specplane is published on [npm](https://www.npmjs.com/package/specplane). It works and it's tested, but it's young and the details may still change. This repository uses Specplane to describe itself: its product requirements are in [`docs/requirements/product-requirements.md`](docs/requirements/product-requirements.md), and the feature and architecture specs are under `docs/specifications/`. If you try it, issues are welcome.

## Developing Specplane

```sh
cd packages/cli && npm run build && sh scripts/test.sh   # build, then the full suite
sh harnesses/claude/tests/hooks.test.sh                  # hook tests
sh harnesses/claude/tests/check-sync.sh                  # .claude/ matches the templates
node packages/cli/dist/cli.js validate                   # must report 0 errors
```

In this repository the Claude hook that blocks the CLI denies agents running the installed `specplane` name. Use `node packages/cli/dist/cli.js` there.

<details>
<summary>Repository layout</summary>

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

</details>

## License

[Apache-2.0](LICENSE)
