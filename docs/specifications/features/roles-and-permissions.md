---
id: feature/roles-and-permissions
title: Roles and Permissions
authors:
  - llm: claude-sonnet-5-5
    contribution: drafted
covers: [R42, R42.1, R42.2, R43, R44, R44.1, R46, R48, R49, R50, R55, R55.1, R56, R56.1, R56.2, R57, R58, R60]
references: [R16.1, R32, harness R35.1, R52, plan-execution R27, R17.1, R17.2, R19.2, R20.1, R21, R25.1, R26.2, R27.1.1, R27.2.1, R27.3, R31.1, R33.1, R37.1, R38.1, R40, R47, R51, R52.2, R52.3, R54, R59.1, R61.2, R63, plan-execution R27.1, plan-execution R27.1.1, plan-execution R27.2.1, plan-execution R31.1, requests R52, requests R52.3, steering R51, steering R59, configuration R25, specifications R11, verification R61, verification R12, verification R13, verification R24, verification R36.1, verification R64, architecture/file-formats §13]
---

# Roles and Permissions

Specplane decides what a person or an LLM may do with roles. A role holds permissions, and every command, in the CLI or in the harness, is checked against the permissions of the role that runs it. This spec describes the default roles, the kinds of permission, the default permission presets, how roles are assigned, how roles are managed, and how far enforcement goes. Custom roles, role management, role mappings and LLM role rules are described here too; strict mode (`R55.1`) and the bypass guards (`R58`) are described here too.

## §1 Terms

- **Role:** a named set of permissions with a management level. It is assigned to a user or an LLM.
- **Permission:** the right to do one kind of action. Each has a mode.
- **Mode:** `allow`, `request user` or `deny`. `request user` exists for every permission (`R52.3`): the action is not done, a request is sent to the user through the requests list (`requests R52`), and the action is done only if the user accepts it.
- **Preset:** a named group of permissions for a set of roles (`R56`).
- **Management level:** a number that orders roles for management (`R49`).
- **User and LLM:** a user is a person using the CLI or the harness. An LLM is a model working in the harness, including a subagent.
- **Default roles:** Standard User, LLM and Administrator (`R42`).

## R46: Role Permissions

Every role has permissions, and roles apply the same way in the CLI and in the harness. A person who runs a command in the harness is acting with their own role, not the LLM's.

There are three types of permission:

1. **Standard permissions.** Permissions to do things with specifications, plans, tests, configuration and the other work Specplane manages. Unless a section says otherwise, "permission" means a standard permission. They are listed in `R50`.
2. **Management permissions.** Permissions to change what other roles may do (`R43`). The permission `role.manage`.
3. **System permissions.** Permissions to change which role an OS user or an LLM gets (`R60`). The permission `role.map`.

Management and system permissions are separate from standard permissions. A preset (`R57`) sets standard permissions only. They are catalog permissions with the three modes, but `request user` does not apply to them: a role that has one only as `request user` is refused, because a request would let a lower role change what applies to a higher one. A default mode never grants them, and neither does it grant the protected overrides (`R17.2`); a custom role has these only when its file states them.

| Role | `role.manage` | `role.map` |
|------|---------------|------------|
| Administrator | allow | allow |
| Standard User | allow | deny |
| LLM | deny | deny |

The Standard User can therefore manage roles below level 10 but cannot map users (assumption: the page gives the Standard User a level, `R42.2`, and says the Administrator manages all other users, so the Standard User keeps management and the Administrator alone holds the system permission by default). A custom role holds either, or both, when its file states them.

## R42: Default Roles

Specplane has default roles whose permissions come from the active preset (`R57`). The administrator is the exception: it does not depend on a preset.

### R42.1: Default Role Definitions

- **Standard User** is the default role for a person using the CLI or the harness.
- **LLM** is the default role for every LLM in the harness. A subagent has the role of the LLM that started it, unless a rule overrides it (`R44.1`).
- **Administrator** has every permission, of every type, and can manage all other roles. It is never limited by a preset.

### R42.2: Default Role Management Levels

| Role | Management level |
|------|------------------|
| Standard User | 10 |
| LLM | 5 |
| Administrator | Special: always higher than any level a role can be given |

