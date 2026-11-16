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

Plan ID: `YYYY-MM-DD-<two to four lower-case words>`, at most 64 characters, equal to the folder name. Archived plans are in `<plans.dir>/archive/<plan-id>/`. `PLAN.md` frontmatter has `id: plan/<plan-id>`, `title`, `authors`, `implements` (specs and the commit each was written against) and `references` (other plans and cites). A step file has `plan`, `step`, `title`, optional `writes`, `implements` and `context`, and the sections Goal, Acceptance criteria and Tasks. A task that starts with `[parallel]` is independent of the `[parallel]` tasks next to it. With `plans.parallelism` above one, a harness with subagents (Claude, Codex) runs such a group at the same time, at most that many at once; steps still run in order, and a harness without subagents runs the tasks one after another and says so. Keep parallel tasks on different files: validation warns when two of them name the same file.

Plan approval is separate from execution. The plan's fingerprint covers `PLAN.md` and every step file, so editing a step returns an approved plan to review. `progress.yaml`, `HANDOFF.md` and `spec-gaps.md` are not part of it. A plan's status is `not-started`, `in-progress`, `stopped`, `completed` or `abandoned`.

## Lifecycle

1. `plan create <words...>` scaffolds the plan. A person approves it with `plan approve <id>`.
2. `plan start <id>` creates the branch and worktree, checks the start conditions (`plans.start_conditions`: the plan and the specs it references are approved) and runs `plans.setup_command`. In Claude Code the typed `/plan-start` also opens the session.
3. When you give a selection of several steps, the harness runs them in a chain without being asked for each: each session does one step, and when it ends cleanly with the step done and steps of the selection left, a new session starts on the next step. The chain ends with the selection or with a recorded stop; a session that fails or ends without finishing its step stops the plan with the failure "step <n> not finished". Each session does one step and records it in `HANDOFF.md`; `plan step-done <id>` records the step and commits it. `plan next <id>` shows the next step and checks a selection (`--selection next`, a count, `all` or `<first>..<last>`; it must start at the next step); `plan status <id>` and `plan list` show live status.
4. `plan stop <id>` stops after the current work; `plan resume <id>` continues. A session that ended without recording a stop is reported as stopped ("session ended unexpectedly"), except that a session which ended cleanly after finishing a step, with steps left, leaves the plan idle: still in progress, with nothing working on it. Resuming an idle plan starts a new selection from the next step.

   `plan retarget <id> --target <branch>` changes the branch the plan merges into, including for a stopped plan whose target branch no longer exists; an unknown branch is refused. It does not resume the plan, and resuming does not retarget. It has its own permission, `plan.retarget` (`request-user` for the LLM in all default presets), so being allowed to resume does not allow a retarget. The harness action `plan.retarget` does the same.
5. `plan budget <id>` sets soft and hard limits on a usage resource (`5h` or `weekly`) as a percent. At the soft limit the session is told to finish; at the hard limit it is stopped.
6. `plan review <id>` opens the final review. `plan finish <id> --complete` completes and archives; `--back <reason>` returns it to progress. `plan merge <id>` merges the branch by pull request or local merge. `plan abandon <id>` archives it and keeps the branch; `plan delete <id>` removes it.
7. `plan meta get <id>` shows a plan's metadata and statuses; `plan meta set <id> <field> <value>` changes its title, authors, references or specifications as an audited override (see `commands`).

A step that finds the spec silent records a gap or assumption in `spec-gaps.md` and goes on. Gaps never block a merge.

## Handoff entry

Each ended step adds one entry to the end of the plan's `HANDOFF.md`, and `plan step-done <id>` refuses a step whose latest entry is missing, has another outcome, or lacks a section; its message prints this form with the step filled in. The heading, the two bold fields and the five `###` sections are all required, in this order; a section with nothing to say reads `None.`. `**Outcome**` is `done` or `partial`. A repeated step adds a new entry and the last one counts.

```markdown
## Step NN: <step title>

**Date**: YYYY-MM-DD
**Outcome**: done | partial

### What changed
- `<path>`: <reason>

### Deviations from the step
None. | <text>

### Gaps found
None. | - G<n> (<kind>): <one line>

### Open issues
None. | - <text>

### What the next step must know
<self-contained facts>
```

## Requests

When a plan session needs an answer that only you can give, or an action whose permission is `request-user`, it makes a request and stops. `requests list` shows what is pending; `requests accept <id>` runs the action once under your permission; `requests decline <id>` changes nothing. Accepting a request that blocks a plan resumes the plan. Accepting a request to start a plan starts it; when you accept it with `/requests accept <id>` in your harness, the plan's session opens for you, and when you accept it with `specplane requests accept <id>` in a terminal nothing opens and the output prints the command that opens the session (for Claude Code, `claude "/specplane-plan-step <plan-id>"` in the plan's worktree). If the harness cannot open sessions, or the launch fails, the request stays accepted and the same command is printed.
