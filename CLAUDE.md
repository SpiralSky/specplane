# Specplane — maintainers' Claude Code notes

This is the maintainers' own file; Specplane never writes or ships a `CLAUDE.md`. Standing Specplane instructions live in `.claude/rules/specplane.md` and `AGENTS.md`; read `.specplane/config.yaml` before acting on specs or plans.

## Slash commands

| Command | Purpose |
|---------|---------|
| `/spec-assist` | Write a feature spec with the user (refine-then-write under `assist`; review-only under `review`) |
| `/spec-draft-architecture` | Draft an architecture spec from feature specs |
| `/plan-create` | Create a new plan |
| `/plan-step` | Execute the next step of the current plan |
| `/plan-finish` | Run the finish flow for the current plan |
| `/validate` | Run `specplane validate` and summarise results |
| `/approve` | Approve specs, plans, or decision records by ID; `--reopen` reopens a spec. User-invoked only |
| `/plan-start` | Start a plan and report where to continue it |
| `/decision-new` | Create a decision record, optionally written from your description |
| `/plan-status` | Show plans with live status and the next step |
| `/plan-abandon` | Abandon a plan after confirmation |

## Maintainers' conventions

- The repo-root `HANDOFF.md` is the human session log; a plan's progress lives in `<plans.dir>/<plan-id>/HANDOFF.md`.
- `.claude/` is the dogfood install of `harnesses/claude/templates/`; edit the templates and copy them over, then run `sh harnesses/claude/tests/check-sync.sh`.
- Hook tests: `sh harnesses/claude/tests/hooks.test.sh`.
- Commit regularly without being asked: after each coherent unit of work (a resolved question, a spec or plan edit, a passing fix) and before ending a session, so `main` is never left with a large uncommitted diff. Keep commits small and single-purpose, follow `file-formats` §8, and stage specific paths, not `git add -A` of the whole tree. Never push or rewrite history unless asked. Keep the repo-root `HANDOFF.md` "Current state" accurate in the same commit.

## Permissions

Safe to allow for this project: `Bash(specplane:*)`, `Bash(git worktree:*)`, `Bash(git branch:*)`, `Bash(git switch:*)`.