## R50: Permissions

Every command has permissions that decide what it may do, and a command may need more than one when it does more than one kind of thing. Each permission has its own mode for each role.

### How a permission applies

- **Allow.** The role does the action. Steering can still make an LLM ask or send a request first (`R52.3`, `R59.1`); without such steering it acts directly.
- **Request user.** The action does not happen. A request is sent to the user (`requests R52`). When the user accepts, the action is done; accepting needs a role that itself has the permission to do what was requested (`R52.2`). A request that is not accepted leaves everything as it was.
- **Deny.** The action is refused. The LLM is told which permission refused it and that it must not look for another way around it (`R51`).
- A permission that a role has not been given takes the default mode of its preset (`R56.1`), which is deny in the default presets.
- A refusal or a request for a permission never partly runs the action.

Scenario: Given an LLM whose role has request user for editing requirement specifications, When it is asked to change a requirement, Then no file changes and a request appears in the requests list; if the user accepts, the change is made.

Scenario: Given an LLM whose role has deny for deleting plans, When it is asked to delete a plan, Then the plan stays and the LLM reports the denial without suggesting another way to delete it.

Test T1 (deterministic): for each mode, run an action that needs one permission and expect it to run for allow, to leave a pending request for request user, and to leave no change for deny.

### Permission kinds

These are the standard permissions. The section named in the last column defines what the action does; this spec defines who may do it. Each kind has the three modes unless noted.

| Permission | What it controls | Defined in |
|------------|------------------|------------|
| Create, edit and delete specifications | Three separate permissions for each type of specification: requirement, feature and architecture | `R19.2` |
| Approve specifications | Three separate permissions, one for each type of specification (requirement, feature and architecture), each controlling whether a role can approve a specification of that type; an LLM uses them when asked to approve. A group needs the permission of each member's type, and decision records are approved under the feature permission | `R16.1`, `R20.1` |
| Read and write specification metadata | A permission for reading, one for general writing, and granular ones for individual metadata | `R17.1` |
| Override status, override approver, override approval commit, override test results | Four separate protected permissions; general metadata writing does not include them | `R17.2` |
| Record a test result | Recording the result of a specification test | `R61.2`, `verification R61` |
| Information retrieval | Reading specifications and other project information; viewing and review use it and have no permission of their own | `R26.2`, `R21`, `R38.1` |
| Read and write plan metadata | Plan metadata through the CLI: `plan.meta.read`, `plan.meta.write` and `plan.meta.write.<piece>` | `R33.1` |
| Edit, create, delete, start, abandon and complete plans | Six separate permissions | `R31.1`, `plan-execution R31.1` |
| Set a plan budget | Setting or changing the budget of a plan | `R27.1.1`, `plan-execution R27.1.1` |
| Resume a plan | Resuming a stopped plan | `R27.2.1`, `plan-execution R27.2.1` |
| Soft stop a plan | The LLM stopping the plan it is running (`plan-execution R27.1`); no mode other than allow is needed by default | `R27.3` |
| Decision records | Add, retrieve, edit and delete user decision records | `R37.1` |
| Change configuration | Any change to Specplane's configuration, including which preset is active | `R25.1`, `configuration R25` |
| Validate, list warnings, show coverage, run tests, read the audit log | Read-only checks and reads; they use the information retrieval permission and have none of their own. Recording a test result is separate (`R61.2`) | `verification R12`, `verification R24`, `verification R13`, `verification R64` |
| Mark an architecture specification implemented | No permission of its own: it needs the permission to record a test result, and for an LLM the setting `architecture.llm_may_mark_implemented` (`configuration R25`) | `verification R36.1` |
| Creating a preset | The permission `preset.create`: request user for the LLM role in all default presets (`R56.2`). The Standard User and the Administrator create presets under `R56` | `R56.2`, `R56` |
| Requests | Sending a request is always allowed to the LLM role. Accepting a request has no permission of its own: it uses the permission of the requested action | `R52`, `R52.2` |

