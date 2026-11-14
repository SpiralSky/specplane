---
title: Roles, permissions and presets
summary: Who may do what, the four default presets, custom presets, and what each permission allows.
related: [configuration, commands, harnesses]
---

# Roles, permissions and presets

Every action that changes something needs a permission. Each role has a mode for each permission: `allow` (done at once), `request-user` (the action becomes a request that a person accepts or declines, see `requests list`) or `deny`. The mode applies in the CLI and in the harness alike.

## Roles

- **Administrator**: every permission, always `allow`. This is the role a person at the CLI uses when they switch to it with `role switch administrator`.
- **Standard User**: `allow` for every permission except the four protected overrides, which are `deny`. The default CLI role.
- **LLM**: the role an agent in a harness has. Its modes come from the active preset.

## Custom roles and management

Besides the three default roles you can define custom roles, each with its own permissions and a management level, and decide who gets which role.

- **Roles are files in git**: `.specplane/roles/roles/<id>.yaml` holds `management_level` (1 to 99), a required `default_mode` and a `modes` map. Create one with `role create <id> --level 7 --default-mode deny --set spec.edit.feature=request-user`, commit the file, then `role approve <id>`. An edit or deletion of a role is pending until approved; the last approved version keeps applying, and a role never approved does not apply. `validate` reports pending changes. `role list` and `role show <id>` show the state.
- **Management levels**: the Standard User is 10, the LLM 5, the Administrator above every level a custom role can have. A role can change, approve and map only roles with a lower level than its own, never its own role, and can never hand out a permission mode more permissive than its own. This holds even for a role with the management permission.
- **Management and system permissions**: `role.manage` (create, edit, delete and approve roles and rules, and manage presets) and `role.map` (map users and LLMs to roles). Presets and default modes never grant them, nor the protected overrides: a custom role has them only if its file lists them. The Standard User has `role.manage`; only the Administrator has `role.map` by default. They are `allow` or `deny` in practice: `request-user` does not stand in, because a request would let a lower role change what applies to a higher one.
- **Mapping users to roles**: `role map <os-user> <role>` stores the mapping in the local store of this machine, never in git (`role mappings` lists it, `role unmap` removes one). Without any mapping everyone is the Standard User and anyone can run `role switch administrator`. Once a mapping exists, an unmapped user is the Standard User and only a user mapped with `--allow-admin-switch` (Administrator only) can switch to the Administrator.
- **LLM role rules**: `.specplane/roles/rules/<id>.yaml` gives an LLM a role when its factors match: `subagent`, `agent_type`, `provider`, `model`, `delegated`. Create with `role rule create <id> --role reviewer --match subagent=code-reviewer`, commit, then `role rule approve <id>`. A rule that gives a role above the default LLM role must also be trusted on your machine with `role rule trust <id>`. Without a matching rule an LLM has the default LLM role. The harness tells Specplane the provider and model. In Claude Code the caller hook also tells it which subagent makes each call, so a rule on `subagent` (the agent type, for a call made inside a subagent), `agent_type` or `delegated` matches that call; `validate` warns when such a rule exists and the harness cannot do this (capability "telling subagents apart for LLM role rules", see `harnesses`).

After editing or deleting a role or rule, commit the change and run `role approve <id>` or `role rule approve <id>`. Until approval, the last approved definition stays in force, including rule matching and trust for that content. List and show report `pending-change` or `pending-deletion`, and `validate` warns. Approving deletion removes the definition; users mapped to a deleted role then become Standard User. Restoring a deleted file needs fresh approval.

`role show` prints the current CLI role; `permissions` prints every permission with its mode per role in the active preset; `permissions <id>` prints the full documentation of one permission, including its steering text.

<!-- note: llm-allow-approves -->
**An LLM role with `allow` approves without confirmation.** If the active preset gives the LLM `allow` on `spec.approve`, an LLM approves specifications without asking you. Steering text asks an LLM to confirm first, but steering does not guarantee that it will. Use `request-user` wherever you need to confirm each approval; that is the default.

