---
id: feature/claude-integration
title: Claude Code integration
status: awaiting-review
authors:
  - llm: claude-sonnet-5-5
    contribution: drafted
covers: []
references: [root:harness R34, root:harness R35, root:plan-execution R27, root:harness §2, root:steering R59, root:harness R47, root:harness R14, root:harness §3, root:verification R24, root:harness R18, root:harness R19, root:harness R20, root:harness R26, root:harness R35.1, root:plan-execution R31.2, root:plan-execution R27.4, root:plan-execution R27.5, root:plan-execution R27.6, root:plans R28]
---

# Claude Code integration

This spec says what Specplane provides inside Claude Code, the harness in which the user and a Claude model work on a project. It adds nothing to the behaviour of `root:harness R34`: every command, permission, steering text and request behaves as the root specs say, and this spec only states how Claude Code delivers them and what it can or cannot do (`root:harness R35`). It covers no requirement of its own, so `covers` is empty (assumption: the page has no requirement for a single harness, so all sections here are `§` sections that refine `root:harness` sections).

## §1 Terms

- **Rules file:** the instruction file Claude Code loads in every session from the project's `.claude/` folder, owned by Specplane.
- **Maintainers' file:** `CLAUDE.md` and any other instruction file the project's maintainers write. Specplane never creates, edits or reorders it.
- **Plan checkout:** the worktree and branch a plan runs in (`root:plan-execution R27`).

## §2 Standing instructions

Refines `root:harness §2`.

- Claude Code receives the standing instructions in every session from the rules file. The text is the same as for any harness: Specplane is in use, read the configuration before acting on specs or plans, look up steering for your role, and do not call the CLI (`root:steering R59`, `root:harness R47`).
- The rules file lists the Specplane slash commands as the way to run workflows. It carries no steering, rules or procedures; those arrive with the command (`root:harness R14`).
- Specplane never writes `CLAUDE.md`. When a project forbids a marked block in a shared file, the rules file is the only delivery (`root:harness §2`). Two harnesses in one project share the same text (`root:harness §3`).
- A missing or older rules file produces a warning (`root:verification R24`).

Scenario: Given a project with a hand-written `CLAUDE.md`, When Specplane is set up for Claude Code, Then `CLAUDE.md` is unchanged and the rules file is added.

Scenario: Given the installed rules file is older than the installed Specplane, When the user validates, Then a warning names the rules file.

## §3 Slash commands

Refines `root:harness R18`, `root:harness R14`, `root:harness R19`, `root:harness R20` and `root:harness R26`.

Claude Code offers one slash command per workflow:

| Command | Purpose |
|---------|---------|
| `/spec-assist` | Write or edit a feature or architecture spec with the user |
| `/spec-draft-architecture` | Draft an architecture spec from feature specs |
| `/plan-create` | Create a plan |
| `/plan-start` | Start a plan in its own checkout and say where to continue |
| `/plan-step` | Run the next step or steps of a plan |
| `/plan-finish` | Review a plan and let the user decide |
| `/plan-status` | Show plans with live status and next step |
| `/plan-abandon` | Abandon a plan after confirmation |
| `/validate` | Run validation and summarise the findings |
| `/verify` | Judge an architecture spec against its implementation |
| `/approve` | Approve specs or plans by ID; only the user can run it |
| `/requests` | Open the pane of pending requests; only the user can run it |

- A command typed without arguments runs without a model turn; with arguments it passes them and the command's instructions to Claude (`root:harness R18`). Asking Claude in plain words runs the same workflow under Claude's own role.
- Instructions for a command are delivered when it is used, once per conversation, and again after compaction (`root:harness R14`). Claude Code loads them on demand as skills where it can.
- Claude Code's own commands, such as `/resume`, are not replaced.
- Decision records and migration add commands in a later release.

Scenario: Given the user types `/plan-status` with no arguments, When it runs, Then the plans are shown and no model turn starts.

Test (deterministic): type a no-argument command and check that no model turn is started.

## §4 Hooks

Refines `root:harness R47`, `root:harness R14` and `root:harness R35.1`.

Claude Code can run a program before or after one of its tool calls. Specplane uses this for four things:

- **No CLI for the model.** A shell command from Claude that runs the Specplane CLI is denied, with a message pointing to the harness actions. Commands typed by the user in their own terminal are not affected. The check is best effort; Specplane says so at setup (`root:harness R35.1`).
- **Session context.** When a session starts in a plan checkout, Claude is told the plan and its next step, and to work only on that step.
- **Compaction.** After Claude Code compacts the conversation, command instructions are sent again at their next use.
- **Commit check (assumption).** A commit made by Claude is blocked while validation reports errors; warnings do not block.

A status line in a plan checkout shows the plan, its step progress and what is waiting (assumption; registered only when the user has no status line). Hooks are registered in the project's Claude Code settings, which the user can also edit. Hooks that stay installed from an older Specplane keep running until the user removes them.

Scenario: Given Claude tries to run `specplane validate` in a shell, When the hook checks it, Then the command is not run and Claude is told to use the `/validate` command.

Test (deterministic): feed the hook shell texts that call the CLI directly, through `env`, `npx` and `sh -c`, and check each is denied; feed an unrelated command and check it is allowed.

## §5 Subagents per step

Refines `root:plan-execution R27` and `root:plan-execution R31.2`.

- A plan step may run as a fresh subagent: one that starts with an empty context and is told where to find the step, the handoff and the context the step names. The parent session keeps only the subagent's summary. Several steps run as a chain, one subagent per step, started by the parent one after another (assumption: matches the maintainers' practice).
- A subagent has the role of the session that started it and works one step only (`root:plan-execution R27.4`).
- A subagent cannot ask the user questions. It records gaps and assumptions, sends requests as non-blocking or blocking (`root:plan-execution R27.5`), or stops, as the root specs say.
- Using subagents is off unless the user or the plan asks for it (assumption).
- For parallel tasks inside a step, Claude uses subagents when parallelism is on and runs tasks one after another otherwise, telling the user (`root:plan-execution R31.2`).

## §6 Worktrees and the cloud

Refines `root:plan-execution R27`, `root:plan-execution R27.6` and `root:plans R28`.

- A plan runs in its own worktree on its own branch, started by `/plan-start`. The user's directory is never switched. The command prints how to open a Claude Code session in the checkout; Claude does not move a running session there (assumption).
- A session in a plan checkout works on that plan only, one step at a time. Plans that are unrelated can run in several sessions at once.
- A Claude Code session in the cloud follows the same rules. Plan execution is required on every supported harness (`root:harness R35.1`), so a cloud session must have the checkout, the Specplane files and the hooks it needs; if one is missing, Specplane says which and does not start the step. Files git does not track are absent in the cloud and the step handles that as the root spec says (`root:plan-execution R27`).
- Each finished step is committed, and a cloud or remote session publishes it so the next session sees it (assumption).

Scenario: Given the user is on `main`, When they run `/plan-start`, Then they stay on `main` and are told which command opens a session in the new checkout.

## §7 Memory

Refines `root:plan-execution R27`.

Claude Code has a per-user memory. It is never the source of truth: a plan's progress lives in its handoff, and memory may only point to it. Specplane recommends three entries, none enforced or validated: the active plan and its last finished step, open questions not yet in the handoff, and spec gaps not yet in the plan's gap record. A memory entry that disagrees with the plan record is stale, and the plan record wins.

## §8 Context loading

Refines `root:harness R26`.

Claude reads specs and plans with `Read` rather than `cat`, finds files with `Glob`, and reads large specs by offset and limit. For several specs and their cited sections it uses one retrieval instead of reading each file (`root:harness R26`).
