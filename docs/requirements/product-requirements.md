# Info - Product Requirements

## Purpose
When LLMs write and change specifications, the people responsible for a product can lose control of what it is meant to do. Specplane keeps intended behaviour in specifications that people control and review, so LLMs can implement from them without changing what was decided.

Specplane is for developers building with LLM coding agents, working alone or in small teams.

Specplane succeeds when:
- An LLM can only change or approve specifications as its role allows, and exceptions are visible.
- Every requirement can be traced to the specifications that cover it and the checks that verify them.
- Users can decide how much control to give LLMs, from fully manual to fully LLM-driven.
- Steering and permissions add little friction to work outside specifications.

This document describes the planned new state of Specplane and replaces its existing rules, specifications and workflows where they differ.

## Terms
- **User:** a person using Specplane.
- **LLM / Agent:** a model acting through a harness, including subagents. These words mean the same thing here.
- **Harness:** the agent tool Specplane integrates with, such as Claude Code or Codex.
- **CLI:** Specplane's own command line tool, for human management.
- **Role:** a named set of permissions, assigned to a user, an LLM or, in the future, other actors such as an API.
- **Standard User / LLM / Administrator:** the default roles.
- **Request:** an LLM's ask for a user to accept an action, through the requests list.
- **Steering:** instructions that guide an LLM but do not enforce anything.
- **Plan:** a managed list of steps, run in its own branch.
- **Step:** one unit of a plan, ending in at least one commit.

As this project is **Self-Describing**, Product Requirements will be described in the first section and this file should therefore also follow its rules.
Requirements are things that the product should have. Some can be checked deterministically via tests while others have to be checked with intelligence (E.g. LLMs/Full product tests).

### Requirements

**R1: Requirements Formatting**
Requirements in the requirement specification should be prefixed with `R<number>`. This is one example of this. Sub-requirements follow the format `R<number>.<number>` and so on, with numbers separated by a dot. One example is `R1.1`. Ids should be unique and permanent. Ids of removed requirements are not reused.

Retired IDs: `R3`, `R6`, `R8`, `R15`, `R41`, `R45`, `R53`.

**R2: Requirements Storage**
Requirements should be accessible, viewable and editable by the user. Therefore, they should be in markdown files within a folder for requirements. If multiple requirements files exist, they should be able to reference each other by the file name and have a central requirements file referencing and describing each of the other files. Using only one file should also be supported.

**R32: Requirements Testing**
Requirements should be testable for duplicate requirement IDs before committing to git. An option for adding pre-commit hook should also exist in the config to prevent duplicate requirement IDs from being committed. The added pre-commit hook should be easily removable without affecting the other code in the pre-commit hook and removed automatically when it is disabled in the config.

## Specplane Features

Specplane's main feature is specifications.

Specifications are divided into 3 layers:
- Requirement: Requirements describing concrete aspects the product should fulfill (Optional)
- Feature: Product Features with minimal architecture included.
- Architecture: Product architecture.

**R65: Layer Precedence**
Each layer outranks the next, in the order Requirements -> Feature -> Architecture. An LLM that finds specifications in conflict follows the higher layer and reports the conflict to the user.
**R67: Specification Generation**
In agentic harness implementations, feature specifications can be generated from the requirements specifications, and architecture specifications can be generated from feature specifications (see `R30.1`).

**R68: Required Layers**
Requirement specs are optional while feature and architecture specs are mandatory, and specplane should work without requirement specs.

## Scope

**R62: Non-Goals**
Specplane is a tool for handling specifications with or without an LLM. It is mainly designed for use with an LLM.

*R62.1: Agent Control*
Specplane does not control what an agent does outside of Specplane. That is up to the user. Specplane's limits, guidelines and steering only apply to an agent's actions on Specplane itself, such as bypassing limits or editing specifications.

*R62.2: Concurrent Editing*
Concurrent editing of specifications is left to git and is not handled by Specplane.

*R62.3: Migration*
Migration without an LLM, such as an automatic converter, is not a goal for now (see `R66`).

*R62.4: Team Enforcement*
Enforcing roles for teams through a git server is not a goal for now.

*R62.5: Cross-Project Budgeting*
Managing budgets across multiple Specplane projects is not a goal. This is left to an external coordinator. Specplane only handles the budget of a single plan (see `R27.1`).

**R63: Unwanted Outcomes**
An LLM should not be able to change or approve specifications beyond what its role permits. Specplane's limits and steering (see `R55`, `R59`) exist to prevent this where possible.

## Specification State

**R40: Specification Versioning**
Specplane should use git for the current specification state. The current committed state on the checked-out branch is the current state of the specification, allowing additional metadata to be calculated and attached to git commits. Each branch therefore has its own state, and merging follows git. Uncommitted changes are thus **ignored** and not the current state of the specification.

