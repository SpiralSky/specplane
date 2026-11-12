---
title: Commands
summary: Every specplane command, its arguments and the permission it needs.
related: [permissions, specification-format, plans, verification]
---

# Commands

These are the commands a person types. An LLM does not run them: in a harness it uses the harness actions (the Specplane MCP tools) and the `/` commands of the harness. Run `specplane <command> --help` for the options of one command; `--json` on most commands gives machine-readable output.

A command that changes something checks the permission of your role first (see `permissions`). Reading information needs no permission for a person. Every command, reads included, is written to the audit log (see `verification`).

<!-- note: group-approval -->
**Group approval.** Specs that cite each other, directly or through other specs, are approved together in one `spec approve` command. The command warns you and lists the specs being approved together. It fails, and approves none of them, if any member cannot be approved, for example because it cites a part of a specification that no longer exists.

Approving writes one approval record per spec into the git notes store (`refs/notes/specplane`); it creates no commit on your branch. Use `specplane sync` to share the records with a remote.

### `plan create`

`specplane plan create [options] <words...>`

Scaffold a plan named <today>-<two to four words>

### `plan approve`

`specplane plan approve [options] <id>`

Approve a plan (a person only; committed content)

### `plan list`

`specplane plan list [options]`

List plans with their statuses and next steps

### `plan status`

`specplane plan status [options] <id>`

Show a plan's live status and next step

### `plan next`

`specplane plan next [options] <id>`

Show the next step and check a selection (read-only)

### `plan start`

`specplane plan start [options] <id>`

Start a plan in its own worktree on branch plan/<id>

### `plan step-done`

`specplane plan step-done [options] <id>`

Record a step from its handoff entry and commit it

### `plan stop`

`specplane plan stop [options] <id>`

Stop a plan (soft stop)

### `plan resume`

`specplane plan resume [options] <id>`

Resume a stopped plan and print what the new session reads

### `plan retarget`

`specplane plan retarget [options] <id>`

Choose a new target branch for a started plan

### `plan budget`

`specplane plan budget [options] <id>`

Set or remove a budget for a resource (percent of the limit)

### `plan review`

`specplane plan review [options] <id>`

Open the final review

### `plan finish`

`specplane plan finish [options] <id>`

Decide the final review: --complete (archives) or --back <reason>

### `plan merge`

`specplane plan merge [options] <id>`

Merge a completed plan's branch by pull request or local merge

### `plan abandon`

`specplane plan abandon [options] <id>`

Abandon a plan: archive it, remove its worktree, keep its branch

### `plan meta get`

`specplane plan meta get [options] <id>`

Show a plan's metadata, approval and execution status. Needs `plan.meta.read`. Shows the title, authors, specifications the plan implements or writes, references, approval, execution status (and stop reason), current step, done steps, branch, target branch, session and budget. `--json` prints the same as data.

### `plan meta set`

`specplane plan meta set <id> <field> <value>`

Set `title`, `authors`, `references` or `implements` of a plan, committing the change to PLAN.md on the plan's branch. Needs `plan.meta.write.<field>` or `plan.meta.write`, whichever is more permissive. Lists are comma separated and an empty value clears the field. Authors look like `human:<name>` or `llm:<model>`, optionally followed by `|<contribution>`; `implements` items are `<spec>` or `writes:<spec>` and each spec must exist. Execution status and progress cannot be set here; they change through the plan commands. An archived, completed or abandoned plan cannot be changed. The change is recorded in the audit log with the old and new values. Changing the title, references or specifications changes the plan's content, so the plan is Awaiting Review again until it is approved.

### `plan delete`

`specplane plan delete [options] <id>`

Delete a plan

### `harness run`

`specplane harness run [options] <command> [args...]`

Run a harness command as the person who typed it, with no model call (refuses anything outside the harness command list)

### `harness compact`

`specplane harness compact [options] <session>`

Record that a harness session's context was compacted so its instructions are delivered again (called by the harness compaction hook)

### `mcp`

`specplane mcp [options]`

Serve the Specplane MCP server on stdio (started by a harness adapter, not by hand)

### `steering`

`specplane steering [options] <target>`

Show complete generated LLM steering for a command, permission, or role

### `spec implement`

`specplane spec implement [options] <id>`

Verify committed architecture content and mark implemented when every check passes

### `spec approve`

`specplane spec approve [options] <ids...>`

Approve specs by ID (committed content only; a group is approved together)

### `spec reopen`

`specplane spec reopen [options] <id>`

Set a spec back to awaiting review

### `spec meta get`

`specplane spec meta get [options] <id>`

Show metadata, with overrides marked

### `spec meta set`

`specplane spec meta set [options] <id> <field> <value>`

Set title, authors, covers, implements or references (lists are comma separated; authors are human:<name> or llm:<model>)

### `spec override status`

`specplane spec override status [options] <id> <status>`

Set status by hand: approved or awaiting-review

### `spec override approver`

`specplane spec override approver [options] <id> <approver>`