## Bypass guards

A role is only as strong as the ways round it are closed. An LLM that can run a shell could start a headless session (`claude -p`, `codex exec`), run the Specplane CLI as the person who owns the machine, or edit the local files that hold the Administrator switch and approvals. Specplane uses several measures against this; each is on by default and is turned off on its own under `bypass_guards.<measure>` in `.specplane/config.yaml` (`validate` warns for each measure that is off and for a name that matches no measure).

| Measure | What it does | Needs |
|---------|--------------|-------|
| `llm_marker` | A Specplane command in a process marked as an LLM's (`SPECPLANE_ACTOR=llm`) runs as an LLM with the role the LLM role rules give (the LLM role by default), never the Standard User or the Administrator, and cannot switch roles. `role.json` and the OS user mapping are not consulted. | The core (every harness, any process that carries the marker) |
| `marker_export` | The harness puts the marker, the provider and the model into every shell command of an LLM session, and into the environment of a headless session it starts itself (`plan-start`), so a headless session or the CLI run from inside it is recognised. | Claude Code session-start hook |
| `marker_protect` | Blocks a shell command that sets or unsets the marker or the identity variables (provider, agent type, subagent, model, delegating session, session), or clears the environment (`env -i`, `env -u`). It also blocks a shell command that starts the Claude plugin's session server. | Claude Code hook |
| `headless_block` | Blocks a shell command that starts a headless LLM session: `claude -p`, `claude --print`, `codex exec`. | Claude Code hook |
| `store_protect` | Blocks direct writes, by shell or by a file tool, to the local store (`role.json`, `os-users.json`, `trusted-rules.json`, the `callers/` folder of recorded subagent callers) and to the approvals notes ref. A command made only of plain reads such as `ls` and `cat` is allowed. | Claude Code hook |
| `hook_protect` | Blocks direct writes to the installed Specplane hooks and to `.claude/settings.json`, which would switch the others off. | Claude Code hook |

Paths are compared after `.` and `..` are resolved in the text, so `docs/../docs/x` counts as `docs/x`; links are not followed. The hook measures are best effort: they read the command text, so an obfuscated command can get past them, and they read the configuration file in the working tree, not the committed one. A person who runs the same commands in their own terminal is not affected. LLM role rules that match on a subagent or an agent type use the caller hook's per-call record on Claude Code; where there is none (Codex, or the hook not installed) they apply only where the environment states them (`SPECPLANE_SUBAGENT`, `SPECPLANE_AGENT_TYPE`). A subagent has the role of the session that started it, unless a rule that states `subagent`, `agent_type` or `delegated` matches the subagent itself. Codex has none of the hook measures (see `harnesses`).

## Strict mode

Roles are not airtight (see above). Strict mode is an optional mode that locks them down more tightly, with extra measures at three levels. It is off by default. Turn it on with `config set strict_mode.enabled on`; every measure is then on, and you can turn one off with `config set strict_mode.<measure> off`. A measure set to `on` while `strict_mode.enabled` is off has no effect, and `validate` warns about it, about a name that matches no measure, and about each measure that the installation cannot carry out.

| Measure | What it does | Needs |
|---------|--------------|-------|
| `edit_block` | Blocks file-tool and shell writes to the specification folders (`paths.requirements`, `paths.features`, `paths.architecture`, subproject folders), `.specplane/decisions` and `.specplane/roles`, so specifications change only through Specplane actions, which check the role. Reading is not blocked. | Claude Code hook |
| `git_commit_guard` | A pre-commit check (`check strict`) refuses a commit from an LLM's process when it stages a specification, decision, role or configuration change that the LLM's role may not make directly. The harness also blocks `git commit --no-verify`, changing `core.hooksPath` and edits of the git hooks. | Pre-commit hook (any harness), Claude Code hook for the second part |
| `os_permissions` | Makes the installed hooks, `.claude/settings.json` and the pre-commit hook read-only, keeps the local store folder private to its owner (mode 0700, files 0600), and blocks `chmod`, `chown`, `chattr` and `setfacl` on them. Setting it back off makes the hooks writable again. | The core; Claude Code hook for the chmod block |

