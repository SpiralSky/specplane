# Info - Product Requirements

As this project is **Self-Describing**, Product Requirements will be described in the first section and this file should therefore also follow its rules.
Requirements are things that the product should have. Some can be checked deterministically via tests while others have to be checked with intelligence (E.g. LLMs/Full product tests).

### Requirements

**R1: Requirements Formatting**
Requirements in the requirement specification should be prefixed with `R<number>`. This is one example of this. Sub-requirements follow the format `R<number>.<number>` and so on, with numbers separated by a dot. One example is `R1.1`. Ids should be unique and permanent.

**R2: Requirements Storage**
Requirements should be easily accessible, viewable and editable by the user. Therefore, they should be in markdown files within a folder for requirements. If multiple requirements files exist, they should be able to reference each other by the file name and have a central requirements file referencing and describing each of the other files. Using only one file should also be supported.

**R32: Requirements Testing**
Requirements should be testable for duplicate requirement IDs before committing to git. An option for adding pre-commit hook should also exist in the config to prevent duplicate requirement IDs from being committed. The added pre-commit hook should be easily removable without affecting the other code in the pre-commit hook and removed automatically when it is disabled in the config.

## Specplane Features

Specplane's main feature is specifications.

Specifications are divided into 3 layers:
- Requirement: Requirements describing concrete aspects the product should fulfill (Optional)
- Feature: Product Features with minimal architecture included.
- Architecture: Product architecture.

Each layer outranks the next, in the order Requirements -> Feature -> Architecture.
In agentic harness implementations, feature specifications can be generated from the requirements specifications, and architecture specifications can be generated from feature specifications.

Requirement specs are optional while feature and architecture specs are mandatory, and specplane should work without requirement specs.

## Specification State

**R40: Specification Versioning**
Specplane should use git for the current specification state. The current committed state is the current state of the specification, allowing additional metadata to be calculated and attached to git commits. Uncommitted changes are thus **ignored** and not the current state of the specification.

### Requirements Specification

The format for the requirement specifications is described in `R1` and `R2`.

**R3: Human Written Recommendation**
Specplane should recommend and by default refuse LLM changes to the requirements specifications for all commands. The option should be configurable (on/off). See `R14`.

**R4: Feature and Architecture Separation**
Feature and Architecture should be separated in their respective specifications. Therefore, architecture should ideally not exist in the feature specifications, with exceptions controlled by the user. In the case of harness writing, optional instructions to verify and warn the user per change or review should exist (see `R14`). The instructions should be configurable by users. 

### Feature and Architecture Specifications
Feature and Architecture specifications describe concrete features for the user.

**R5: Feature & Architecture Specification Layouts**
Feature specifications should be in a layout that is easy for both a User and LLM to access, and be divided into sections and optionally small subsections for referencing.

**R6: Editing Guardrails**
Optional guardrails should exist to prevent the LLM from editing the feature and architecture specifications. The guardrails should have minimal interference with other LLM work and be configurable. (See `Configurations`)

**R7: Format**
Both feature and architecture specifications should be in a consistent, checkable and citable format.

#### Specification Metadata
**R9: Spec Dependencies**
All things specs refer to are classified as dependencies. The format used should follow `R7`.

**R10: Spec Authorship**
Specs should support a list of authors, including human and LLM authorship. This should be configurable (enable LLM authorship) within config. Adding LLM authorship in the records is on by default and applies when using harness commands.

*R10.1: Detailed Contributions*
Specs should support optional contribution degrees. This describes each author's contribution to the spec in question.

**R11: Spec Status**
Specs should all have a status. The status is bound to a specific git commit.
Statuses:
- Awaiting Review (default): Unreviewed specifications or specifications that have been changed, OR specifications that reference **parts of** other specifications that have changed since their last Approved state.
- Approved: Specifications approved by a user or LLM (LLM approval is off by default for **feature specs** but on for **architecture specs**).

*R11.1: Spec Status records*
Additional metadata records who approved the specification.

*R11.2: Outdated Specs to Awaiting Review*
Specs that refer to parts of specifications that have changed are automatically marked *Awaiting Review* by specplane.