### Requirements Specification

The format for the requirement specifications is described in `R1` and `R2`.

### Feature and Architecture Specifications
Feature specifications describe concrete features for the user. Architecture specifications describe how they are built.

**R4: Feature and Architecture Separation**
Feature and Architecture should be separated in their respective specifications. Therefore, architecture should ideally not exist in the feature specifications, with exceptions controlled by the user. In the case of harness writing, optional instructions to verify and warn the user per change or review should exist (see `R14`). The instructions should be configurable by users.

**R5: Feature & Architecture Specification Layouts**
Feature and architecture specifications should be in a layout that is easy for both a User and LLM to access, and be divided into sections and optionally small subsections for referencing.

**R7: Format**
Both feature and architecture specifications should be in a consistent, checkable and citable format.

#### Specification Metadata
Specification metadata applies to all specification layers, including requirements.

**R9: Spec Dependencies**
All things specs refer to are classified as dependencies. The format used should follow `R7`.

**R10: Spec Authorship**
Specs should support a list of authors, including human and LLM authorship. This should be configurable (enable LLM authorship) within config. Adding LLM authorship in the records is on by default and applies when using harness commands.

*R10.1: Detailed Contributions*
Specs should support optional contribution degrees. This describes each author's contribution to the spec in question.

**R11: Spec Status**
Specs should all have a status. The status is bound to the spec's committed content and records the commit it was set on. An approval stays valid while that content is unchanged, including after a rebase or squash merge.
Statuses:
- Awaiting Review (default): Unreviewed specifications or specifications that have been changed, OR specifications that reference **parts of** other specifications that have changed since their last Approved state.
- Approved: Specifications approved by a role that has the required permissions.

*R11.1: Spec Status records*
Additional metadata records who approved the specification.

*R11.2: Outdated Specs to Awaiting Review*
Specs that refer to parts of specifications that have changed or been deleted are automatically marked *Awaiting Review* by specplane.

*R11.3: Awaiting Review post-edit*
After a commit changes a spec's content, its status is automatically set to Awaiting Review for user review and more editing. Changes to metadata alone do not count as an edit.

*R11.4: Tracking Awaiting Review reasoning*
Specplane should provide metadata attached to the specification state if the state is Awaiting Review as a combination of being Outdated (see `R11.2`) or having been edited (See `R11.3`).

**R36: Architecture Spec Status**
Architecture specs should record status of implementation as implemented or unimplemented.

*R36.1: Implementation Tracking*
Architecture specs should have two ways of determining whether they are implemented or not: Tests declared within the specs per architecture with detailed description on what and how to test, and intelligent judgement. This can either be approved by the user or LLM (LLMs can approve by default, but this should be configurable). Each spec, or section of a spec, declares which it uses: tests, intelligent judgement or both, and everything declared must pass. A spec that declares neither uses intelligent judgement. Intelligent judgement is harness-only.

*R36.2: Implementation Status Commit*
Implemented status is bound to a specific commit and is only set when everything the spec declares (see `R36.1`) passes on that commit. Checks run against committed state, ignoring uncommitted changes (see `R40`). A commit that changes the spec's content returns it to unimplemented. Other commits do not change the status, which shows the commit it was last verified on.

*R36.3: Test Commit Gate*
An option should exist in the config to block commits when an architecture spec's deterministic tests fail, using a pre-commit hook managed as in `R32`. This should be disabled by default.

**R61: Spec Compliance Verification**
Each specification layer should be able to declare tests that verify the layer below it complies with it: requirements for feature specifications, feature specifications for architecture specifications, and architecture specifications for the implementation (see `R36.1`). Tests can be deterministic or checked with intelligence (E.g. LLMs), and are written in the spec with what and how to test. Deterministic tests can be run through both the CLI and harness. Tests checked with intelligence are harness-only.

*R61.1: Test Pass State*
The result of the tests, including who ran them, is recorded in the metadata of the spec being tested, and a recorded result is outdated when either spec changes (see `R11.2`). A failed test does not change the spec status. Instead, a spec with a failed test cannot be approved (see `R16`), and an architecture spec with a failed test cannot be marked as implemented (see `R36`).

*R61.2: Test Result Permissions*
Recording a test result should have allow, request user and deny permissions. LLM roles are allowed in all default presets.

*R61.3: Test Records*
Each result in the spec's metadata includes a short summary: what failed for deterministic tests, and the reasoning for tests checked with intelligence. Steering (see `R59`) instructs the LLM to keep private information, such as credentials, out of the summary.

