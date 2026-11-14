<!-- Specplane command contract v0.1.0; source: architecture/agent-skills §7 -->
# plan-step

## Purpose

Execute the next selected plan steps in order, one at a time (`plan-execution R27`, `R27.4`, `plans R28`).

## Preconditions

Configuration must be present at HEAD. Stop with the reason and no change if a precondition fails. The adapter checks required capabilities and refuses missing capabilities by name. Instruction loading on demand is preferred when supported; otherwise use instruction injection. Typed commands without arguments run only mechanical steps and start no model turn; arguments accompany this contract under the acting role. Plain-language requests use the LLM role, never the user role.

The session must be in the plan worktree on plan/<id>; otherwise name the required checkout and stop. A selection cannot skip unfinished steps. Tasks marked `[parallel]` run at the same time only on a harness with subagents; configured budgets require usage-measurement. With no arguments show only the next step and how to run it, with no model turn.

## Steps

1. [code] `config.get`: read .specplane/config.yaml from HEAD and resolve every path from it. If configuration is absent, say Specplane is not set up and stop without changes.
2. [code] `plan.resume`: only when stopped, retrieve the next step, handoff and answered requests; inspect previous session logs only after a hard stop or unexpected end. `plan.budget`, if requested, sets resource/soft/hard limits and refuses unmeasurable resources.
3. [code] `plan.next`: select starting at the next unfinished step. A waiting step names the unapproved specification it needs; use `plan.softstop` rather than skipping it. It also returns the step's `tasks`: the groups of tasks, the concurrency and a note when tasks must run one after another; tell the user that note.
4. [code] `spec.retrieve`: retrieve the step context cites and implements working set in one call; read only missing parts directly. Use the earlier handoff entries returned with the plan context.
5. [llm] Check changes to references newer than the recorded commits. Implement one step; run each parallel group of `tasks` through subagents, at most `concurrency` at a time, each with only its own task and the step's context, and run every other task yourself, group by group in order. Subagents change only the files of their task and never write the handoff, progress or `plan.*` actions: you collect their summaries, then record the step once. Without subagents or with `concurrency` 1 run the tasks one after another. Record gaps and assumptions in spec-gaps.md. Follow Requirements > Feature > Architecture and report conflicts; same-layer contradictions stop the affected work.
6. [code] `spec.edit`: route any needed specification change through its permission. `request.send` records an exact requested action without performing it. Prefer blocking when unsure: the blocking request soft-stops with its ID, then write a partial handoff and end. For non-blocking requests record the ID in Open issues and continue only independent work within the current step; never skip an unfinished step.
7. [code] `test.run` and `test.record`: run declared checks against committed state and record results and concise reasons without private data.
8. [llm] Append the handoff entry to the end of `HANDOFF.md` in the plan's folder before `plan.step-done`, in exactly this form: heading `## Step NN: <title>` with the two-digit step number, the two bold fields, and all five `###` sections in this order, each non-empty (write `None.` when there is nothing). `**Outcome**` is `done` or `partial`. A repeated step adds a new entry; never edit an earlier one. `plan.step-done` refuses any other form and prints this template with the step filled in.

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

   At a budget soft stop reach a safe point, commit and write a partial entry; never wait open for a user answer.
9. [code] `plan.step-done`: record the outcome after the handoff and at least one step commit; the action makes an entry-only commit if necessary and commits progress. If the harness records completion itself, do not call it twice. For a block or budget stop use `plan.softstop` with the reason and what must change; end the run.
10. [code] `plan.next`: repeat only for further selected steps after completing this one. After the last step use `plan.review` and the plan-finish contract, never automatic completion.

## Permissions and requests

`config.get` needs no permission; reads, next-step lookup, review and test runs use `info.retrieve`; spec edits use `spec.edit.<type>`; results use `test.record`; stopping uses `plan.softstop`; resuming and budgeting use `plan.resume` and `plan.budget`. `plan.step-done` has execution-state checks and no separate permission.

Every action checks its permissions in code. Allow acts directly unless custom steering asks for a request first. Request-user sends the exact action through `request.send`, writes nothing first, and ends outside a plan with the pending request ID. Deny refuses, names the permission, and permits no retry by another tool, role or direct edit. The LLM cannot accept or decline requests or switch roles. Never edit approval or execution status into a file.

## Output

Report outcome, files changed, tests, gap IDs, open issues, requests and the next step. More documentation is available through `docs.search`; search it when information is missing rather than guessing.
