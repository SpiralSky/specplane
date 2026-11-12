---
title: Plans
summary: The plan folder format, how a plan is started, stepped, budgeted, reviewed and finished.
related: [commands, permissions, harnesses, verification]
---

# Plans

A plan is optional. It breaks work into steps small enough for one agent session, runs on its own branch `plan/<id>` in its own worktree, and ends with a final review you decide.

## Plan folder

```
<plans.dir>/<plan-id>/
  PLAN.md            metadata and body (goal, scope, specifications, acceptance criteria, steps)
  progress.yaml      execution state: status, branch, done steps, budget, stop reason
  steps/NN-<slug>.md one file per step, numbered from 01 without gaps
  HANDOFF.md         append-only entry per ended step
  spec-gaps.md       gaps and assumptions found while working (created on first entry)
```

Plan ID: `YYYY-MM-DD-<two to four lower-case words>`, at most 64 characters, equal to the folder name. Archived plans are in `<plans.dir>/archive/<plan-id>/`. `PLAN.md` frontmatter has `id: plan/<plan-id>`, `title`, `authors`, `implements` (specs and the commit each was written against) and `references` (other plans and cites). A step file has `plan`, `step`, `title`, optional `writes`, `implements` and `context`, and the sections Goal, Acceptance criteria and Tasks. A task that starts with `[parallel]` is independent of the `[parallel]` tasks next to it. With `plans.parallelism` above one, a harness with subagents (Claude) runs such a group at the same time, at most that many at once; steps still run in order, and a harness without subagents (Codex) runs the tasks one after another and says so. Keep parallel tasks on different files: validation warns when two of them name the same file.

Plan approval is separate from execution. The plan's fingerprint covers `PLAN.md` and every step file, so editing a step returns an approved plan to review. `progress.yaml`, `HANDOFF.md` and `spec-gaps.md` are not part of it. A plan's status is `not-started`, `in-progress`, `stopped`, `completed` or `abandoned`.

## Lifecycle

1. `plan create <words...>` scaffolds the plan. A person approves it with `plan approve <id>`.
2. `plan start <id>` creates the branch and worktree, checks the start conditions (`plans.start_conditions`: the plan and the specs it references are approved) and runs `plans.setup_command`. In Claude Code the typed `/plan-start` also opens the session.
3. Each session does one step and records it in `HANDOFF.md`; `plan step-done <id>` records the step and commits it. `plan next <id>` shows the next step; `plan status <id>` and `plan list` show live status.
4. `plan stop <id>` stops after the current work; `plan resume <id>` continues. A session that ended without recording a stop is reported as stopped.
5. `plan budget <id>` sets soft and hard limits on a usage resource (`5h` or `weekly`) as a percent. At the soft limit the session is told to finish; at the hard limit it is stopped.
6. `plan review <id>` opens the final review. `plan finish <id> --complete` completes and archives; `--back <reason>` returns it to progress. `plan merge <id>` merges the branch by pull request or local merge. `plan abandon <id>` archives it and keeps the branch; `plan delete <id>` removes it.
7. `plan meta get <id>` shows a plan's metadata and statuses; `plan meta set <id> <field> <value>` changes its title, authors, references or specifications as an audited override (see `commands`).

A step that finds the spec silent records a gap or assumption in `spec-gaps.md` and goes on. Gaps never block a merge.

## Requests

When a plan session needs an answer that only you can give, or an action whose permission is `request-user`, it makes a request and stops. `requests list` shows what is pending; `requests accept <id>` runs the action once under your permission; `requests decline <id>` changes nothing. Accepting a request that blocks a plan resumes the plan.