*R11.3: Awaiting Review post-edit*
After a spec has been edited, its status is automatically set to Awaiting Review for user review and more editing.

*R11.4: Tracking Awaiting Review reasoning*
Specplane should provide metadata attached to the specification state if the state is Awaiting Review as a combination of being Outdated (see `R11.2`) or having been edited (See `R11.3`).

**R36: Architecture Spec Status**
Architecture specs should record status of implementation as implemented or unimplemented.

*R36.1: Implementation Tracking*
Architecture specs should have two ways of determining whether they are implemented or not: Tests declared within the specs per architecture with detailed description on what and how to test, and intelligent judgement. This can either be approved by the user or LLM (LLMs can approve by default, but this should be configurable). Generally, both are used in combination. This is harness-only.

## Plans
Plans are a managed list of markdown files containing steps with *what to do* along with shared markdown files containing metadata or shared memory for use by multiple plans. Plans are to be used in a new branch with changed specifications where the feature is ahead or different from implementations, and the plan will cover what to change to update the implementation to follow the updated specifications.

Plans are optional.

**R29: Plan Metadata**
Plans inherit the same metadata as specifications and additionally reference the current feature specification it aims to implement via git. 

*R29.1: Plan Execution Status and Progress*:
Plans should have an execution status: in progress, completed and abandoned. Plans in progress should store metadata for their current progress such as the step they are at. Completed plans are archived automatically.

*R29.2: Archived and Abandoned Plans* Archived plans should rest in a separate directory from other plans. Abandoned plans are also archived, and status differentiates completed plans and abandoned plans within the archive. Plans can also be deleted. Deleted plans do not have a status as they do not exist any more.

**R30: Plan Format**
Plans should have a similar format to specifications, where they can similarly reference other plans and specifications.

**R28: Plan Branches**
Plans should by default work in a separate git branch for the plan. Work should be committed when each step is done and a final review to merge will decide whether a plan is completed.

## Usage
Specplane can be used in two main ways: Agentic Harnesses and the CLI.

### Roles
Specplane handles permissions for both user and LLMs with roles. User and harness LLMs each have roles with different defaults.

Specplane roles apply to both CLI and harness use.

#### Roles
**R46: Role Permissions**
Each role should have permissions assigned to them.

**R42: Default Roles**
There should be default roles providing permissions for each. Each role and permissions will be detailed below.

*R42.1: Default Roles*
*Standard User*
The standard user should be the default role for users using the CLI and agentic harness.

*LLM Role*
The LLM default user should be the default user for LLMs in the harness.

*Administrator*
The administrator user should have all permissions and be able to manage all other users.

*R42.2: Default Role Management Levels*
- Standard User: 10
- LLM: 5
- Administrator: Special (always higher than assignable levels)

**R58: Role Permission Bypass**
Specplane should have configurable guardrails against permission bypass via starting headless sessions, such as running `claude`, `codex` or the specplane CLI itself. One example is using environmental variables. Multiple preventative methods should be used and they should be all documented and configurable.

**R44: Applying Custom Users**
The configuration should allow users to apply custom specplane roles to Operating System users. Administrators or root accounts should be able to log in as the administrator user. User who do not have a role for the operating system will be assigned the standard user (See `R42.1: Default Roles`)

**R48: Role Configuration Storage**
Custom roles, permissions and other settings should be stored in git. However, operating system users to custom specplane roles will not be stored in git.

**R55: Role Enforcement**
Roles should be enforced with a combination of restricting access to specplane internally depending on the permissions an agent or user has, and guidelines for LLMs injected into prompts when they are denied and/or injected into the system prompt to prevent them from finding alternatives. They do not act as strict, airtight enforcement.

*R55.1: Strict Mode*
Strict Mode should be an *optional* mode where roles are locked down more tightly. This includes blocking file edits within the harness to prevent direct editing of specs, git safeguards along operating system level safeguards. In general, many strong approaches to safeguarding should be used where possible. Strict mode's individual changes should be configurable to change what it does. Strict mode should be disabled by default.