*R61.4: Test Logs*
Full test output and LLM session logs are stored locally per machine by default, with configurable retention (see `R13.1`). Storing them should be configurable (on/off), and they can be configured to be stored in git instead. The documentation (see `R22`) should warn that logs in git may expose private information and are not removed by retention.

## Plans
Plans are a managed list of markdown files containing steps with *what to do* along with shared markdown files containing metadata or shared memory for use by multiple plans. Plans are to be used in a new branch with changed specifications where the feature is ahead or different from implementations, and the plan will cover what to change to update the implementation to follow the updated specifications. Plans can also write specifications from a higher layer (see `R30.1`).

**R69: Optional Plans**
Plans are optional.

**R29: Plan Metadata**
Plans inherit the same metadata as specifications and additionally reference the specifications they implement or write from via git. 

*R29.1: Plan Execution Status and Progress*
Plans should have an execution status: not started, in progress, stopped, completed and abandoned. Plans in progress or stopped should store metadata for their current progress such as the step they are at. Completed plans are archived automatically.

*R29.2: Archived and Abandoned Plans*
Archived plans should rest in a separate directory from other plans. Abandoned plans are also archived, and status differentiates completed plans and abandoned plans within the archive. Plans can also be deleted. Deleted plans do not have a status as they do not exist any more.

*R29.3: Outdated Plan References*
If a plan references a specification at an older commit than its latest commit on the current branch, Specplane should show a warning (see `R24`), and steering (see `R59`) should instruct the LLM to check what changed before continuing.

**R30: Plan Format**
Plans should have a similar format to specifications, where they can similarly reference other plans and specifications.

*R30.1: Specification Steps*
Plan steps can write or change specifications from a higher layer, such as features from requirements and architecture from features. These steps follow the LLM role's permissions (see `R19.2`), and the specifications they write start as Awaiting Review. A step that implements one of those specifications cannot run until it is Approved.

**R28: Plan Branches**
Plans should by default work in a separate git branch for the plan. Work should be committed when each step is done and a final review to merge will decide whether a plan is completed.

*R28.1: Specification Changes During a Plan*
The final review shows any referenced specification that changed on the target branch since the plan started.

## Usage
Specplane can be used in two main ways: Agentic Harnesses and the CLI.

### Roles
Specplane handles permissions with roles. A role holds permissions and is assigned to a user, an LLM or, in the future, other actors such as an API. User and harness LLMs each have roles with different defaults.

#### Roles Permissions
**R46: Role Permissions**
Each role should have permissions assigned to them. Roles apply to both CLI and harness use.

There are 3 types of permissions:
1. Standard Permissions. They are referred to as just permissions in this document.
2. Management Permissions. (See `R43`)
3. System Permissions. See `R60`

**R42: Default Roles**
There should be default roles providing permissions for each. Each role and permissions will be detailed below.

Permissions for default roles are defined automatically within presets (see `R57`).

*R42.1: Default Role Definitions*
*Standard User*
The standard user should be the default role for users using the CLI and agentic harness. It has every permission by default, including the protected overrides (see `R17.2`) and the system permissions (see `R60`), so a single user never needs to switch roles. Setups with several users restrict it through a custom preset or custom roles.

*LLM Role*
LLM user should be the default role for LLMs in the harness. Subagents inherit parent LLM roles unless overridden by `R44.1`

*Administrator*
The administrator user should have all permissions and be able to manage all other users.

*R42.2: Default Role Management Levels*
- Standard User: 10
- LLM: 5
- Administrator: Special (always higher than assignable levels)

**R58: Role Permission Bypass**
Specplane should have configurable guardrails against permission bypass via starting headless sessions, such as running `claude -p` or the specplane CLI itself. One example is using environmental variables. Multiple preventative methods should be used and they should be all documented and configurable. The harness should be able to identify LLMs and subagents running and treat them as having their own specplane role so that specplane's LLM roles can be applied properly.

*R58.1: The User's Own Commands*
A command the user types into the harness's own shell, such as `!` in Claude Code, runs as the user, not as the LLM. Only commands the LLM starts, and the processes they start, are treated as the LLM's.

**R44: Applying Custom Users**
The configuration should allow users to apply custom specplane roles to Operating System users. Administrators or root accounts should optionally be able to switch to or log in as the administrator user. User who do not have a role for the operating system will be assigned the standard user (See `R42.1: Default Role Definitions`).

Mapping operating system users is optional. When no mapping is configured, every user of the CLI and the harness is the standard user and can switch to the administrator with a command, without needing operating system administrator rights. Once a mapping is configured, users without a role are assigned the standard user. The source of identities should not be tied to the operating system, so that identities can come from elsewhere later, such as a git server.