Set the approver: human:<name> or llm:<model>@<human>

### `spec override approval-commit`

`specplane spec override approval-commit [options] <id> <commit>`

Set the commit shown as the approved one (display only)

### `spec override test`

`specplane spec override test [options] <id> <test> <result>`

Set a test result (passed, failed) or clear it

### `spec list`

`specplane spec list [options]`

List specs with effective status, authors, current results and implementation (needs info.retrieve)

### `spec show`

`specplane spec show [options] <id>`

Show one spec's effective status, reasons, authors, results and implementation (needs info.retrieve)

### `sync`

`specplane sync [options] [remote]`

Fetch, merge and push the notes store (approval records) with a remote

### `migrate status`

`specplane migrate status [options]`

Move frontmatter status, approval, results and implementation records into the notes store

### `config get`

`specplane config get [options] [key]`

Show a setting, its source and default; all settings without a key

### `config list`

`specplane config list [options]`

Show every setting

### `config set`

`specplane config set [options] <key> <value>`

Set a setting (needs the config.change permission)

### `config unset`

`specplane config unset [options] <key>`

Remove a setting so its default applies

### `permissions`

`specplane permissions [options] [id]`

Show which role holds which permission, or the documentation of one permission

### `preset list`

`specplane preset list [options]`

List the four default presets and the custom ones, marking the active preset. Needs no permission.

### `preset show`

`specplane preset show [options] <id>`

Show the mode every role has for every permission in one preset, including what the preset's default mode gives to unlisted permissions. Needs no permission.

### `preset create`

`specplane preset create [options] <id>`

Create a custom preset in `.specplane/roles/presets/<id>.yaml`. A preset states the default mode of every permission it does not list, so pass `--default-mode allow|request-user|deny`, or copy a preset with `--from <preset>` (the default presets can be copied). `--set <role>:<permission>=<mode>` sets one mode (repeatable); `<role>:*=<mode>` sets that role's default mode; the roles are `standard-user` and `llm`. `--title` gives a readable title. Needs `config.change` as `allow`, and a management level above every other role the preset applies to: the Standard User (10) may manage presets because the LLM role is 5, the LLM role may not, and the Administrator always may. The file is written but not committed; it applies after you commit it, and `config set permissions.preset <id>` then activates it.

### `preset edit`

`specplane preset edit [options] <id>`

Change a custom preset with `--default-mode`, `--title`, `--set <role>:<permission>=<mode>` and `--unset <role>:<permission>` (both repeatable). The four default presets cannot be edited; copy one with `preset create --from`. Same permission as `preset create`; the change applies after you commit it. Pending requests are not rewritten: they are checked against the permissions in force when they are accepted.

### `preset delete`

`specplane preset delete [options] <id>`

Delete a custom preset. Refused for the default presets and for the preset named by `permissions.preset`. Same permission as `preset create`; the deletion applies after you commit it.

### `audit`

`specplane audit [options]`

Read the audit log (needs info.retrieve)

### `requests list`

`specplane requests list [options]`

List requests, pending first

### `requests show`

`specplane requests show [options] <id>`

Show one request in full, with the change as a diff

### `requests accept`

`specplane requests accept [options] <id>`

Accept a request: the action is done once, under your permission

### `requests decline`

`specplane requests decline [options] <id>`

Decline a request: nothing changes

### `role show`

`specplane role show [options]`

Show the role the CLI runs as: administrator or standard-user.


### `role switch`

`specplane role switch [options] <role>`

administrator or standard-user

### `docs`

`specplane docs [options] [topic]`

Read the bundled product documentation offline. Without a topic it lists the topics; with one it prints that topic.

### `docs essentials`

`specplane docs essentials`

Print the short essentials file that a harness loads into the model's context. Everything else is found by searching.

### `docs search`

`specplane docs search [options] <text...>`

Search the bundled documentation

### `validate`

`specplane validate [options] [ids...]`

Validate the requirements and specs (format, cites, requirement IDs, status)

### `warnings`

`specplane warnings [options] [id]`

List the current warnings, or those of one spec or plan (needs info.retrieve)

### `coverage`

`specplane coverage [options]`

Show which specs cover each requirement and feature spec (needs info.retrieve)

### `test run`

`specplane test run [options] [target]`

Run deterministic tests on the committed content at HEAD: <spec>[#<section>] or --all (needs info.retrieve)

### `check requirement-ids`

`specplane check requirement-ids --staged [--json]`

Refuse duplicate requirement IDs in the staged requirement files (reads the index, checks nothing else). The pre-commit hook runs it when `pre_commit.duplicate_requirement_ids` is on; exit 1 names both places of each duplicate.

### `check tests`

`specplane check tests --staged [--timeout <seconds>] [--json]`

Run the deterministic tests of the architecture specs whose files are staged, on a copy of the index. Intelligent tests never run and nothing is recorded. The pre-commit hook runs it when `pre_commit.tests` is on; exit 1 names the spec and the failing test.

### `init`

`specplane init [options]`

Initialise Specplane in a repository