- Switching to the Administrator is not a permission of a role but a change of role, described with the role mapping in `R44`.
- `role.manage` and `role.map` (`R43`, `R60`) are standard catalog entries for documentation, steering and audit, but a preset does not state them (`R57`).
- The list is complete in the sense of `R50`: a new command that does something not covered by an existing permission brings its own permission, with a default in each default preset.
- A role needs the permission for each thing a command does. For example, a step that writes a specification needs the permission to edit that type of specification (`R19.2`); a plan that starts runs only if both the starting permission and the start conditions are met (`plan-execution R31.1`).
- All permissions are documented and can be viewed from the CLI and the harness (`R54`). Each permission has instructions attached to it that tell the LLM about the limit and that it must not try to bypass it (`R51`, `steering R51`).

## R57: Default Presets

Specplane ships four presets. Exactly one is active for the project. It sets the permissions of the Standard User role and of the LLM role. The Administrator has all permissions regardless of the preset (`R42.1`). Management and system permissions are not part of a preset.

All four presets have these in common:

- **Users.** The Standard User has every standard permission, except the four protected overrides of `R17.2` (status, approver, approval commit and test results). Those are not enabled for any role in a preset, so they belong to the Administrator only.
- **Default mode.** Every permission that a preset does not state is deny (`R56.1`).
- **Approval.** Approving specifications is request user for the LLM role.
- **Configuration.** Changing configuration is request user for the LLM role.
- **Preset creation.** Creating a preset (`preset.create`) is request user for the LLM role (`R56.2`).
- **Always allowed for the LLM role:** information retrieval for all specifications, recording a test result (`R61.2`), reading specification metadata, sending requests, and the soft stop of a plan it runs (`R27.3`).
- **Plans for the LLM role:** creating and editing plans are allowed in presets 1, 3 and 4 and request user in preset 2 (an assumption: the page says preset 2 enables only read-only and miscellaneous permissions, and a plan can contain steps that write specifications); starting, resuming, abandoning, completing and deleting plans and setting a plan budget are request user. The plan itself can still stop and resume as `plan-execution R27` describes.
- **Metadata and decision records for the LLM role:** writing metadata is deny; retrieving decision records is allowed, and adding, editing and deleting them is request user.

The presets differ in what the LLM role may do to specifications. Create, edit and delete are set together for each type:

| Preset | Requirement | Feature | Architecture |
|--------|-------------|---------|--------------|
| 1. Architecture-Level LLM Control (default) | request user | request user | allow |
| 2. Full Manual Editing | deny | deny | deny |
| 3. Feature-Level LLM Control | request user | allow | allow |
| 4. Full LLM Control | allow | allow | allow |

- Preset 2 leaves the LLM with read-only work and the always-allowed items above. It cannot send a request to edit a specification, because editing is denied rather than request user.
- Preset 1 is active when nothing else is chosen.
- Whichever preset is active, a specification an LLM writes starts as Awaiting Review (`specifications R11`), and the LLM cannot approve it without the user's decision, because approval is request user. A role with allow for approval approves without a confirmation, and steering does not guarantee that the LLM asks first (`R20.1`).
- Presets apply the same way in the CLI and the harness.

Scenario: Given the default preset, When the LLM is asked to rewrite a feature specification, Then a request is sent to the user and nothing is written until it is accepted.

Scenario: Given the Full Manual Editing preset, When a plan step needs the LLM to write an architecture specification, Then the step cannot do it, and the plan stops with a soft stop (`plan-execution R27.1`) that names the denied permission; deny cannot send a request for that action (`requests R52.3`).

Test T1 (deterministic): for each default preset, check the mode of each permission kind against the table and lists above for the Standard User, LLM and Administrator roles.

## R56: Permission Presets

A preset applies permissions to a group of roles, including the user and LLM roles. Presets only apply permissions; the permissions can still be changed afterwards, role by role.

