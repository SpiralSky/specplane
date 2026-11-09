---
id: feature/roles-and-permissions
title: Roles and Permissions
status: awaiting-review
authors:
  - llm: claude-sonnet-5-5
    contribution: drafted
covers: [R42, R42.1, R42.2, R43, R44, R44.1, R46, R48, R49, R50, R55, R55.1, R56, R56.1, R57, R58, R60]
references: [R16.1, R52, plan-execution R27, R17.1, R17.2, R19.2, R20.1, R21, R25.1, R26.2, R27.1.1, R27.2.1, R27.3, R31.1, R33.1, R37.1, R38.1, R40, R47, R51, R52.2, R52.3, R54, R59.1, R61.2, R63, plan-execution R27.1, plan-execution R27.1.1, plan-execution R27.2.1, plan-execution R31.1, requests R52, steering R51, steering R59, configuration R25, specifications R11, verification R61, verification R12, verification R13, verification R24, verification R36.1, verification R64]
---

# Roles and Permissions

Specplane decides what a person or an LLM may do with roles. A role holds permissions, and every command, in the CLI or in the harness, is checked against the permissions of the role that runs it. This spec describes the default roles, the kinds of permission, the default permission presets, how roles are assigned, how roles are managed, and how far enforcement goes. Most of the first release needs only the default roles and presets; custom roles, role management, role mappings and strict enforcement are later releases and are marked as such.

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
2. **Management permissions.** Permissions to change what other roles may do (`R43`). A later release.
3. **System permissions.** Permissions to change which role an OS user or an LLM gets (`R60`). A later release.

Management and system permissions are separate from standard permissions. A preset (`R57`) sets standard permissions only.

## R42: Default Roles

Specplane has default roles whose permissions come from the active preset (`R57`). The administrator is the exception: it does not depend on a preset.

### R42.1: Default Role Definitions

- **Standard User** is the default role for a person using the CLI or the harness.
- **LLM** is the default role for every LLM in the harness. A subagent has the role of the LLM that started it, unless a rule overrides it (`R44.1`, a later release).
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

Test (deterministic): for each mode, run an action that needs one permission and expect it to run for allow, to leave a pending request for request user, and to leave no change for deny.

### Permission kinds

These are the standard permissions. The section named in the last column defines what the action does; this spec defines who may do it. Each kind has the three modes unless noted.

| Permission | What it controls | Defined in |
|------------|------------------|------------|
| Create, edit and delete specifications | Three separate permissions for each type of specification: requirement, feature and architecture | `R19.2` |
| Approve specifications | A single permission; an LLM uses it when asked to approve | `R16.1`, `R20.1` |
| Read and write specification metadata | A permission for reading, one for general writing, and granular ones for individual metadata | `R17.1` |
| Override status, override approver, override test results | Three separate protected permissions; general metadata writing does not include them | `R17.2` |
| Record a test result | Recording the result of a specification test | `R61.2`, `verification R61` |
| Information retrieval | Reading specifications and other project information; viewing and review use it and have no permission of their own | `R26.2`, `R21`, `R38.1` |
| Read and write plan metadata | Plan metadata through the CLI; a later release | `R33.1` |
| Edit, create, delete, start, abandon and complete plans | Six separate permissions | `R31.1`, `plan-execution R31.1` |
| Set a plan budget | Setting or changing the budget of a plan | `R27.1.1`, `plan-execution R27.1.1` |
| Resume a plan | Resuming a stopped plan | `R27.2.1`, `plan-execution R27.2.1` |
| Soft stop a plan | The LLM stopping the plan it is running (`plan-execution R27.1`); no mode other than allow is needed by default | `R27.3` |
| Decision records | Add, retrieve, edit and delete user decision records; a later release | `R37.1` |
| Change configuration | Any change to Specplane's configuration, including which preset is active | `R25.1`, `configuration R25` |
| Validate, list warnings, show coverage, run tests, read the audit log | Read-only checks and reads; they use the information retrieval permission and have none of their own. Recording a test result is separate (`R61.2`) | `verification R12`, `verification R24`, `verification R13`, `verification R64` |
| Mark an architecture specification implemented | No permission of its own: it needs the permission to record a test result, and for an LLM the setting `architecture.llm_may_mark_implemented` (`configuration R25`) | `verification R36.1` |
| Requests | Sending a request is always allowed to the LLM role. Accepting a request has no permission of its own: it uses the permission of the requested action | `R52`, `R52.2` |