*R44.1: Custom LLM role rules*
Assigning custom roles to LLMs should be accessible to users, based on rules with factors such as defined subagents (some harnesses have specific subagents defined for tasks), current agent type, agent provider and other factors. This defaults to the LLM default role. For example, a higher level LLM role can be assigned to an LLM that reviews or manages the work of other LLMs.

*R44.2: LLM Role Proposals*
A permission should exist that controls whether an LLM role can propose a custom role, and an LLM role rule that assigns it (see `R44.1`). It should have allow, request user and deny modes (see `R52.3`), and is request user for LLM roles in all default presets. With request user, the LLM sends a request containing the full role: its permissions, its permission level and the LLM role rule that would assign it. The user is shown a preview of all of that before answering. Nothing is created unless the user accepts. Accepting still requires the accepting role to have sufficient management permissions and management level (see `R52.2`, `R48` and `R60`), and an LLM role rule that gives a role above the default LLM role must still be trusted locally before it applies (see `R48`).

A proposed role cannot hold a permission mode more permissive than the proposing role's own for the same permission, and cannot be at a level equal to or higher than the proposing role's, unless the user explicitly marks that grant in the preview and accepts it. The preview names every such grant.

**R60: Permissions for applying Custom Users**
Administrators should be able to fully manage and edit the mapping from OS users to specplane roles. A custom permission type, System Permissions should exist granting the ability to manage and edit OS user -> role mappings along with LLM to role mappings. Roles with system permissions still have to obey permission levels: They cannot provide an OS user -> specplane role mapping to a role at an equal or higher level than them. This also applies to LLM mappings. Administrators are exempt from this limit for OS user mappings only.

**R48: Role Configuration Storage**
Custom roles, permissions and LLM role rules (see `R44.1`) should be stored in git. Changes to them are pending until approved by a role with sufficient management permissions and level, and an LLM role rule that gives a role above the default LLM role must be trusted locally before it applies. Mappings of operating system users to roles are stored locally, outside of git, per machine.

**R55: Role Enforcement**
Roles should be enforced with a combination of restricting access to specplane internally depending on the permissions an agent or user has, and guidelines for LLMs injected into prompts when they are denied and/or injected into the system prompt to prevent them from finding alternatives. They do not act as strict, airtight enforcement.

*R55.1: Strict Mode*
Strict Mode should be an *optional* mode where roles are locked down more tightly. This includes blocking file edits within the harness to prevent direct editing of specs, git safeguards along operating system level safeguards. In general, many strong approaches to safeguarding should be used where possible. Strict mode's individual changes should be configurable to change what it does. Strict mode should be disabled by default.

#### Role Management
**R43: Role Management**
Management Permissions control what permissions a role can set for other roles. The role should also not be able to change its own permissions.

**R49: Role Management Levels**
A role's permission level determines what roles it can change the permissions of **even with management permissions** (see `R43: Role Management`). Management Levels are numerical. A role with a higher management level can edit all roles with a lower management level than it, and cannot edit permission for all roles with an equal or higher management level than it.

### Agent Steering
**R59: Autogenerated Steering**
Steering should be used to keep LLM to follow rules. Apart from what is mentioned in other sections, LLMs should be instructed to not attempt to bypass limitations and follow what their role restricts them to do.

*R59.1: Custom Steering*
Users should be able to customise steering, overall and per command or permission. For example, when an LLM should send requests: only when the user asked for the change, or whenever it sees a possible improvement. Steering guides the LLM and does not change what its permissions allow.

*R59.2: Overriding Steering*
Steering can be set aside only through an explicit override command that the user runs, never by anything said in conversation. The command names the part of the steering it sets aside and lasts for one action or for the rest of the session. It uses the protected route, confirmation and audit record of temporary grants (see `R76`). It never changes what the LLM's permissions allow.

### General (Appears in both)
**R12: Validation**
There should be a way to validate specs. Validation covers all rules specifications should follow described elsewhere in the document.

**R64: Specification Coverage**
Specplane should show which specifications cover each requirement and feature specification, using their references (see `R9`). Requirements and feature specifications that nothing covers should appear as warnings (see `R24`). This should work with any layers that exist, such as feature and architecture specifications without requirements.

**R13: Auditing**
Specplane should keep an internal log of **all actions taken** per repository. The internal log should not be committed to git, however, it should contain the branch the command was run on.

*R13.1: Audit Retention*
Audit Log retention should be configurable, with its default stated in the documentation.

**R14: Command Instructions**
Commands have instructions and sometimes optional content injected when they are run (described in other parts of the specification). If the instruction is already within the context, they should not be sent a second time. If Specplane cannot tell, or the context has been compacted, they should be sent again. If the harness has better support for this, such as skills loaded on demand, Specplane should use that instead. The instructions should also be customisable but default to command documentation.

