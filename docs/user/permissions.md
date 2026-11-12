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

`role show` prints the current CLI role; `permissions` prints every permission with its mode per role in the active preset; `permissions <id>` prints the full documentation of one permission, including its steering text.

<!-- note: llm-allow-approves -->
**An LLM role with `allow` approves without confirmation.** If the active preset gives the LLM `allow` on `spec.approve`, an LLM approves specifications without asking you. Steering text asks an LLM to confirm first, but steering does not guarantee that it will. Use `request-user` wherever you need to confirm each approval; that is the default.

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

Allows: Read plan metadata (later release).

Does not allow: Writing plan metadata.

Commands: `plan meta get`

### `plan.meta.write`

Allows: Write plan metadata (later release).

Does not allow: The plan body.

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

Allows: Add a decision record (later release).

Does not allow: Editing or deleting one.

Commands: `decision add`

### `decision.retrieve`

Allows: Read decision records (later release).

Does not allow: Changing them.

Commands: `decision show`

### `decision.edit`

Allows: Edit a decision record (later release).

Does not allow: Adding or deleting one.

Commands: `decision edit`

### `decision.delete`

Allows: Delete a decision record (later release).

Does not allow: Adding or editing one.

Commands: `decision delete`

### `config.change`

Allows: Change a setting, including the active preset (`permissions.preset`).

Does not allow: Reading settings, which needs no permission.

Commands: `config set`, `config unset`, `init`