The Claude guard uses the core to resolve your configured folders (including subprojects), strict-mode switches and bypass-guard switches. Block and flow YAML, quotes and comments work the same way as in the core. If the core or `jq` is unavailable, or protection settings cannot be resolved, file edits and shell calls are blocked until the installation or configuration is repaired; Read tools remain available. This also applies when strict mode cannot be determined.

The measures are best effort, like the bypass guards. They read command text, so an obfuscated command or a script that writes the files gets past the hook. The file permissions stop another operating system user and make the owner change a mode first; they do not stop the owner or root. For a stronger separation, run the LLM under a different operating system user than yours, with the checkout writable only through Specplane (map the users with `role map`, see "Custom roles and management" above). A person working in their own editor or terminal is not affected by the hook measures. The pre-commit check applies to commits whose process carries the LLM marker. Codex has no hook, so on Codex `edit_block` and the hook part of `git_commit_guard` and `os_permissions` do not apply (see `harnesses`).

## Presets

Choose a preset with `config set permissions.preset <id>`. The four defaults are built in and cannot be edited or deleted. You can create your own with `preset create`, change it with `preset edit` and remove it with `preset delete` (see `commands`).

| Preset | LLM on requirement specs | LLM on feature specs | LLM on architecture specs | `plan.create`, `plan.edit` |
|--------|------|------|------|------|
| `architecture-level-llm-control` (default) | request-user | request-user | allow | allow |
| `full-manual-editing` | deny | deny | deny | request-user |
| `feature-level-llm-control` | request-user | allow | allow | allow |
| `full-llm-control` | allow | allow | allow | allow |

The columns cover create, edit and delete of the spec type together. In all four presets the LLM has `request-user` for `spec.approve`, `config.change`, `plan.start`, `plan.resume`, `plan.abandon`, `plan.complete`, `plan.delete` and `plan.budget`; `allow` for `info.retrieve`, `test.record`, `meta.read`, `plan.softstop`; and `deny` for `meta.write`, the granular `meta.write.*` and the override permissions.

### Custom presets

A custom preset is a file `.specplane/roles/presets/<id>.yaml` that is read from the committed version, like configuration: a new or changed preset applies once you commit it. It names a `default_mode` (required: the mode of every permission it does not list) and, per role (`standard-user`, `llm`), an optional `default_mode` and a `modes` mapping from permission to `allow`, `request-user` or `deny`. A mode resolves from the role's entry, then the role's default, then the preset's default. A preset only applies modes to roles; the modes can still be changed afterwards.

```yaml
id: careful-llm
title: Careful LLM
default_mode: deny
roles:
  standard-user: {default_mode: allow, modes: {override.status: deny}}
  llm:
    modes: {spec.edit.architecture: request-user, info.retrieve: allow}
```

Creating, editing and deleting a preset needs `config.change` as `allow` and a management level above every other role the preset applies to. The Standard User (10) is above the LLM role (5), so a person can manage presets; an LLM cannot, and a request cannot stand in for it. Activating a preset is a configuration change and still goes through a request for the LLM role. A malformed preset file is reported by `validate` and ignored; naming a preset that does not exist in `permissions.preset` is a malformed setting and the default preset applies. The active preset cannot be deleted.

## The permissions

### `spec.create.requirement`

Allows: Create a requirement specification file.

Does not allow: Editing or deleting one, or approving it. A new LLM-written specification starts Awaiting Review.

Commands: `harness spec create`

### `spec.edit.requirement`

Allows: Change the body of a requirement specification, which makes it Awaiting Review again.

