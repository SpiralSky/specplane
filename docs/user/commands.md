---
title: Commands
summary: Every specplane command, its arguments and the permission it needs.
related: [permissions, specification-format, plans, verification]
---

# Commands

These are the commands a person types. An LLM does not run them: in a harness it uses the harness actions (the Specplane MCP tools) and the `/` commands of the harness. Run `specplane <command> --help` for the options of one command; `--json` on most commands gives machine-readable output.

A command that changes something checks the permission of your role first (see `permissions`). Reading information needs no permission for a person. Every command, reads included, is written to the audit log (see `verification`).

<!-- note: group-approval -->
**Group approval.** Specs that cite each other, directly or through other specs, are approved together in one `spec approve` command. The command warns you and lists the specs being approved together. A role approves the group only if it has the approval permission of each member's type (`spec.approve.requirement`, `spec.approve.feature`, `spec.approve.architecture`). It fails, and approves none of them, if any member cannot be approved, for example because it cites a part of a specification that no longer exists.

**Plans and decision records.** `spec approve`, the harness `spec.approve` action and the typed `approve` command also take plan IDs and decision record IDs. Each ID is resolved in order: a specification first, then a plan, then a decision record. Plans and decision records are approved under `spec.approve.feature`, a plan through `plan approve` (so a request sent to you reads `plan approve`). Name plans, decision records and specifications in separate commands; a command that mixes kinds approves nothing.

**Typed approve and inexact names.** The typed `approve` command (the CLI `approve` and the harness `/approve`) approves only exact IDs. A name that is not an exact ID approves nothing and starts no model turn; it lists up to ten best matches, grouped by specification, plan and decision, matched case-insensitively on words in IDs and titles (`approve preset creation` finds `feature/preset-creation`). A name that matches nothing says so. The LLM `spec.approve` action resolves IDs itself and keeps the plain "not found" failure.

Approving writes one approval record per spec into the git notes store (`refs/notes/specplane`); it creates no commit on your branch. Use `specplane sync` to share the records with a remote.

### `plan create`

`specplane plan create [options] <words...>`

Scaffold a plan named <today>-<two to four words>

### `plan approve`

`specplane plan approve [options] <id>`

Approve a plan (committed content)

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

### `decision add`

`specplane decision add [options]`

Add a decision record: `--title`, `--decision` and `--context` are required, `--reasons`, `--concerns <ids>` (comma separated specification or plan IDs) and `--date` are optional. Needs `decision.add` and `decisions.enabled`. The record is written to `.specplane/decisions/D<n>.md` and not committed; commit it, then approve it by its ID.

### `decision list`

`specplane decision list [options] [query]`

List decision records with their date and approval status, or, with a description of a topic, those that match it, best match first. `--concerns <id>` keeps the records that concern one specification or plan. Needs `decision.retrieve`.

### `decision show`

`specplane decision show [options] <id>`

Show one decision record in full. Needs `decision.retrieve`.

### `decision edit`

`specplane decision edit [options] <id>`

Change the title, decision, context, reasons, concerns or date of a record; fields you leave out stay as they are. Needs `decision.edit`. The edited record is Awaiting Review until it is approved again.

### `decision delete`

`specplane decision delete [options] <id>`

Delete a decision record. Needs `decision.delete`.

### `decision approve`

`specplane decision approve [options] <ids...>`

Approve decision records by ID, like `spec approve` (the two are the same command for IDs such as `D1`). Needs `spec.approve.feature`; committed content only.

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

Create a custom preset in `.specplane/roles/presets/<id>.yaml`. A preset states the default mode of every permission it does not list, so pass `--default-mode allow|request-user|deny`, or copy a preset with `--from <preset>` (the default presets can be copied). `--set <role>:<permission>=<mode>` sets one mode (repeatable); `<role>:*=<mode>` sets that role's default mode; the roles are `standard-user` and `llm`. `--title` gives a readable title. Needs `config.change` as `allow`, and a management level above every other role the preset applies to: the Standard User (10) may manage presets because the LLM role is 5, and the Administrator always may. The LLM role may only create: with `preset.create` as `allow` it creates the preset directly, with `request-user` it sends the full preset and its preview as a request that you accept or decline, and in either case the preset may state modes only for the LLM role and none above the LLM role's own. Accepting the request needs `config.change` and `role.manage`. The file is written but not committed; it applies after you commit it, and `config set permissions.preset <id>` then activates it.

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

`specplane role show [options] [id]`

Without an ID, show the role the CLI runs as. With an ID, show that role: for a custom role its management level, whether it applies or has a change pending, and the mode of every permission. Needs no permission.

### `role list`

`specplane role list [options]`

List the default roles and the custom roles in `.specplane/roles/roles/` with their management levels and approval state: `approved`, `pending-change` (an earlier approved version still applies), `pending-deletion` (removed from git but still in force until approved), or `pending` (no effective approval, so it does not apply). Needs no permission.

### `role create`

`specplane role create [options] <id>`

