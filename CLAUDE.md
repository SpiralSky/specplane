# Specplane — maintainers' Claude Code notes

This is the maintainers' own file; Specplane never writes or ships a `CLAUDE.md`. Standing Specplane instructions live in `.claude/rules/specplane.md` and `AGENTS.md`; read `.specplane/config.yaml` before acting on specs or plans.

## Slash commands

| Command | Purpose |
|---------|---------|
| `/spec-assist` | Help write a feature spec (does not draft it) |
| `/spec-draft-architecture` | Draft an architecture spec from feature specs |
| `/plan-create` | Create a new plan |
| `/plan-step` | Execute the next step of the current plan |
| `/plan-finish` | Run the finish flow for the current plan |
| `/validate` | Run `specplane validate` and summarise results |

## Maintainers' conventions

- The repo-root `HANDOFF.md` is the human session log; a plan's progress lives in `<plans.dir>/<plan-id>/HANDOFF.md`.
- `.claude/` is the dogfood install of `harnesses/claude/templates/`; edit the templates and copy them over, then run `sh harnesses/claude/tests/check-sync.sh`.
- Hook tests: `sh harnesses/claude/tests/hooks.test.sh`.

## Permissions

Safe to allow for this project: `Bash(specplane:*)`, `Bash(git worktree:*)`, `Bash(git branch:*)`, `Bash(git switch:*)`.