Does not allow: Creating or deleting one, writing metadata, or approving it.

Commands: `harness spec edit`, `spec reopen`

### `spec.delete.requirement`

Allows: Delete a requirement specification file.

Does not allow: Creating or editing one.

Commands: `harness spec delete`

### `spec.create.feature`

Allows: Create a feature specification file.

Does not allow: Editing or deleting one, or approving it. A new LLM-written specification starts Awaiting Review.

Commands: `harness spec create`

### `spec.edit.feature`

Allows: Change the body of a feature specification, which makes it Awaiting Review again.

Does not allow: Creating or deleting one, writing metadata, or approving it.

Commands: `harness spec edit`, `spec reopen`

### `spec.delete.feature`

Allows: Delete a feature specification file.

Does not allow: Creating or editing one.

Commands: `harness spec delete`

### `spec.create.architecture`

Allows: Create a architecture specification file.

Does not allow: Editing or deleting one, or approving it. A new LLM-written specification starts Awaiting Review.

Commands: `harness spec create`

### `spec.edit.architecture`

Allows: Change the body of a architecture specification, which makes it Awaiting Review again.

Does not allow: Creating or deleting one, writing metadata, or approving it.

Commands: `harness spec edit`, `spec reopen`

### `spec.delete.architecture`

Allows: Delete a architecture specification file.

Does not allow: Creating or editing one.

Commands: `harness spec delete`

### `spec.approve`

Allows: Approve specifications that are Awaiting Review.

Does not allow: Editing a specification, or setting a status by hand (that is `override.status`).

Commands: `spec approve`

### `meta.read`

Allows: Read specification metadata.

Does not allow: Writing any metadata.

Commands: `spec meta get`

### `meta.write`

Allows: Write any metadata piece that has a granular permission, other than the protected overrides.

Does not allow: Status, approver and test results (the protected overrides) and the specification body.

Commands: `spec meta set`

### `meta.write.title`

Allows: Write only the title of a specification.

Does not allow: Any other metadata piece. The more permissive of this and `meta.write` applies.

Commands: `spec meta set`

### `meta.write.authors`

Allows: Write only the authors of a specification.

Does not allow: Any other metadata piece. The more permissive of this and `meta.write` applies.

Commands: `spec meta set`

### `meta.write.references`

Allows: Write only the references of a specification.

Does not allow: Any other metadata piece. The more permissive of this and `meta.write` applies.

Commands: `spec meta set`

### `meta.write.covers`

Allows: Write only the covers of a specification.

Does not allow: Any other metadata piece. The more permissive of this and `meta.write` applies.

Commands: `spec meta set`

### `meta.write.approval`

Allows: Write only the approval date and commit of a specification.

Does not allow: Any other metadata piece. The more permissive of this and `meta.write` applies.

Commands: `spec meta set`

### `override.status`

Allows: Set a specification status by hand.

Does not allow: It is never covered by `meta.write`.

Commands: `spec override status`

### `override.approver`

Allows: Set the recorded approver by hand.

Does not allow: It is never covered by `meta.write`.

Commands: `spec override approver`

### `override.approval-commit`

Allows: Set the commit shown as the one approved, by hand.

Does not allow: It changes only what is shown, not the status, and is never covered by `meta.write`.

Commands: `spec override approval-commit`

### `override.test`

Allows: Set or clear a test result by hand.

Does not allow: It is never covered by `meta.write`.

Commands: `spec override test`

### `test.record`

Allows: Record a test result.

Does not allow: Marking a result by hand (that is `override.test`).

Commands: `test run`

### `info.retrieve`

Allows: Read information: viewing, review, validation, listing, coverage, test runs and the audit log.

Does not allow: Changing anything.

Commands: `validate`, `warnings`, `coverage`, `spec list`, `spec show`, `test run`, `audit`

### `plan.meta.read`

Allows: Read plan metadata: title, authors, references, specifications, approval and execution status.

