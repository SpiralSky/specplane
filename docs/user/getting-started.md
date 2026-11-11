---
title: Getting started
summary: Set up a repository, write a first spec, validate and approve it.
related: [concepts, commands, harnesses]
---

# Getting started

Specplane needs Node.js 22 or later and git. Install from a source checkout:

```sh
cd packages/cli
npm install
npm run build
npm install -g --prefix ~/.local .
```

## First steps in a project

```sh
cd your-project
specplane init --harness claude   # notes refspecs and the Claude Code files; or --harness codex
specplane validate                # format, citations, requirement IDs, status
specplane spec list               # every spec with its effective status
specplane spec approve feature/login
specplane warnings
```

1. Write your requirements as markdown in `docs/requirements/` (see `specification-format`). A requirement file never needs approval.
2. Write a feature spec in `docs/specifications/features/<slug>.md` with the frontmatter described in `specification-format`; cite the requirements it covers.
3. Run `validate`. A new spec is `awaiting-review` until it is approved.
4. A person runs `spec approve <id>`. Approval is bound to the content: change the spec, or a part it cites, and it returns to `awaiting-review` with a reason.
5. Write an architecture spec that implements the feature spec; when its declared checks pass, `spec implement <id>` records that it is implemented (see `verification`).

Plans are optional. Use them when you want an agent to work through steps on its own branch (see `plans`).

## Where things live

Specs and requirements are tracked files. Approvals, test results and implementation records are git notes under `refs/notes/specplane`; share them with `sync`. Requests, the audit log and test logs are local to your machine. Settings are in `.specplane/config.yaml` (see `configuration`).