#### Role Management
**R43: Role Management**
Management Permissions control what permissions a role can set for other roles. The role should also not be able to change its own permissions.

**R49: Role Management Levels**
A role's permission level determines what roles it can change the permissions of **even with management permissions** (see `R43: Role Management`). Management Levels are numerical. A role with a higher management level can edit all roles with a lower management level than it, and cannot edit permission for all roles with an equal or higher management level than it.

**R45 Administration and User Management**
Using specplane as an administrator (in the operating system) will optionally provide the option to switch user or login to specplane as an administrator. The administrator has the highest permissions of all users.

### Agent Steering

### General (Appears in both)
**R12: Validation**
There should be a way to validate specs. Validation covers all rules specifications should follow described elsewhere in the document.

**R13: Auditing**
Specplane should keep an internal log of **all actions taken** per repository. The internal log should not be committed to git, however, it should contain the branch the command was run on.

**R14: Command Instructions**
Commands have instructions and sometimes optional content injected when they are run (described in other parts of the specification). If the instruction is already within the context, they should not be sent a second time. The instructions should also be customisable but default to command documentation.

**R47: CLI-Harness Separation**
The CLI should not be directly callable by LLMs within the harness.

**R50: Permissions**
Every command should have granular permissions to control what they can do. Additional sub-requirements may describe in more detail what the permissions are.

**R51: Permission Steering**
Permissions should have instructions attached to them, instructing the LLM both on it's permission limitations and an explicit denial for the LLM to not attempt to bypass the permission.

**R54: Permission Documentation**
All permissions should be clearly documented and viewable by both the CLI and harness.

### Specplane CLI
The CLI is **generally intended for human use**, and is not intended to be run within the harness.

**R16: CLI - Specification Approval**
Specifications can be approved by a command. This command will fail if any entry within the specification references an unapproved specification. User who approved is automatically marked as the one who approved the specification and other appropriate metadata is stored.

*R16.1: Specification Approval Permissions*
Specification approval should have a single permission controlling whether a user can approve a specification

**R17: CLI - Specification Metadata**
The CLI should be able to change all aspects of specification metadata. This feature acts as an override. Changes should also appear in the audit log.

*R17.1: Specification Metadata Permissions*
Specification metadata should have permissions whether a role can read, write metadata. A permission for general metadata management should exist for managing all metadata while granular permissions should exist per-metadata.

**R33: CLI - Plan Management**
The CLI should be able to manage plans by changing plan metadata.

*R33.1: Plan Metadata Permissions*
There should be permissions controlling whether a role can read and write metadata. A general permission should control general metadata management while granular permissions should also exist for granular overrides.

### Specplane Harness
**R18: Harness - General commands**
All harness commands should not be **directly executed** by the LLM. **This refers to execution when a user types a command, not the permissivity of agents running the commands in question**. For example, `/abc` (a placeholder example) will go through the harness itself and only pass arguments to the LLM if there are any.
The CLI should be able to manage plans such as changing plan statuses by approving and archiving plans.

**R52: Requests System**
A requests system should exist for LLMs to send requests to the user to approve. Dedicated permissions should exist as an alternative to allow/deny for certain actions within the harness for using the requests system. If there is no active session and the request only runs in the background, requests should still be in the requests list and can be accepted later by the user.

*R52.1: Requests Command*
A command should exist to open an interactive requests pane in the harness for the user to view and accept requests.

*R52.2: Requests Permissions*
To accept a request, the user must have the permission to do what is requested. For example, to accept a request to change a plan's status, the user needs to have the permission to change plan statuses.

*R52.3: Request Permission Type*
'Request User' in all sections refer to sending a request to the harness user via the Requests System. This is permission type exists globally for all permissions along with allow and deny.

