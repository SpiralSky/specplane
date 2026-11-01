# Specplane

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](https://nodejs.org/)

**Specs and plans for AI-assisted development — structured markdown that keeps agents on track.**

Specplane is a set of file conventions, a reference CLI, and agent harness. You write down *what* a project should do and *how* it is built. Agents then carry the work out one small, reviewable step at a time, on git branches, without losing context or rewriting things nobody asked them to touch.

> **Status:** v0.1.0. The format specs, the reference CLI, and the Claude Code harness are all implemented, and this repository uses Specplane to manage itself. Nothing is published to npm yet — install from source (see [Install](#install)).

---

## Why Specplane

AI agents are fast, but they lose context, drift from the design, and rewrite things nobody asked them to touch. Specplane addresses this with structure that lives in your repo:

- **Specs say what to build.** Feature specs describe behaviour. Architecture specs describe the implementation. Each spec type has its own authorship rules: for example, an agent may suggest changes to a feature spec but not write one.
- **Plans say how to get there.** A plan is a unit of work that depends on other plans. It runs on its own branch and is split into steps small enough for one agent session each.
- **Everything is markdown.** No database and no service. Every piece of state is a committed file that you can read, diff and review.

## Core principles

| Principle | What it means |
|-----------|---------------|
| Markdown is the source of truth | All state lives in committed markdown. |
| Zero tooling required | A human or an agent can follow the framework by hand. The CLI is a convenience. |
| The format is the product | The core deliverable is a language-agnostic format specification. |
| Context economy | Plans are split into steps, so each agent session loads only what it needs. |
| Configurable safeguards | Every policy has a sensible default and can be changed. |
| Merge-friendly | Parallel plans on separate branches don't cause routine conflicts. |

---

## How it works

```
 feature specs ──►  architecture specs ──►  plan ──►  steps ──►  merged code
 (what)             (how)                   (branch   (one agent
                                            plan/<id>) session each)
```

### Specs

Specs are markdown files with YAML frontmatter. They live under one or more **spec roots**.

```yaml
---
id: feature/plan-system
title: "Plan system: layout, IDs, PLAN.md, and dependencies"
status: approved          # draft → review → approved → deprecated
author: mixed
---
```

- **Precedence:** during implementation, the architecture spec wins and the feature spec fills the gaps. When two specs contradict each other, the agent stops and reports it.
- **Overlays:** a spec root can `extend` another one. For example, the Claude Code harness specs extend the base specs.
- **Base pins:** a spec can pin the specs it is based on (`based_on`) to their git blob hashes. If a pinned spec changes, Specplane warns and blocks approval until the pin is refreshed.
- **Leak guard:** optionally warns when implementation details turn up in a feature spec.

### Plans

Each plan is a folder:

```
plans/
  PLANS.md                      # generated index, with a Mermaid dependency graph
  2026-10-29-cli-spec-search/
    PLAN.md                     # goal, scope, linked specs, depends_on
    HANDOFF.md                  # progress log: the source of truth for "where are we"
    spec-gaps.md                # gap, assumption, and proposal records (created when needed)
    steps/
      01-architecture-spec-edits.md
      02-feature-spec-proposals.md
      ...
  archive/                      # done and abandoned plans
```

- **Lifecycle:** `draft → ready → in_progress → review → done`, or `abandoned`. By default `in_progress` and `review` are worked out from git and the forge (branch and PR state) rather than written into the files. That way, progress doesn't require commits to `main`.
- **Steps** list in their frontmatter exactly which spec sections they need as context. A step can be marked `blocked` when an unattended agent hits a contradiction.
- **Gap records:** when the architecture spec is silent, the step records a `gap`, `assumption`, or `proposal` entry in the plan's `spec-gaps.md` and lists its ID in `HANDOFF.md`. The finish flow lists open entries for review; they never block the merge.
- **The finish flow** checks readiness, runs your test command, rebases, commits the "done + archive" change, then opens a PR or merges locally, and cleans up the worktree.
- **Stacking:** a plan may build on one unmerged dependency. `plan restack` moves it onto the new base once the dependency changes.

Every commit Specplane makes follows Conventional Commits and carries `Specplane-*` trailers, so the history records which plan and step produced it.

---

## Install

Requirements: **Node.js 22+** and **git**. The `gh` CLI is optional, for GitHub PR support.

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
specplane init                      # creates .specplane/config.yaml, the spec roots and plans/
specplane spec new feature login    # creates a draft feature spec
specplane plan new --title "Login" --specs feature/login   # creates a draft plan folder
specplane validate                  # checks specs, plans, pins and policies
specplane plan start <plan-id>      # creates branch plan/<id> and its worktree
specplane plan finish <plan-id>     # tests, rebase, archive, merge
```

## CLI reference

| Command | What it does |
|---------|--------------|
| `specplane init [--harness claude]` | Set up Specplane in a repository, and optionally install an agent harness. |
| `specplane validate [--json]` | Validate the whole repository (it also runs as a pre-commit hook). |
| `specplane generate [--print] [--live]` | Regenerate `plans/PLANS.md`. |
| `specplane search <text> [--kind spec\|plan]` | Search specs and plans. |
| `specplane spec new <type> <slug>` | Create a draft spec. |
| `specplane spec list` / `show <id>` | List specs, or print one. |
| `specplane spec validate [ids...]` | Validate one, several or all specs. |
| `specplane spec pin [--check]` | Write or check base pins (`based_on`). |
| `specplane spec approve <id>...` / `reopen <id>` | Approve specs (re-pinning an overlay's bases) or set one back to `review`; `--dry-run` prints the plan. |
| `specplane plan new` | Create a draft plan folder. |
| `specplane plan list [--live] [--no-fetch]` | List plans with their effective statuses and activity. |
| `specplane plan show <id>` / `graph` | Print a plan, or the Mermaid dependency graph. |
| `specplane plan approve <id>...` | Set a `draft` plan to `ready` and regenerate `PLANS.md`; `--dry-run` prints the plan. |
| `specplane plan start <id> [--no-fetch]` | Start or resume a plan: branch, worktree and setup hook. |
| `specplane plan finish <id> [--no-fetch]` | Run the finish flow. |
| `specplane plan restack <id> [--dry-run]` | Rebase a stacked plan onto its new base; `--dry-run` lists the commits that would be replayed. |
| `specplane plan abandon` / `cleanup` / `archive <id>` | Wind a plan down and tidy up afterwards. |
| `specplane decision new <title>` / `accept <id>...` | Create a decision record with the next free number, or accept a `proposed` one. |

Run `specplane <command> --help` for the options of each command.

## Configuration

Everything is configured in `.specplane/config.yaml`. An excerpt:

```yaml
spec_roots:
  - name: base
    path: docs/specifications

specs:
  feature:
    authorship: user        # humans write feature specs
    llm_role: assist        # review | assist | draft | none: what agents may do
    forbid_architecture: true
  architecture:
    authorship: either
    llm_role: draft         # review | assist | draft | none
    require_approved_features: true

plans:
  dir: plans
  require_approved_specs: feature
  status_source: git        # or: frontmatter
  merge: local_merge        # or merge through a forge PR
  dependency_mode: wait_for_merge
```

The full list of settings and their defaults is in [`feature/configuration`](docs/specifications/features/configuration.md).

---

## Claude Code integration

```sh
specplane init --harness claude
```

This installs everything into your repository's `.claude/` folder. It is all plain repository content, so it also works in Claude Code cloud sessions.

- **Slash commands:** `/spec-assist`, `/spec-draft-architecture`, `/plan-create`, `/plan-step`, `/plan-finish`, `/validate`, `/approve`, `/plan-start`, `/decision-new`, `/plan-status`, `/plan-abandon`.
- **Policy guard hook:** enforces `llm_role` on every edit. `none` denies the edit; `review` and `assist` ask you first; `draft` allows it. It also denies any agent edit that sets a spec to `approved`, a plan to `ready`, or a decision record to `accepted` — those go through `/approve`.
- **Session context hook:** in a plan checkout, tells the agent which plan and step it is on.
- **Pre-commit validation** and a **status line**.
- **Standing instructions** in `.claude/rules/specplane.md` and a managed block in `AGENTS.md`. Specplane never edits your `CLAUDE.md`.

There is also an **optional plugin** (`harnesses/claude/plugin/`) that adds a live plans pane and a step/spec mode. It works only in local sessions, and nothing depends on it. Until it is published through a marketplace, load it directly:

```sh
claude --plugin-dir path/to/specplane/harnesses/claude/plugin
```

Other agents can follow the instructions in the `AGENTS.md` block and the workflow contracts in [`architecture/agent-skills`](docs/specifications/architecture/agent-skills.md).

---

## Repository layout

```
.specplane/config.yaml          configuration (this repo uses Specplane on itself)
docs/
  specifications/
    features/                   feature specs: what the framework does
    architecture/               architecture specs: how it is built
  decisions/                    architecture decision records (ADRs)
  OPEN-QUESTIONS.md             design questions and their resolutions
packages/cli/                   the reference CLI (TypeScript, Node 22+)
harnesses/claude/
  specifications/               Claude Code–specific specs (overlay on the base specs)
  templates/                    files that `init --harness claude` installs
  plugin/                       the optional plans-pane plugin
  tests/                        hook and template-sync tests
plans/                          implementation plans; PLANS.md is generated
.claude/                        this repo's own installed copy of the harness
```

## Further reading

The specs are the documentation. Good places to start:

- [`feature/spec-system`](docs/specifications/features/spec-system.md): specs, IDs, frontmatter and lifecycle.
- [`feature/plan-system`](docs/specifications/features/plan-system.md): the plan layout and dependencies.
- [`feature/plan-execution`](docs/specifications/features/plan-execution.md): starting, stepping through and finishing plans.
- [`architecture/file-formats`](docs/specifications/architecture/file-formats.md): exact file formats and commit conventions.

## Development

```sh
cd packages/cli && npm test                 # CLI test suite
sh harnesses/claude/tests/hooks.test.sh     # hook tests
sh harnesses/claude/tests/check-sync.sh     # .claude/ matches the templates
specplane validate                          # must report 0 errors
```

## License

[Apache-2.0](LICENSE)

## Experimental Codex / Dot cloud integration

On the unmerged environment-integration branch, build the CLI (`cd packages/cli && npm ci && npm run build`) and invoke its verified local binary or `node /absolute/specplane-checkout/packages/cli/dist/cli.js`.

- `specplane init --harness codex` installs repository-local `.agents/skills/specplane/SKILL.md` plus the managed AGENTS.md block. It preserves existing differing skills and user-owned text/settings; it does not modify Codex/Claude configuration, install MCP, or grant permissions.
- `specplane init --harness none` explicitly suppresses all harness auto-detection, including an existing `.claude/` directory.
- The Codex/Dot agent follows that skill and uses the CLI for read/validate/draft/status operations, then implements and tests in its authorized isolated checkout. Experimental development authorization is recorded separately; draft/review statuses are not promoted.
- Final plan approval, finalization, and merge remain human decisions. No general approval-bypass mode is added.
- This is a **CLI workflow integration**, not a live Codex background adapter. `plan run --harness codex` refuses rather than passing Claude flags to Codex. Existing Claude integration remains separate and capability-checked.

See `docs/specifications/architecture/codex-integration.md` (draft) and `docs/work-records/2026-11-01-codex-integration.md` for measured verification and limits.