Create a custom role in `.specplane/roles/roles/<id>.yaml`. `--level <1-99>` is the management level (a role can change roles below its level, never its own or an equal or higher one) and `--default-mode allow|request-user|deny` is the mode of every permission the file does not list; `--set <permission>=<mode>` sets one mode (repeatable) and `--title` names the role. The management and system permissions (`role.manage`, `role.map`) and the protected overrides are never given by a default mode: a role holds them only when `--set` states them. Needs `role.manage` as `allow`, a management level above the new role's, and no permission more permissive than the creator's own. The file is not committed, and the role does not apply until it is committed and approved with `role approve`.

### `role edit`

`specplane role edit [options] <id>`

Change a custom role with `--level`, `--default-mode`, `--title`, `--set <permission>=<mode>` and `--unset <permission>`. The same checks as `role create` apply, and the level check covers the old and the new level. Once committed, the change is pending: the last approved version keeps applying until `role approve`.

### `role delete`

`specplane role delete [options] <id>`

Delete a custom role file. The default roles cannot be deleted. Needs `role.manage` and a level above the role's. Commit the deletion, then run `role approve <id>`; until approval the last approved role stays in force. After approval users mapped to it become the Standard User.

### `role approve`

`specplane role approve [options] <id>`

Approve a committed role definition or its committed deletion. Deletion retires the previous definition; restoring the file needs fresh approval. Refused for uncommitted changes. Needs `role.manage` as `allow`, a management level above the role's (new and previously approved), and nothing more permissive than the approver holds. The approval is a record in the notes store on the file's content.

### `role map`

`specplane role map [options] <os-user> <role>`

Map an operating system user to a role on this machine. The mapping is local and never committed. Needs `role.map` as `allow`; the role must be below your management level, except that the Administrator may map any user to any role, including the Administrator. `--allow-admin-switch` (Administrator only) lets that user run `role switch administrator`. Once any mapping exists, a user with no entry is the Standard User, and only a user whose mapping allows it can switch to the Administrator. A role that does not apply (pending or deleted) gives the Standard User.

### `role unmap`

`specplane role unmap [options] <os-user>`

Remove an operating system user's mapping on this machine. Needs `role.map` and a level above the mapped role. With the last mapping gone, every user is the Standard User again and anyone may switch to the Administrator.

### `role mappings`

`specplane role mappings [options]`

List this machine's mappings. Needs no permission.

### `role rule list`

`specplane role rule list [options]`

List LLM role rules, including pending deletions, with `approved`, `pending`, `pending-change` or `pending-deletion` state and whether each applies: it must be approved, its role must apply, and a rule that gives a role above the default LLM role must be trusted on this machine. Needs no permission.

### `role rule show`

`specplane role rule show [options] <id>`

Show one rule with its factors and state. Needs no permission.

### `role rule create`

`specplane role rule create [options] <id>`

Create a rule that gives LLMs a role. `--role <role>` is the role given (not the Administrator); `--match <factor>=<value>` states a factor (repeatable): `subagent`, `agent_type`, `provider`, `model` (a value ending in `*` matches a prefix) or `delegated` (`true` for a subagent). All stated factors must match; with several matching rules the highest `--priority` wins, and with no match the LLM keeps the default LLM role. Needs `role.map` as `allow` and a role below your management level. The file is not committed, and it applies once committed and approved.

### `role rule edit`

`specplane role rule edit [options] <id>`

Change a rule with `--role`, `--match`, `--unmatch <factor>`, `--priority` and `--title`. Same checks as `role rule create`, also covering the effective role. A committed edit is pending: the approved matching, priority, role and trust stay in force until the replacement is approved.

### `role rule delete`

`specplane role rule delete [options] <id>`

Delete a rule file. Needs `role.map` and a level above both its proposed and effective roles. Commit the deletion, then run `role rule approve <id>`; until approval the last approved rule and its trust stay in force.

### `role rule approve`

`specplane role rule approve [options] <id>`

Approve a committed rule definition or its committed deletion; refuses uncommitted changes. Needs `role.manage` as `allow` and a management level above the effective and proposed roles. Deletion retires the previous definition; restoring the file needs fresh approval. List and show expose pending changes, and `validate` warns.

### `role rule trust`

`specplane role rule trust [options] <id>`

Trust an approved rule on this machine. Only a rule that gives a role above the default LLM role (a higher management level, or a management or system permission) needs it; until it is trusted the LLM keeps the default role. The trust is local, not committed, and ends when the rule or the level of its role changes. A person only; an LLM cannot.


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

### `check strict`

`specplane check strict --staged [--json]`

Refuse a commit made by an LLM's process (marked with `SPECPLANE_ACTOR=llm`, see `permissions`) when it stages a specification, decision record, role file or configuration change that the LLM's role may not make directly, that is, when the permission it would have needed is not `allow`. A commit by a person is never refused. The pre-commit hook runs it when strict mode's `git_commit_guard` measure is on (`strict_mode.enabled`); exit 1 names each file and the permission.

### `init`

`specplane init [options]`

Initialise Specplane in a repository