**R47: CLI-Harness Separation**
The CLI should not be directly callable by LLMs within the harness.

**R50: Permissions**
Every command should have granular permissions to control what they can do. Additional sub-requirements may describe in more detail what the permissions are.

**R51: Permission Steering**
Permissions should have instructions attached to them, instructing the LLM both on its permission limitations and an explicit denial for the LLM to not attempt to bypass the permission.

**R54: Permission Documentation**
All permissions should be clearly documented and viewable by both the CLI and harness.

### Specplane CLI
The CLI is **generally intended for human use**, and is not intended to be run within the harness.

**R16: CLI - Specification Approval**
Specifications can be approved by a command. This command will fail if any entry within the specification references an unapproved specification. User who approved is automatically marked as the one who approved the specification and other appropriate metadata is stored.

Specs that reference each other, directly or through other specs, are approved together in one command, which fails if any of them cannot be approved. Approval also fails while a spec references a part of a specification that no longer exists. Group approval should be documented (see `R22`), and the command should warn the user and list the specs being approved together.

*R16.1: Specification Approval Permissions*
Specification approval should have one permission per specification type (requirement, feature and architecture), each controlling whether a role can approve a specification of that type. This lets a role approve feature and architecture specifications without being able to approve requirements.

**R17: CLI - Specification Metadata**
The CLI should be able to change all aspects of specification metadata. This feature acts as an override. Changes should also appear in the audit log.

*R17.1: Specification Metadata Permissions*
Specification metadata should have permissions whether a role can read, write metadata. A permission for general metadata management should exist for managing all metadata while granular permissions should exist per-metadata.

*R17.2: Protected Metadata Overrides*
Overriding a spec's status, its approval (who approved it and which commit) or its test results each needs its own permission. General metadata management does not include them. By default the Standard User and the Administrator have these permissions and the LLM role does not. Before an override is applied, the person running it confirms it once. Each override is marked as an override in the spec's metadata and in the audit log.

**R33: CLI - Plan Management**
The CLI should be able to manage plans by changing plan metadata.

*R33.1: Plan Metadata Permissions*
There should be permissions controlling whether a role can read and write metadata. A general permission should control general metadata management while granular permissions should also exist for granular overrides.

### Specplane Harness
**R18: Harness - General commands**
When a user types a harness command, the harness runs it itself and only passes arguments to the LLM if there are any. For example, `/abc` (a placeholder example). This does not limit which commands an LLM can run under its permissions. 

**R52: Requests System**
A requests system should exist for LLMs to send requests to the user to approve. Dedicated permissions should exist as an alternative to allow/deny for certain actions within the harness for using the requests system. If there is no active session and the request only runs in the background, requests should still be in the requests list and can be accepted later by the user.

*R52.1: Requests Command*
A command should exist to open an interactive requests pane in the harness for the user to view and accept requests.

*R52.2: Requests Permissions*
To accept a request, the role must have the permission to do what is requested. For example, to accept a request to change a plan's status, the role needs to have the permission to change plan statuses.

*R52.3: Request Permission Type*
'Request User' in all sections refer to sending a request to the harness user via the Requests System. This permission type exists globally for all permissions along with allow and deny.

Request User always means a person decides. It does not name a role or a subagent. Handing a decision to another LLM is done by giving that role `allow` through a custom role and an LLM role rule (see `R44.1`), and how information reaches a subagent is the harness's concern.

A role with allow can still send a request or ask the user to run a command instead of acting, guided by steering (see `R59.1`). Without such steering, it acts directly.

*R52.4: Request Dialogue*
If a session is active, a request should open a dialogue for the user to view and answer it. A request involving a specification shows the difference from the last approved spec in git diff style (green and red changes for additions and deletions).

*R52.5: Request Notifications*
If the harness supports push notifications, new requests can be sent to the user as push notifications. This should be configurable, overall and per permission, and disabled by default.

**R19: Spec creation, deletion, editing**
The harness should be able to, edit, delete and create specifications through commands that accept natural language arguments. 
As these are actions done by the LLM, it needs to have the ability to do these actions on the behalf of the user.

*R19.1: Change Granularity*
Depending on the change granularity, LLM authorship is automatically added by the LLM with contribution details also in metadata.

*R19.2: Spec management Permissions*
Permissions should control granularly whether a role can edit, delete or create specifications. Spec Management should have allow, deny and request user permissions.

**R20: Spec approval**
The harness should support spec approval via a command that takes a direct spec reference, such as an ID, under the same checks as `R16` and `R61.1`. The command does not use an LLM.

An LLM can also be asked in natural language to approve a specification, e.g. "Plan Execution". It identifies the specification and then uses its own approval permission (see `R20.1`), under the same checks: allow approves it, request user sends a request, and deny refuses it.

