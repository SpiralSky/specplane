# Specplane

**Specs and plans for AI-assisted development, kept as plain markdown in your repo.**

Specplane is a set of file conventions, a reference CLI, and agent instructions. You write down *what* a project should do and *how* it is built. Agents then carry the work out one small, reviewable step at a time, on git branches, without losing track of the specs.

> **Status:** v0.1.0. The format specs, the reference CLI and the Claude Code harness are all implemented, and this repository uses Specplane to manage itself. Nothing is published to npm yet, so install from source (see [Install](#install)).

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
    steps/
      01-architecture-spec-edits.md
      02-feature-spec-proposals.md
      ...
  archive/                      # done and abandoned plans
```

- **Lifecycle:** `draft → ready → in_progress → review → done`, or `abandoned`. By default `in_progress` and `review` are worked out from git and the forge (branch and PR state) rather than written into the files. That way, progress doesn't require commits to `main`.
- **Steps** list in their frontmatter exactly which spec sections they need as context. A step can be marked `blocked` when an unattended agent hits a contradiction.
- **The finish flow** checks readiness, runs your test command, rebases, commits the "done + archive" change, then opens a PR or merges locally, and cleans up the worktree.
- **Stacking:** a plan may build on one unmerged dependency. `plan restack` moves it onto the new base once the dependency changes.

Every commit Specplane makes follows Conventional Commits and carries `Specplane-*` trailers, so the history records which plan and step produced it.

---

## Install

Requirements: **Node.js 20+** and **git**. The `gh` CLI is optional, for GitHub PR support.

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
| `specplane search <text>` | Search specs and plans. |
| `specplane spec new <type> <slug>` | Create a draft spec. |
| `specplane spec list` / `show <id>` | List specs, or print one. |
| `specplane spec validate [ids...]` | Validate one, several or all specs. |
| `specplane spec pin [--check]` | Write or check base pins (`based_on`). |
| `specplane plan new` | Create a draft plan folder. |
| `specplane plan list [--live]` | List plans with their effective statuses. |
| `specplane plan show <id>` / `graph` | Print a plan, or the Mermaid dependency graph. |
| `specplane plan start <id>` | Start or resume a plan: branch, worktree and setup hook. |
| `specplane plan finish <id>` | Run the finish flow. |
| `specplane plan restack <id>` | Rebase a stacked plan onto its new base. |
| `specplane plan abandon` / `cleanup` / `archive <id>` | Wind a plan down and tidy up afterwards. |

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
    llm_role: assist        # none | assist | draft: what agents may do
    forbid_architecture: true
  architecture:
    authorship: either
    llm_role: draft
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

- **Slash commands:** `/spec-assist`, `/spec-draft-architecture`, `/plan-create`, `/plan-step`, `/plan-finish`, `/validate`.
- **Policy guard hook:** enforces `llm_role` on every edit. `none` denies the edit, `assist` asks you first, and `draft` allows it.
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
packages/cli/                   the reference CLI (TypeScript, Node 20+)
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