Does not allow: Writing plan metadata.

Commands: `plan meta get`

### `plan.meta.write`

Allows: Write any plan metadata piece that has a granular permission.

Does not allow: The plan body and steps, and execution status and progress, which change through the plan commands.

Commands: `plan meta set`

### `plan.meta.write.title`

Allows: Write only the title of a plan.

Does not allow: Any other plan metadata piece. The more permissive of this and `plan.meta.write` applies.

Commands: `plan meta set`

### `plan.meta.write.authors`

Allows: Write only the authors of a plan.

Does not allow: Any other plan metadata piece. The more permissive of this and `plan.meta.write` applies.

Commands: `plan meta set`

### `plan.meta.write.references`

Allows: Write only the references of a plan.

Does not allow: Any other plan metadata piece. The more permissive of this and `plan.meta.write` applies.

Commands: `plan meta set`

### `plan.meta.write.implements`

Allows: Write only the specifications the plan implements or writes of a plan.

Does not allow: Any other plan metadata piece. The more permissive of this and `plan.meta.write` applies.

Commands: `plan meta set`

### `plan.edit`

Allows: Edit a plan.

Does not allow: Creating, starting or deleting it.

Commands: `harness plan edit`

### `plan.create`

Allows: Create a plan.

Does not allow: Starting it.

Commands: `harness plan create`

### `plan.delete`

Allows: Delete a plan.

Does not allow: Abandoning a running one.

Commands: `plan delete`

### `plan.start`

Allows: Start a plan.

Does not allow: Editing it.

Commands: `plan start`

### `plan.abandon`

Allows: Abandon a plan.

Does not allow: Deleting it.

Commands: `plan abandon`

### `plan.complete`

Allows: Complete a plan, and merge it.

Does not allow: Starting or abandoning it.

Commands: `plan finish`, `plan merge`

### `plan.budget`

Allows: Set the budget of a plan.

Does not allow: Anything else about the plan.

Commands: `plan budget`

### `plan.resume`

Allows: Resume a stopped plan.

Does not allow: Starting a plan that never ran.

Commands: `plan resume`

### `plan.softstop`

Allows: Stop a running plan after the current work.

Does not allow: Abandoning it.

Commands: `plan stop`

### `decision.add`

Allows: Add a decision record the user made.

Does not allow: Editing or deleting one.

Commands: `decision add`

### `decision.retrieve`

Allows: Read decision records: list, search and show.

Does not allow: Changing them.

Commands: `decision list`, `decision show`

### `decision.edit`

Allows: Edit a decision record.

Does not allow: Adding or deleting one.

Commands: `decision edit`

### `decision.delete`

Allows: Delete a decision record.

Does not allow: Adding or editing one.

Commands: `decision delete`

### `config.change`

Allows: Change a setting, including the active preset (`permissions.preset`).

Does not allow: Reading settings, which needs no permission.

Commands: `config set`, `config unset`, `init`


### `role.manage`

Allows: Management permission: create, edit, delete and approve custom roles, and change what a preset or a role allows, for roles whose management level is below the actor's. The actor may not give a mode more permissive than its own.

Does not allow: Changing the actor's own role, or any role at an equal or higher level. It is never set by a preset, and a default mode never grants it. Request user does not apply: a role that has it only as request user is refused.

Commands: `role create`, `role edit`, `role delete`, `role approve`, `preset create`, `preset edit`, `preset delete`

### `role.map`

Allows: System permission: map operating system users and LLMs to roles (`role map`, `role rule ...`), for roles whose management level is below the actor's. The Administrator may also map users to the Administrator role.

Does not allow: Mapping anyone to a role at an equal or higher level than the actor's (the Administrator is exempt for operating system users only), or approving a change. It is never set by a preset, and a default mode never grants it. Request user does not apply.

Commands: `role map`, `role unmap`, `role rule create`, `role rule edit`, `role rule delete`