*R20.1: Spec approval Permissions*
Each spec approval permission (see `R16.1`) should have allow, deny and request user permissions. The documentation (see `R22`) should note that an LLM role with allow approves without confirmation, and that steering does not guarantee it will ask first. Request user should be used where confirmation is required.

*R20.2: Approving Plans and Decision Records*
The typed approve command and a natural-language request to approve should also cover plans and decision records, not only specifications. Both resolve by ID in the same way, use the same approval permission as feature specifications, and run under the same checks as the CLI. For the LLM role, allow approves, request user sends a request and deny refuses. A command with a name that is not an exact ID behaves as in `R70`.

**R21: Spec Viewing (Optional, per harness)**
If the harness supports it, add a command for the user to view specific specs directly. The change in the spec since last approval should be highlighted if it is a spec that has been changed.

*R21.1: Spec Viewing Permissions*
Spec viewing should use `R26: Information Retrieval` and therefore not have separate permissions. This should be documented.

**R38: Spec reviewal and discussion**
A command should exist for LLM to review and provide feedback on each spec. It should point out problems and potential missing gaps in feature and architecture specs, and ask questions for the user for the requirement specification on things it needs to clarify.

This command should not use the LLM to change any files, being a read-only operation, except for storing user decision records when enabled (see `R37`). This should also cover grammar mistakes, poor wording and unclear instructions across all specifications.

*R38.1: Spec reviewal permissions*
Spec reviewal should use `R26: Information Retrieval` and therefore not have separate permissions. This should be documented.

**R26: Information Retrieval**
The agent should be able to retrieve information for a spec file including all referenced sections of other specifications. This should only include the referenced section. The goal is to reduce number of read attempts

*R26.1: Retrieval Configurability*
Information Retrieval should be flexible and controllable, such as retrieving multiple related documents at once or only a single document.

*R26.2: Information Retrieval Permissions*
Information retrieval should have allow, deny and request user permissions.

**R31: Plan Management**
The user should be able to use the harness to manage, edit and create plans. 

*R31.1: Plan Management Permissions*
Plan Management should have permissions for editing, creating, deleting, starting, abandoning and completing plans. Each permission should have 3 modes, allow, request user and deny.

*R31.3: Plan Retargeting*
The user should be able to change the branch a plan merges into, from the harness as well as the CLI, including for a stopped plan whose target branch no longer exists. Retargeting is plan management with the same three modes (`R31.1`) and is request user for LLM roles in all default presets.

*R31.2: Parallelism*
The user should be able to control how much parallelism is used in the plan steps. A parallel step contains multiple different tasks that do not depend on each other and require the harness to have subagents to execute the tasks in parallel.

**R27: Plan Execution**
The user should be able to use the harness to start a session that is accessible for reading and *potential* intervention by the user. The user should be able to control what steps to execute, or execute all steps at once. However, the harness should deny a selection that skips a step that has not been completed.

Steps should not require user input during plan execution. Plans should start in a separate worktree while also using a separate branch to keep the current directory the user is on the same.

*R27.1: Plan budgeting*
Harnesses should be able to assign budgets with the main metrics being tokens or usage limits depending on the subscription provider for executing a single plan. Note that every usage limit type should be supported (e.g. 5h and weekly limits for claude). There should be a soft and hard stop based on the resource consumed. Soft stop instructs the model to gracefully create a handoff which will be read instead. The hard stop window should forcefully stop the session if it runs out of resources after the soft stop. Hard and soft stops along with plan status should be attached to the plan metadata.

*R27.1.1: Plan Budget Permissions*
There should be a permission to set plan budgets with modes allow, request user or deny.

*R27.2: Resuming Plans*
Plans should be resumable through a harness command. If the plan was hard stopped, it should refer to both the handoff and skim previous session logs to gather context. If the plan was successfully soft stopped, it should refer to just the handoff.

*R27.2.1: Plan Resuming Permissions*
There should be a permission to resume a plan with modes allow, request user or deny.

*R27.3: Blocking in case of failure*
If a plan hits a block mid-attempt, such as restrictions within the environment, the LLM decides whether to continue or stop the plan, guided by steering (see `R59.1`). The LLM should be able to stop the plan through a soft stop (see `R27.1`), which is allowed for LLM roles in all default presets. As plan metadata should record the current progress of the plan and a reference to the session (see `R29.1`), it can then be resumed with changes in the environment via the resuming commands (see `R27.2`).

*R27.4: Plan sub-commits*
The policy for committing changes when implementing steps is up to the user. However, at least one commit must be made per step.