- Switching to the Administrator is not a permission of a role but a change of role, described with the role mapping in `R44`.
- The list is complete in the sense of `R50`: a new command that does something not covered by an existing permission brings its own permission, with a default in each default preset.
- A role needs the permission for each thing a command does. For example, a step that writes a specification needs the permission to edit that type of specification (`R19.2`); a plan that starts runs only if both the starting permission and the start conditions are met (`plan-execution R31.1`).
- All permissions are documented and can be viewed from the CLI and the harness (`R54`). Each permission has instructions attached to it that tell the LLM about the limit and that it must not try to bypass it (`R51`, `steering R51`).

## R57: Default Presets

Specplane ships four presets. Exactly one is active for the project. It sets the permissions of the Standard User role and of the LLM role. The Administrator has all permissions regardless of the preset (`R42.1`). Management and system permissions are not part of a preset.

All four presets have these in common:

- **Users.** The Standard User has every standard permission, except the three protected overrides of `R17.2`. Those are not enabled for any role in a preset, so they belong to the Administrator only.
- **Default mode.** Every permission that a preset does not state is deny (`R56.1`).
- **Approval.** Approving specifications is request user for the LLM role.
- **Configuration.** Changing configuration is request user for the LLM role.
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

Scenario: Given the Full Manual Editing preset, When a plan step needs the LLM to write an architecture specification, Then the step cannot do it, and the plan stops with a soft stop or sends a request as `plan-execution R27.1` and `requests R52` describe.

Test (deterministic): for each default preset, check the mode of each permission kind against the table and lists above for the Standard User, LLM and Administrator roles.

## R56: Permission Presets

A preset applies permissions to a group of roles, including the user and LLM roles. Presets only apply permissions; the permissions can still be changed afterwards, role by role.

- **First release.** The four default presets exist and cannot be edited or deleted. The user chooses which one is active as a configuration change (`R25.1`).
- **Later release.** Presets can be created, edited and deleted. Applying a preset to a set of roles needs management permission and a management level above every role it applies to (`R43`, `R49`).

### R56.1: Preset Default Permissions

A preset also states the default mode for every permission it does not list. The default presets state deny.

## R43: Role Management

*Later release.*

Management permissions decide what permissions a role can set for other roles. A role cannot change its own permissions, whatever its management permissions or level.

Scenario: Given a role with management permissions, When it tries to add a permission to its own role, Then the change is refused.

## R49: Role Management Levels

*Later release.*

A role's management level decides which roles it can change, even if it has management permissions (`R43`). Levels are numbers. A role can change the permissions of every role with a lower level than its own, and of no role at an equal or higher level. The Administrator's level is always above every level a role can have (`R42.2`).

Scenario: Given a role at level 10 with management permissions, When it changes the permissions of an LLM role at level 5, Then the change is allowed; When it changes the permissions of another role at level 10, Then it is refused.

Test (deterministic): with roles at levels 5, 10 and 10, expect a level 10 role to change only the level 5 role.

## R44: Applying Custom Users

Which role a person has depends on who they are, and Specplane does not tie the source of identities to the operating system. Identities can come from elsewhere later, such as a git server.

- **Without a mapping (first release).** Mapping is optional. When no mapping is configured, every user of the CLI and the harness is the Standard User. Anyone can switch to the Administrator with a command, without operating system administrator rights.
- **Switching.** Switching to the Administrator is an explicit command. LLM roles cannot run it, because the CLI is not callable by LLMs in the harness (`R47`) and a harness command typed by the user runs under the user's role. Switching back to the Standard User needs no permission.
- **With a mapping (later release).** The configuration can assign Specplane roles to operating system users. Once any mapping is configured, a user who has no role gets the Standard User. Administrator or root accounts can optionally switch to the Administrator, and the switch command no longer lets everyone become the Administrator. Mappings are stored locally, outside of git, per machine (`R48`).