**R41: Approving Spec Commands**
For all spec commands that edit, delete or approve specifications, these configurations control the whether user and LLM roles are allowed to review and edit specs:
1. Direct Approval: Whether user-run approval commands are allowed (enabled by default).
2. User Confirmation: Where direct approval is not used, attempts by the LLM to approve will trigger a dialogue for the user to view and confirm the updated specification. The difference between the last approved spec and the current spec awaiting approval is displayed in git diff style (green and red changes for additions and deletions).
3. LLM Confirmation: Confirmations are forwarded to a subagent with additional context for approval/denial. Requires a model to be configured in configuration. If user confirmation is enabled, uses a configurable timeout value to forward to LLM confirmation after the user has not responded for the duration of the timeout.
4. Allow LLM approval requests: This controls whether LLM can send approval requests or not. This is *required* for #2 and #3 to work. If disabled, all LLM confirmation requests will be denied directly.

**R19: Spec creation, deletion, editing**
The harness should be able to, edit, delete and create specifications through commands that accept natural language arguments. 
Deleting and Editing specifications need confirmation by default. As these are actions done by the LLM, it needs to have the ability to do these actions on the behalf of the user.

*R19.1: Change Granularity*
Depending on the change granularity, LLM authorship is automatically added by the LLM with contribution details also in metadata.

*R19.2: Spec management Permissions
Permissions should control granularly whether a user can edit, delete or create specifications. Spec Management should have allow, deny and request user permissions.

**R20: Spec approval**
The harness should support spec approval via commands. The command should support both natural language and a direct spec reference.

If natural language describing a specification, e.g. "Plan Execution" is provided, it is forwarded to an LLM to approve if configuration permits. If it is a direct spec reference, such as an ID, the intermediary LLM is bypassed.

*R20.1: Spec approval Permissions*
Spec approval should have allow, deny and request user permissions.

**R21: Spec Viewing (Optional, per harness)**
If the harness supports it, add a command for the user to view specific specs directly. The change in the spec since last approval should be highlighted if it is a spec that has been changed.

*R21.1: Spec Viewing Permissions*
Spec viewing should use `R26: Information Retreival` and therefore not have separate permissions. This should be documented.

**R38: Spec reviewal and discussion**
A command should exist for LLM to review and provide feedback on each spec. It should point out problems and potential missing gaps in feature and architecture specs, and ask questions for the user for the requirement specification on things it needs to clarify.

This command should not use the LLM to change any files, being a read-only operation. This should also cover grammar mistakes, poor wording and unclear instructions across all specifications.

*R38.1 Spec reviewal permissions*
Spec reviewal should use `R26: Information Retrieval` and therefore not have separate permissions. This should be documented.

**R26: Information Retrieval**
The agent should be able to retrieve information for a spec file including all referenced sections of other specifications. This should only include the referenced section. The goal is to reduce number of read attempts

*R26.1: Retrieval Configurability*
Information Retrieval should be flexible and controllable, such as retrieving multiple related documents at once or only a single document.

*R26.1: Information Retrieval Permissions*
Information retrieval should have allow, deny and ask user permissions.

**R31: Plan Management**
The user should be able to use the harness to manage, edit and create plans. 

*R31.1 Plan Management Permissions*
Plan Management should have permissions for manage, editing and creating. Each permission should have 3 modes, allow, ask user and deny.

*R31.1: Parallelism*
The user should be able to control how much parallelism is used in the plan steps. A parallel step contains multiple different tasks that do not depend on each other and require the harness to have subagents to execute the tasks in parallel.

**R27: Plan Execution**
The user should be able to use the harness to start a session that is accessible for reading and *potential* intervention by the user. The user should be able to control what steps to execute, or execute all steps at once. However, the harness should deny the steps if they have a gap between them.

Steps should not require user input during plan execution. Plans should start in a separate worktree while also using a separate branch to keep the current directory the user is on the same.

*R27.1: Plan budgeting*
Harnesses should be able to assign budgets with the main metrics being tokens or usage limits depending on the subscription provider for executing a single plan. Note that every usage limit type should be supported (e.g. 5h and weekly limits for claude). There should be a soft and hard stop based on the resource consumed. Soft stop instructs the model to gracefully create a handoff which will be read instead. The hard stop window should forcefully stop the session if it runs out of resources after the soft stop. Hard and soft stops along with plan status should be attached to the plan metadata.