*R27.5: Requests During Execution*
A request sent during plan execution is added to the requests list (see `R52`) and is either blocking or non-blocking. The LLM decides which, guided by steering (see `R59.1`).

*R27.5.1: Blocking Requests*
The plan soft stops (see `R27.1`) and can be resumed with the answer (see `R27.2`).

*R27.5.2: Non-Blocking Requests*
The plan continues with work that does not depend on the answer, without performing the requested action. Unanswered requests are shown at the plan's final review (see `R28`).

*R27.6: Plan Start Conditions*
A plan can only start when it and the specifications it already references are Approved. Specifications the plan will write do not count. This should be configurable (on/off) and enabled by default.

**R37: User Decision Records**
When the user uses specplane in the harness for discussion, decisions the user makes along with the context should be stored as decision records that can be retrieved for future LLM decisions. This should be configurable by the user (on/off).

*R37.1: User Decision Records Permissions*
There should be permissions to add, retrieve, edit and delete user decision records. Permission should have modes allow, request user and deny.

**R66: Project Migration**
A harness command should guide an LLM through bringing an existing project into Specplane, including projects using an older Specplane format. It uses the project's existing specifications, documents and code as sources, and the prompt given to the LLM should be configurable (see `R14`). The LLM follows its role's permissions, and all resulting specifications start as Awaiting Review, regardless of any earlier approval.

## Supported Harnesses
**R34: Harness Flexibility**
Adding a new harness should only require building its integration, without changing Specplane's core behaviour.

**R35: Supported Harnesses**
Specplane aims to support codex and claude code.

*R35.1: Harness Capabilities*
Plan execution (see `R27`) is required on every supported harness. Other capabilities may differ between harnesses. The documentation (see `R22`) should list what each harness supports. If a harness lacks a capability, Specplane should say so and refuse the action, and should not silently use a weaker substitute.

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
All configurations should be accessible and modifiable in both the CLI and harness integrations.

*R25.1: Configuration Permissions*
Changing configuration should have allow, request user and deny permissions. Presets set the mode for each role.

## Default Permissions and Permission Profiles
**R56: Permission Presets**
Permission Presets should be creatable, editable and deletable. Permission presets apply to a group of roles including user and LLM roles. Permission Presets should require the role to have sufficient management permissions AND management level to apply the set of permissions to all the roles to apply.

Presets simply apply permissions to roles and they can still be changed.

*R56.3: Presets with Roles and Rules*
A preset can also include custom roles and LLM role rules (see `R44.1`), which apply while the preset is active. Roles and rules in a preset that ships with Specplane need no separate approval or local trust (see `R48`). Once edited, they follow `R48` like any custom role or rule.

*R56.1: Preset Default Permissions*
Presets additionally define the default permission mode which will apply for all unspecified permission in the preset.

*R56.2: LLM Preset Creation*
A permission should exist that controls whether an LLM role can create a preset. It should have allow, request user and deny modes (see `R52.3`). With request user, the LLM sends a request containing the full preset, and the user is shown a preview of that preset before answering: the permissions it sets, the roles it applies to and its default permission mode (see `R56.1`). The preset is created only if the user accepts the request. Creating a preset does not make it the active preset. Accepting still requires the accepting role to have sufficient management permissions and management level (see `R56` and `R52.2`).

Preset creation is request user for LLM roles in all default presets.

**R57: Default Presets**
The default permission presets are defined below. The default permission for unspecified permission will be deny for these default presets.
*Note: Permissions are separate from role management permissions*

Changing configuration is request user for LLM roles in all default presets. Protected metadata overrides (see `R17.2`) are enabled for users and not for LLM roles in all default presets.

Spec approval is request user for LLM roles in all default presets.

1. Architecture-Level LLM Control (Default)
This preset enables LLM editing of architecture while keeping all actions that edit other specifications as request-only. View-only permissions are enabled for all  specifications. Users have all permissions enabled.
2. Full Manual Editing
This preset disables all LLM editing permissions over all specifications while only enabling read-only permissions and other miscellaneous permissions to the LLM. Users have all permissions enabled.
3. Feature-Level LLM Control
This preset enables LLM editing permissions over feature and architectural specifications needing to request the user for editing requirement specifications. Users have all permissions enabled.
4. Full LLM Control
This preset enables LLM editing permissions over all specification types including the requirement specification. Users have all permissions enabled.
5. Reviewer Approval
Editing permissions as in Architecture-Level LLM Control. The default LLM role cannot approve or reject. A built-in reviewer role, given by a built-in rule to Specplane's reviewer subagent (see `R74`), approves and rejects feature and architecture specifications and plans. Requirement approval stays with the user. Where the harness cannot tell subagents apart, the preset says so and approvals stay with the user.