Scenario: Given no mapping, When a user runs the switch command, Then they act as the Administrator until they switch back, and the LLM in the same session keeps the LLM role.

### R44.1: Custom LLM role rules

*Later release.*

Users can assign roles to LLMs with rules. A rule can use factors such as a named subagent the harness defines for a task, the current agent type, the agent's provider and others. A rule that matches no LLM leaves it with the default LLM role. For example, a higher role can be given to an LLM that reviews or manages the work of other LLMs. A subagent has its parent's role unless such a rule gives it another (`R42.1`).

A rule that gives a role above the default LLM role does not apply until the user has trusted it on this machine (`R48`).

## R60: Permissions for applying Custom Users

*Later release.*

System permissions (`R46`) allow a role to change the mapping from OS users to roles and from LLMs to roles (`R44`, `R44.1`). The Administrator can fully manage the OS user mapping. A role with system permissions obeys management levels: it cannot map a user or an LLM to a role at an equal or higher level than its own (`R49`). The Administrator is exempt from this for OS user mappings only.

Scenario: Given a role at level 10 with system permissions, When it maps an OS user to a role at level 10, Then the mapping is refused; the Administrator can do the same mapping.

## R48: Role Configuration Storage

*Later release.*

Custom roles, their permissions and LLM role rules (`R44.1`) are stored in git, so they follow branches like specifications (`R40`). A change to them is pending until a role with enough management permission and level approves it (`R43`, `R49`). An LLM role rule that gives a role above the default LLM role also has to be trusted locally before it applies. Mappings of operating system users to roles are stored locally, outside of git, per machine, and are not part of this approval.

Until this exists, the default roles and presets are the only roles, and the active preset is an ordinary configuration setting (`configuration R25`).

## R55: Role Enforcement

Roles are enforced in two ways together:

- **Internal restriction.** Specplane refuses or holds an action when the role lacks the permission (`R50`).
- **Guidelines for LLMs.** When an action is denied, the reply tells the LLM that it is denied and that it must not try to get round the denial. The same guidance is part of what the LLM is told from the start (`R51`, `steering R59`).

Roles are not strict, airtight enforcement (`R63` is a goal that these measures serve where possible). An LLM that has other tools may still be able to change a file by another route; the prompt guidance and the checks in Specplane's own commands are what stop it in the normal case.

### R55.1: Strict Mode

*Later release.*

Strict mode is an optional mode that locks roles down more tightly. It includes blocking file edits in the harness that would change specifications directly, safeguards in git, and safeguards at the operating system level; in general, as many strong measures as are possible. Each measure of strict mode can be turned on or off on its own. Strict mode is off by default.

## R58: Role Permission Bypass

*Later release.*

Specplane has guardrails against getting round a role by starting a headless session, such as `claude -p`, or by running the Specplane CLI from inside an LLM session (`R47`).

- More than one measure is used. One example is an environment variable that marks a session as an LLM's. Each measure is documented and can be turned on or off on its own.
- The harness can recognise the LLMs and subagents that are running and gives each its own role, so that LLM role rules apply (`R44.1`).
- A session that Specplane recognises as started by an LLM runs with an LLM role, not with the role of the person who owns the machine.

Scenario: Given an LLM that starts a headless Claude session and runs a Specplane command in it, When the command runs, Then it runs with an LLM role and not as the Standard User.

## §2 Edge cases

- A permission that two commands share has one mode; a role cannot be allowed by one command and denied by another for the same action.
- If a request is accepted by a user whose role lacks the permission, the acceptance fails and the request stays pending (`R52.2`).
- Changing the active preset does not rewrite requests already pending. Each request is checked against the permissions in force when it is accepted.
- A role with allow for approval approves without a confirmation. The documentation says so (`R20.1`).