*R27.1.1: Plan Budget Permissions*
There should be a permission to set plan budgets with modes allow, ask user or deny.

*R27.2: Resuming Plans*
Plans should be easily resumable through the command line interface. If the plan was hard stopped, it should refer to both the handoff and skim previous session logs to gather context. If the plan was successfully soft stopped, it should refer to just the handoff.

*R27.2.1: Plan Resuming Permissions*
There should be a permission to resume a plan with modes allow, ask user or deny.

*R27.3: Blocking in case of failure*
If a plan is blocked mid-attempt and the LLM determines it cannot be continued, such as restrictions within the environment, the plan is stopped. As plan metadata should record the current progress of the plan and a reference to the session (see `R29.1`), it can then be resumed with changes in the environment via the resuming commands (see `R27.2`).

*R27.4: Plan sub-commits*
The policy for committing changes when implementing steps is up to the user. However, one commit must be made per step.

**R37: User Decision Records**
When the user uses specplane in the harness for discussion, decisions the user makes along with the context should be stored as decision records that can be retrieved for future LLM decisions. This should be configurable by the user (on/off).

*R37.1: User Decision Records Permissions*
There should be permissions to add, retrieve, edit and delete user decision records. Permission should have modes allow, ask user and deny.

## Supported Harnesses
**R34: Harness Flexibility**
Specplane should be flexible in the event of new harnesses being added.

**R35: Supported Harnesses**
Specplane aims to support codex and claude code.

## Documentation
**R22: User-facing documentation**
The user-facing documentation describes the function of all features, including but not limited to specification formats, configurations and commands.

**R23: AI-facing documentation**
The ai-facing documentation is derived from the user-facing documentation. The ai-facing documentation should load essentials within context and require the AI to search the documentation for information to prevent too much being loaded into context at once.

## Warnings
**R24: Warnings List**
The list of warnings should be accessible both by a command and by the LLM in agentic harnesses.

*R24.1: Auto Warn*
When using commands in specplane, the number of existing warnings is reported each time at the bottom. This should be configurable (on/off).

## Configurations
**R25: Accessible Configurations**
All configurations should be easily accessible and modifiable in both the CLI and harness integrations.

## Default Permissions and Permission Profiles
**R56: Permission Presets**
Permission Presets should be creatable, editable and deletable. Permission presets apply to a group of roles including user and LLM roles. Permission Presets should require the user to have sufficient management permissions AND management level to apply the set of permissions to all the roles to apply.

Presets simply apply permissions to roles and they can still be changed.

*R56.1: Preset Default Permissions*
Presets additionally define the default permission mode which will apply for all unspecified permission in the preset.

**R57: Default Presets**
There should be a few default permission presets existing which are defined below. The default permission for unspecified permission will be deny for these default presets. Presets should also cover general use and thus be designed carefully.
*Note: Permissions are separate from role management permissions*

1. Architecture-Level LLM Control (Default)
This preset enables LLM editing of architecture while keeping all actions that edit other specifications as request-only. View-only permissions are enabled for all  specifications. Users have all permissions enabled.
2. Full Manual Editing
This preset disables all LLM editing permissions over all specifications while only enabling read-only permissions and other miscellaneous permissions to the LLM. Users have all permissions enabled.
3. Feature-Level LLM Control
This preset enables LLM editing permissions over feature and architectural specifications needing to request the user for editing requirement specifications. Users have all permissions enabled.

### Default Profile

## Subprojects
**R39: Subprojects**
Specplane should support subprojects, for example, directories that contain feature and architecture specifications. Requirements specifications should also be supported in subprojects. One example is codex integration within specplane itself, which in this case uses centralised requirements and therefore only has feature and architecture specifications for the codex implementation specifically.

*R39.1: Subproject Decisions*
When design of feature and architecture specifications is left to the LLM (where enabled by the user and a requirements specification exists), the LLM should make subprojects where needed. One example is codex and claude integration in specplane where feature and architecture of claude and codex integration should be separate from general specplane features.

*R39.2: Subproject References*
Subprojects should be able to reference requirement, feature and architecture specifications.