## Subprojects
**R39: Subprojects**
Specplane should support subprojects, for example, directories that contain feature and architecture specifications. Requirements specifications should also be supported in subprojects. One example is codex integration within specplane itself, which in this case uses centralised requirements and therefore only has feature and architecture specifications for the codex implementation specifically.

*R39.1: Subproject Decisions*
When design of feature and architecture specifications is left to the LLM (where enabled by the user and a requirements specification exists), the LLM should make subprojects where needed. One example is codex and claude integration in specplane where feature and architecture of claude and codex integration should be separate from general specplane features.

*R39.2: Subproject References*
Subprojects should be able to reference requirement, feature and architecture specifications.

*R39.3: Subproject IDs*
Requirement IDs must be unique within the root project and within each subproject. References to another subproject or the root project name it as well as the ID.

*R39.4: Subproject Precedence*
Root project requirements outrank subproject requirements. Within a subproject, `R65` applies.

**R70: Unresolved Approval Targets**
When the user runs a typed approve command with a name that is not an exact ID, the harness should not approve anything. Instead it should list the closest matching specification, plan and decision IDs and let the user pick one to approve. When the LLM is asked in plain language to approve something, it resolves the IDs itself and uses its own approval permission, sending a request where the permission is request user (`R52.3`).

**R71: Denied Commands Skip the Model**
When a command would start a model turn, the harness should first check the permissions the command cannot do anything without. If the LLM role has any of them as deny, the harness refuses the command before the turn starts, names the denied permission, and spends no model call. A permission that is allow or request user does not block the turn, since the LLM can still act or send a request (`R52.3`). Permissions that only some uses of a command need do not trigger this refusal. A typed command that the user's own role can complete mechanically, such as approve with exact IDs, runs under the user's permissions and starts no model turn at all.

**R72: Installed Files Follow the Package**
When Specplane is updated, the files it installed into a project (harness rules, skills, hooks, the managed `AGENTS.md` block, command contracts) should not need `specplane init` to be run again by hand. At the start of a harness session, and whenever `validate` runs, Specplane should compare each installed file's version stamp with the running version.

*R72.1: Safe Refresh*
A file that still matches the content Specplane last wrote (its recorded hash) is refreshed automatically, and the harness reports in one short line which files changed. A file the user has edited is never overwritten: it is left as it is and listed with a warning that names the command to refresh it. Refreshing writes only Specplane's own installed files and never touches specs, requirements, configuration or role files.

*R72.2: Same Result as Init*
An automatic refresh produces the same files that `specplane init` would for the installed harness, and `init` stays available and safe to repeat.

**R73: Rejecting Specifications**
A role with the approval permission for a specification's type can reject it, with findings. A rejection is stored as a record like an approval, tied to the content that was rejected. A rejected specification stays Awaiting Review with the findings as the reason. After a rejection, an LLM can approve that specification only once its content has changed; the user can approve it at any time. Approvals and rejections record the role and, for an LLM, its agent type and model, and may carry findings. The same applies to a plan's final review (see `R28`).

**R74: Built-in Reviewer**
Specplane installs a reviewer subagent definition for each supported harness, with instructions written to keep the review independent of the agent that did the work. The reviewer gathers the content under review and what it cites through Specplane itself rather than relying only on the requesting agent's description. The built-in rule matches this agent only while its definition is the one Specplane installed or one the user has approved, so another agent with the same name does not get the reviewer role.

*R74.1: Configurable Reviewer*
The user can edit or remove the reviewer definition, the reviewer role and its rule, like any other role, rule or installed file (see `R48` and `R72.1`). An edited definition keeps the reviewer role once the user approves the change. Specplane never restores a removed or edited part on its own.

**R75: Project Setup**
Setting up Specplane in a project should take one command run by the user, after which everything else can be done from the harness. Setup detects the installed harnesses and asks which to set up, asks which preset to use (see `R57`), creates the specification folders with an example requirement and feature specification, and offers to commit the configuration, since configuration applies only once committed. It makes approval records travel with the user's normal pushes and fetches, and names any step it cannot do itself, such as trusting the project in the harness. Each question has a default, and one option accepts every default without asking.

*R75.1: No Terminal After Setup*
After setup, every step a user needs to reach an approved specification should be available from the harness. Where the user must confirm an action, the harness asks for that confirmation itself instead of telling the user to run a command in a terminal.

**R76: Temporary Grants**
The user can grant an LLM a permission its role does not have, from inside the harness, for one action or for the rest of the session. The grant shows exactly what it allows, asks the user to confirm it once, expires on its own and is recorded in the audit log. Only the user can grant: an LLM cannot start, request or confirm a grant, and the harness must offer it through a route the LLM cannot use. Where a harness has no such route, it says so and the grant is not offered there.