- **Default presets.** The four default presets always exist and cannot be edited or deleted. The user chooses which one is active as a configuration change (`R25.1`).
- **Custom presets.** Presets can be created, edited and deleted (`R56`). A custom preset applies modes to the roles that exist (the Standard User and the LLM role, `R42.1`), is stored in git so it follows branches like specifications (`R40`), and applies once committed, like configuration. The active preset cannot be deleted.
- **Who may manage presets.** Creating, editing or deleting a preset needs the configuration permission and `role.manage`, both as allow (`R50`), and a management level above every other role the preset applies to (`R42.2`, `R43`). The management permission is `role.manage` (`R43`); the configuration permission is needed as well, because a preset is configuration (assumption). The management level is the actor's level (`R42.2`, `R49`), and the actor's own role does not count against it. The Standard User (10) therefore may manage presets, the LLM role (5) may not, since it has neither permission and the Standard User is above it, and the Administrator always may. A preset applies to the default roles only (the Standard User and the LLM role); a custom role carries its own modes (`R48`). Request user does not stand in for this: a role that has the permission only as request user is refused, because a request would let the LLM change what applies to the Standard User. The one exception is creating a preset, which the LLM role may send as a request under its own permission (`R56.2`); editing and deleting a preset stay with people.
- **Activating.** Choosing a custom preset as active is a configuration change like any other (`configuration R25`), so the LLM role may send a request for it and the user decides.
- **A preset's content.** Every preset states a default mode (`R56.1`) and may state a mode per permission, for each of the two roles, and a default mode per role. Unstated permissions take the role's default, then the preset's (`R42`). A malformed preset is reported by validation and ignored. A preset cannot share an ID with a default preset.

Scenario: Given a Standard User, When they create a preset with default mode deny and make `spec.edit.feature` request user for the LLM role, Then the preset is stored uncommitted, and once it is committed and activated the LLM role needs the user's agreement to edit a feature specification.

Scenario: Given the LLM role, When it tries to edit or delete a preset, Then the action is refused, even where the LLM role has the configuration permission as request user. Creating a preset is governed by `R56.2`.

Test T1 (deterministic): create, edit and delete a custom preset as Standard User and Administrator; expect each to succeed, the LLM role to be refused edit and delete, the default presets to refuse edit and delete, the active preset to refuse delete, a preset without a default mode to be refused and a preset file with an unknown permission or mode to be reported and ignored.

### R56.1: Preset Default Permissions

A preset also states the default mode for every permission it does not list. The default presets state deny.

### R56.2: LLM Preset Creation

The permission `preset.create` controls whether the LLM role can create a preset. Like every permission it has allow, request user and deny (`R52.3`), and it is request user for the LLM role in all four default presets (`R57`). The Standard User and the Administrator create presets under `R56` and are not affected.

- **Deny.** The create action is refused with the permission named, and no request can be sent for it (`requests R52.3`).
- **Request user.** The LLM sends a request that carries the full preset: its ID, title, default mode (`R56.1`) and every mode it states for each role. The request shows the user a preview before they answer, in the same layout as `preset show`: the permissions the preset sets for each role and the mode each one gets, the roles it applies to, its default mode, and which of those modes are more permissive than the active preset gives that role now. The preset is written only if the user accepts. The accepting role needs the configuration permission and `role.manage` as allow and a management level above every other role the preset applies to (`R56`, `R52.2`); the request does not make anyone else's check weaker.
- **Allow.** The LLM creates the preset directly. The management level rule of `R56` still holds for the actor, so a preset the LLM creates may state modes only for the LLM role; a mode stated for the Standard User is refused. A mode more permissive than the LLM role's own in the active preset is refused as well (`R49`).
- **Never active.** A preset the LLM role creates is not active and is not committed by Specplane. Activating it is a configuration change (`R56`), which the LLM role may send as a request and the user decides.
- **Edit and delete.** These stay with people. There is no LLM permission for them in this version, and a request cannot carry them.
- **Harness.** The harness lists and shows presets and creates them through the same operations as the CLI (`configuration R25`), so an LLM can read presets before it proposes one.

Scenario: Given `preset.create` as request user, When the LLM sends a request to create a preset that sets `spec.edit.feature` to allow for the LLM role, Then the user sees the full preset and that this is more permissive than the active preset, and the preset exists only after they accept; it is not active until a separate request to activate it is accepted.

Scenario: Given `preset.create` as deny, When the LLM role tries to create or request a preset, Then the action is refused and no request is stored.

Scenario: Given `preset.create` as allow, When the LLM role creates a preset that states a mode for the Standard User, Then the action is refused for the level rule.

