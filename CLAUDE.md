# Specplane — Claude Code harness

This repository uses Specplane for spec and plan management.

## Workflow

See [AGENTS.md](AGENTS.md) for the full Specplane workflow. Policy lives in `.specplane/config.yaml`; read it before acting on specs or plans.

## Slash commands

| Command | Purpose |
|---------|---------|
| `/spec-assist` | Help write a feature spec (does not draft it) |
| `/spec-draft-architecture` | Draft an architecture spec from feature specs |
| `/plan-create` | Create a new plan |
| `/plan-step` | Execute the next step of the current plan |
| `/plan-finish` | Run the finish flow for the current plan |
| `/validate` | Run `specplane validate` and summarise results |

## Conventions

- Read spec and plan files with `Read` (use offset/limit for large specs); find files with `Glob`, not `ls`/`find`.
- HANDOFF.md is the source of truth for plan progress; memory is only a pointer to it.

## Permissions

The following commands require approval on first use and are safe to allow for this project:
- `Bash(specplane:*)`
- `Bash(git worktree:*)`, `Bash(git branch:*)`, `Bash(git switch:*)`