Test T1 (deterministic): for each mode of `preset.create`, check deny (refused, no request), request user (a request with the full preset and a preview; nothing written until accepted; an accept by a role without `role.manage` refused; the preset not active afterwards) and allow (a preset for the LLM role written uncommitted; one stating a Standard User mode or a mode above the LLM role's own refused).

## R43: Role Management

Management permissions decide what permissions a role can set for other roles. A role cannot change its own permissions, whatever its management permissions or level.

The management permission is `role.manage` (`R46`). With it, and a management level above the role concerned (`R49`), a role can:

- create, edit and delete custom roles (`R48`);
- approve a custom role or an LLM role rule, which is what makes it apply (`R48`);
- create, edit and delete presets that apply to roles below its level (`R56`).

Assumptions below the page: a role cannot give another role a permission mode more permissive than its own, because a role that can grant what it lacks could lift a role above itself (the Administrator is exempt); and the approver of a role needs the same, so it cannot approve a role that holds more than it does. Default roles are not stored as files: their permissions come from the active preset, and `R56` governs who changes a preset.

Scenario: Given a role with management permission, When it tries to add a permission to its own role, Then the change is refused.

Scenario: Given a Standard User whose `override.status` is deny, When it creates a custom role that allows `override.status`, Then it is refused; the Administrator can.

Test T1 (deterministic): a role with `role.manage` as allow edits a lower role and is refused for itself; a role with it as request user and an LLM role are refused; a role cannot be created or approved with a mode more permissive than the actor's.

## R49: Role Management Levels

A role's management level decides which roles it can change, even if it has management permissions (`R43`). Levels are whole numbers. A role can change the permissions of every role with a lower level than its own, and of no role at an equal or higher level. The Administrator's level is always above every level a role can have (`R42.2`). A custom role has a level from 1 to 99 (assumption, so the Administrator is always above).

The level check uses the highest of the role's committed level, its working-tree level and its approved level, so lowering a role's level does not allow its edit by a role that was below its previous level.

Scenario: Given a role at level 10 with management permissions, When it changes the permissions of an LLM role at level 5, Then the change is allowed; When it changes the permissions of another role at level 10, Then it is refused.

Test T1 (deterministic): with roles at levels 5, 10 and 10, expect a level 10 role to change only the level 5 role; a role cannot create a role at its own or a higher level; levels outside 1 to 99 are refused.

## R44: Applying Custom Users

Which role a person has depends on who they are, and Specplane does not tie the source of identities to the operating system. An identity is written `<source>:<name>`; the only source is `os` (an operating system user name), so a git server or another source can be added later without changing the mapping.

- **Without a mapping.** Mapping is optional. When no mapping is configured, every user of the CLI and the harness is the Standard User. Anyone can switch to the Administrator with a command, without operating system administrator rights.
- **Switching.** Switching to the Administrator is an explicit command. LLM roles cannot run it, because the CLI is not callable by LLMs in the harness (`R47`) and a harness command typed by the user runs under the user's role. Switching back to the Standard User needs no permission. The switch is remembered for the operating system user who made it.
- **With a mapping.** The configuration can assign a role, default or custom, to an operating system user (`specplane role map`). Once any mapping is configured, a user who has no entry gets the Standard User, and so does a user whose role does not apply (deleted, or never approved, `R48`). A mapping can allow its user to switch to the Administrator, which is how Administrator or root accounts become the Administrator: the switch command no longer lets everyone. Mapping a user to the Administrator role itself is also possible and is for the Administrator only (`R60`).
- **Storage.** Mappings are stored locally, outside of git, per machine (`R48`): `os-users.json` in the local store. Removing the last mapping returns to the first state.

Scenario: Given no mapping, When a user runs the switch command, Then they act as the Administrator until they switch back, and the LLM in the same session keeps the LLM role.

Scenario: Given a mapping that maps `sam` to a custom role and has no entry for `lee`, When `lee` runs a command, Then `lee` is the Standard User, and when `lee` runs the switch command it is refused.

Test T1 (deterministic): no mapping, switch works; with a mapping, an unmapped user and a user whose role is pending are the Standard User, a switch is refused unless the mapping allows it, and the mapping stays out of git.

### R44.1: Custom LLM role rules

Users can assign roles to LLMs with rules. A rule is a file `.specplane/roles/rules/<id>.yaml` (`R48`) that names a role and the factors an LLM must match:

- `subagent`: the name of a subagent the harness defines for a task;
- `agent_type`: the current agent type;
- `provider`: the agent provider (for example `anthropic`; the harness derives it from its adapter unless told);
- `model`: the model name;
- `delegated`: whether the LLM is a subagent.

A text factor matches exactly, or as a prefix when it ends in `*`; every factor a rule states must match. When several rules match, the one with the highest `priority` (default 0) wins, then the smallest rule ID. A rule that matches no LLM leaves it with the default LLM role. For example, a higher role can be given to an LLM that reviews or manages the work of other LLMs. A subagent has its parent's role unless a rule gives it another (`R42.1`). A rule cannot give the Administrator role.

A rule applies only when its file is approved (`R48`) and the role it gives applies. A rule that gives a role above the default LLM role does not apply until the user has trusted it on this machine (`R48`). "Above" means a higher management level than the LLM role's (5), or a management or system permission other than deny (assumption: a low-level role that can manage roles is above in the way that matters).

The harness supplies the factors from the adapter's environment (`SPECPLANE_PROVIDER`, `SPECPLANE_AGENT_TYPE`, `SPECPLANE_SUBAGENT`, `SPECPLANE_MODEL`, `SPECPLANE_DELEGATED_BY`), never from tool input. Which factors a harness can supply depends on the harness; a rule on a factor it does not supply never matches.

Scenario: Given a rule that gives `reviewer` to the subagent `code-reviewer`, approved and trusted, When that subagent calls a harness action, Then the call is checked and audited under `reviewer`; any other LLM keeps the LLM role.

Test T1 (deterministic): a rule applies only when approved, and when above the LLM role only when trusted; factors combine with AND; priority orders matches; a non-matching LLM has the default role; an LLM cannot create or trust a rule.

## R60: Permissions for applying Custom Users

System permissions (`R46`) allow a role to change the mapping from OS users to roles and from LLMs to roles (`R44`, `R44.1`). The permission is `role.map`. The Administrator can fully manage the OS user mapping. A role with system permissions obeys management levels: it cannot map a user or an LLM to a role at an equal or higher level than its own (`R49`), and it cannot change the mapping of a user who has such a role. The Administrator is exempt from this for OS user mappings only; an LLM rule can never give the Administrator role. Allowing a user to switch to the Administrator (`R44`) is the same as mapping the user to it, so it is for the Administrator only.

Creating, editing and deleting rules needs `role.map`; approving them needs `role.manage` (`R43`, `R48`), because approval is a management act. Both must be `allow`.

Scenario: Given a role at level 10 with system permissions, When it maps an OS user to a role at level 10, Then the mapping is refused; the Administrator can do the same mapping.

Test T1 (deterministic): a role with `role.map` maps a user to a lower role and is refused for an equal or higher role, the Administrator role and an unknown role; the Standard User and the LLM role are refused; the Administrator maps any role; a rule for the Administrator role is refused.

## R48: Role Configuration Storage

Custom roles, their permissions and LLM role rules (`R44.1`) are stored in git, so they follow branches like specifications (`R40`):

- a custom role is `.specplane/roles/roles/<id>.yaml` with `id`, `title`, `management_level`, a required `default_mode` and `modes` (permission to mode);
- an LLM role rule is `.specplane/roles/rules/<id>.yaml` (`R44.1`);
- custom presets stay in `.specplane/roles/presets/` (`R56`) and need no approval.

Both are read from HEAD like configuration. A change to a role or rule is pending until a role with enough management permission and level approves it (`R43`, `R49`). The approval is a record in the notes store (`architecture/file-formats §13`) on the file's content, so any later edit is pending again. While an edit or deletion of an approved role or rule is pending, the last approved content keeps applying (including rule matching and local trust for that content); a role that was never approved does not apply, and a user mapped to it is the Standard User. A malformed file is a validation error and is ignored. A role applies in the CLI and the harness alike.

An LLM role rule that gives a role above the default LLM role also has to be trusted locally before it applies. Trust is recorded on this machine only (`trusted-rules.json` in the local store), covers the rule's content and the level of the role it gives, and ends when either changes. Only a person can trust a rule. Mappings of operating system users to roles are stored locally, outside of git, per machine (`R44`), and are not part of this approval.

Deleting a role or rule must be committed and then approved with `role approve <id>` or `role rule approve <id>`. Until approval, list and show include it as `pending-deletion` and validation warns; edits are `pending-change`. Approval retires the previous definition: mapped users then fall back to Standard User and LLM rule selection no longer uses the deleted rule. Restoring the file needs fresh approval. Presets, including custom presets, are not part of this approval (`R56`), and the active preset is an ordinary configuration setting (`configuration R25`).

Scenario: Given a role file that was committed and approved and is then edited and committed, When a user with that role runs a command, Then the last approved content applies, `validate` reports the pending change, and after `role approve` the new content applies.

Test T1 (deterministic): an uncommitted, a committed-unapproved, an approved and an edited-after-approval role each apply as described; a malformed role file is reported and ignored; trust is local, per rule content and level; an edited or deleted rule retains its approved matching, priority and trust until approval; deleted roles retain their mappings until approval; approval checks the effective and proposed levels; approved deletions do not revive older approvals.

## R55: Role Enforcement

Roles are enforced in two ways together:

- **Internal restriction.** Specplane refuses or holds an action when the role lacks the permission (`R50`).
- **Guidelines for LLMs.** When an action is denied, the reply tells the LLM that it is denied and that it must not try to get round the denial. The same guidance is part of what the LLM is told from the start (`R51`, `steering R59`).

Roles are not strict, airtight enforcement (`R63` is a goal that these measures serve where possible). An LLM that has other tools may still be able to change a file by another route; the prompt guidance and the checks in Specplane's own commands are what stop it in the normal case.

### R55.1: Strict Mode

Strict mode is an optional mode that locks roles down more tightly than `R55` does. It combines measures at three levels: blocking file edits in the harness that would change specifications directly, safeguards in git, and safeguards at the operating system level; in general, as many strong measures as are possible. Strict mode is off by default.

- `strict_mode.enabled` turns strict mode on as a whole. While it is on, every measure is on unless it is turned off on its own with `strict_mode.<measure>`. A measure set on while `strict_mode.enabled` is off does nothing, and `validate` warns about it and about a name that matches no measure.
- The harness resolves protected folders and switches with the core configuration parser for every supported YAML form. If it cannot resolve these protections, it refuses file edits and shell calls until resolution works again; it does not silently protect default folders instead.
- The measures are:
  - `edit_block`: the harness blocks writes to the specification folders (including subprojects), decision records and role files by a file tool or by a shell command, so a specification is changed only through Specplane's actions, which check the role (`R50`). Reading is not blocked.
  - `git_commit_guard`: a pre-commit check, installed in the managed pre-commit hook as the other checks are (`R32`) and removed when the measure is turned off, refuses a commit made by a process marked as an LLM's (`R58`) that stages a specification, decision record, role file or configuration change which the LLM's role may not make directly, meaning that the permission it would have needed is not `allow`. A person's commit is never refused by it. The harness also blocks a commit that skips hooks (`--no-verify`), a change to `core.hooksPath` and edits of the git hooks.
  - `os_permissions`: Specplane makes its installed hooks, the harness settings that register them and the pre-commit hook read-only, keeps its local store private to the user that owns it, and the harness blocks changing the permissions of those files. The permissions are applied when the measure is turned on and again after the harness is set up again, and removed when it is turned off. For a stronger separation, an LLM can be run as a different operating system user than the person (`R44`).
- A harness that cannot enforce a measure says so when it is set up and in `validate` and does not claim it (`harness R35.1`). Codex has no hook that runs before its tools, so it cannot enforce `edit_block`; it reports this, and the measures that do not depend on the harness still apply. Like all of roles the measures are not airtight (`R55`): they close common routes and do not stop a process that can run arbitrary code, and the file permissions do not stop the owner of the files or the administrator of the machine.

Scenario: Given strict mode on in an LLM session on a harness that supports it, When the LLM tries to write a specification file with a file tool or a shell command, Then the call is refused and it is told to use the Specplane actions.

Scenario: Given strict mode on and an LLM whose role may only request changes to feature specifications, When its process runs `git commit` with a changed feature specification staged, Then the commit is refused, while the same commit made by a person succeeds.

Test T1 (deterministic): strict mode off or a measure off allows what that measure blocks, and each measure on blocks what it should (the hook: a write to a specification folder by file tool and by shell, `--no-verify`, `chmod` of a hook; allowed: reading a specification, a write elsewhere).

Test T2 (deterministic): the commit check refuses a staged change that the marked LLM's role may only request or is denied, allows one it may make, and never refuses an unmarked process.

Test T3 (deterministic): turning `os_permissions` on makes the guarded files read-only and the store private, turning it off makes the hooks writable again, and `validate` reports guarded files left open.

## R58: Role Permission Bypass

Specplane has guardrails against getting round a role by starting a headless session, such as `claude -p`, or by running the Specplane CLI from inside an LLM session (`R47`).

- More than one measure is used. Each measure is documented (`R54`) and can be turned on or off on its own with the setting `bypass_guards.<measure>`; every measure is on by default. `validate` warns for each measure that is off and for a setting that names no measure, and warns when the installed harness lacks the hook a measure needs.
- The measures are:
  - `llm_marker`: a Specplane command that runs in a process marked as an LLM's, by the environment variable `SPECPLANE_ACTOR=llm`, runs as an LLM with the role the LLM role rules give (the LLM role by default). It never runs as the Standard User or the Administrator, whatever the Administrator switch or the operating system user mapping say, and it cannot switch roles.
  - `marker_export`: the harness puts the marker, the provider and the model into every shell command of an LLM session and into the environment of any headless session that Specplane itself starts, so that a headless session, or the CLI run from inside an LLM session, is recognised.
  - `marker_protect`: the harness blocks a shell command that sets or unsets the marker or the identity variables, or clears the environment, which would hide the LLM.
  - `headless_block`: the harness blocks a shell command that starts a headless LLM session (`claude -p`, `claude --print`, `codex exec`).
  - `store_protect`: the harness blocks direct writes to the local store files that hold the Administrator switch, the operating system user mapping and the rule trust, and to the approvals notes ref, whether by a shell command or by a file tool.
  - `hook_protect`: the harness blocks direct writes to its own installed hooks and settings, which would switch the other measures off.
- The harness recognises the LLM and, where the host tells it, the subagent that is running, and each gets the role the LLM role rules give it (`R44.1`). Claude Code tells it per call, through a hook that records the caller of each harness action call (kept in the local store, which the store guard protects); for the plugin install the caller comes from the engine through the session server instead; a call takes the role of the subagent that made it. Where a host does not tell the harness which subagent is running, rules on the subagent or the agent type match only when the environment states them, and `validate` warns when an approved rule states one of them.
- A harness that cannot enforce a measure says so when it is set up and in `validate` and does not claim it (as the harness requires). Like all of roles, the measures are not airtight (`R55`): they close the common routes and do not stop a determined process that can run arbitrary code.
- A person using the CLI in their own terminal is not affected: their processes carry no marker.

Scenario: Given an LLM that starts a headless Claude session and runs a Specplane command in it, When the command runs, Then it runs with an LLM role and not as the Standard User.

Scenario: Given an LLM session on a harness with the measures on, When the LLM tries to run `claude -p`, to unset the marker, or to write the Administrator switch file, Then the shell call is refused and nothing runs.

Test T1 (deterministic): given a process whose environment carries the marker, when a CLI command resolves its actor, then the actor is an LLM with the role the rules give, also after the Administrator switch and with an operating system user mapping; with `bypass_guards.llm_marker` off the actor is the person.

Test T2 (deterministic): for each hook measure, a command or file write it must block is refused and a harmless one is allowed, and each measure turned off allows what it blocked.

## §2 Edge cases

- A permission that two commands share has one mode; a role cannot be allowed by one command and denied by another for the same action.
- If a request is accepted by a user whose role lacks the permission, the acceptance fails and the request stays pending (`R52.2`).
- Changing the active preset does not rewrite requests already pending. Each request is checked against the permissions in force when it is accepted.
- A role with allow for approval approves without a confirmation. The documentation says so (`R20.1`).
