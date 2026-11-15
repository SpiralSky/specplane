---
id: feature/cli
title: CLI
authors:
  - llm: claude-sonnet-5-5
    contribution: drafted
covers: [R16, R16.1, R17, R17.1, R17.2, R33, R33.1]
references: [R11.1, R11.2, R13.1, R18, R20, R22, R47, R61.1, specifications R9, specifications R10, specifications R11, plans R29, plan-execution R31.1, roles-and-permissions R42, roles-and-permissions R50, roles-and-permissions R57, roles-and-permissions R58, harness R20, harness R47, verification R61, configuration R25, R9, verification]
---

# CLI

The CLI (`specplane`) is Specplane's own command line tool. It is meant for people managing a project by hand: approving specifications, correcting their metadata, and managing plans. It is not meant to be run inside a harness. This spec describes what a person can do with it and which permissions apply. Who holds a permission is decided by roles (`roles-and-permissions R50`); this spec defines the actions. Commands that read or run tests, validate the project or show the audit log belong to `verification`. Settings are changed as described in `configuration R25`. Plan management (`R33`) is a later release; approval and specification metadata follow the first release (`docs/release-plan.md`).

## §1 Terms

- **Approve:** set a specification to Approved (`specifications R11`), recording who approved it and on which commit.
- **Group:** specifications that reference each other, directly or through other specifications. A group is approved as one unit.
- **Override:** a change to metadata that Specplane would otherwise calculate itself, made by hand through the CLI. Status, the approver and test results are the protected overrides (`R17.2`).
- **Role:** the role the person is acting as in the CLI, Standard User or Administrator (`roles-and-permissions R42`). Every CLI action is checked against its permissions.

## R16: Specification Approval

A person approves a specification with a command that takes one or more specification IDs. The command only takes IDs. Natural language is never interpreted by it, and it never uses an LLM (`R18`).

- **Who approved.** The person running the command is recorded as the approver, along with the commit approved and the other metadata Specplane keeps for approval (`R11.1`). The record is attached to git and does not change the spec file or add a commit to the branch (`specifications R11`). The person cannot choose another name.
- **Committed content only.** Approval applies to the committed content of the specification (`specifications R11`). If the file has uncommitted changes, the command refuses and says so.
- **Unapproved references.** The command fails if any part of the specification references a specification that is not approved. The failure names the referenced specification and its status.
- **Missing references.** The command fails while the specification references a part of a specification, or a requirement, that no longer exists (`R11.2`). The failure names the missing part.
- **Groups.** Specifications that reference each other are approved together in a single command (`§2`). Naming one member of a group approves the whole group. Before approving, the command warns the user and lists every specification in the group, and the user confirms, unless the command is given a flag that confirms in advance so that scripted approval still works (an assumption: the page only asks for the warning and the list). If any member cannot be approved, nothing in the group is approved and every reason is listed. The documentation describes group approval (`R22`).
- **Failed tests.** A specification with a recorded failed test cannot be approved (`R61.1`; test results are described in `verification R61`).
- **Nothing partial.** Approving several IDs in one command either approves all of them or none, and when it refuses it lists every reason it found, not only the first.
- **Already approved.** Approving a specification that is already Approved does nothing and says so.
- **The result.** After approval the specification is Approved, shows who approved it and when, and anything that cites it is checked again as usual (`R11.2`).

The approval command in a harness is the same action. It runs under the same checks as this command, no LLM is used to decide, and a harness role needs the same permission (`harness R20`, `R16.1`). An LLM asked in natural language to approve uses its own approval permission and then the same checks (`R20`). In every case the checks above are the same; only who is asking differs.

Scenario: Given `feature/a` is Awaiting Review and cites `feature/b`, which is also Awaiting Review and cites nothing, When the user approves `feature/a`, Then the command fails and says `feature/b` must be approved first.

Scenario: Given `feature/a` cites `feature/b` and `feature/b` cites `feature/a`, both Awaiting Review and committed, When the user approves `feature/a`, Then the command lists both, asks for confirmation, and approves both with the user recorded as approver.

Scenario: Given `feature/a` cites part `R9` of `feature/b`, and `R9` was deleted from `feature/b`, When the user approves `feature/a`, Then the command fails and names the missing part `R9`.

Scenario: Given a specification with uncommitted edits, When the user approves it, Then the command refuses and tells the user to commit first.

Test T1 (deterministic): approve a specification that cites an Awaiting Review specification and expect failure; approve a two-specification cycle and expect both Approved with the same approver; approve a cycle where one member cites a missing part and expect neither is approved.

### R16.1: Specification Approval Permissions

Approving a specification has one permission for each specification type: `spec.approve.requirement`, `spec.approve.feature` and `spec.approve.architecture`. Each controls whether a role may approve a specification of that type, from the CLI or from the harness.

- Each has the three modes (allow, request user, deny) as described in `roles-and-permissions R50`. In the default presets each is request user for the LLM role and allow for the Standard User (`roles-and-permissions R57`).
- The permission does not change the checks in `R16`. A role with allow still cannot approve a specification that fails them.
- A group needs the permission of the type of every member. A group is not approved if the role lacks the permission for any member, and nothing is approved; if any member needs a request, one request is sent for the whole group. Decision records and plans are approved under the feature permission.
- Approval is never part of another permission. Editing, creating or overriding metadata does not include it.

Scenario: Given a role with deny for approving specifications, When it runs the approval command, Then nothing is approved and the output names the permission that refused.

Test T1 (deterministic): run the approval command with the permission set to each of the three modes and check that approval happens only for allow and that request user leaves a pending request.

## R17: Specification Metadata

A person can read and change all aspects of a specification's metadata from the CLI: its title, authors, references and covered requirements as written in the file, and its status, the approver and the commit approved, and recorded test results as Specplane keeps them beside the commits (`specifications R9`, `specifications R10`, `specifications R11`).

- **It is an override.** A change here is made by hand and does not go through the checks Specplane normally applies. For example, setting a status here does not run the approval checks in `R16`.
- **Visible in the audit log.** Every change is recorded in the audit log with who made it, when, the old and the new value (`R13.1`).
- **Marked as an override** where it replaces a calculated value, as described in `R17.2`.
- **Reading** metadata shows the current values, and marks which ones are overrides.
- **Content is not metadata.** This command does not edit the body of a specification. A change to metadata alone does not make a specification Awaiting Review (`specifications R11`).

Scenario: Given a specification with a wrong title in its metadata, When a person with the metadata permission changes the title, Then the title changes, the audit log records the old and new title, and the status is unchanged.

Test T1 (deterministic): change one metadata field through the CLI and check that the field has the new value and that one audit entry names the field, old value, new value and user.

### R17.1: Specification Metadata Permissions

Specification metadata has these permissions, each with the three modes:

- **Read metadata.**
- **Manage metadata (general).** Writing any metadata, except the protected overrides of `R17.2`. It covers everything below.
- **Granular write permissions**, one for each piece of metadata, so that a role can be allowed to write one piece without writing the others. The pieces are: title, authors, references, covered requirements, and the approval records that are not protected (the approval date and commit).

A role may write a piece of metadata if it has either the general permission or the granular permission for that piece, subject to the mode. If the two differ, the more permissive mode wins (an assumption: the page does not say how the two combine). Deny on the general permission does not remove a granular allow.

Scenario: Given a role with allow for the authors permission only, When it changes the authors of a specification, Then the change is made; When it changes the title, Then it is refused naming the title permission.

Test T1 (deterministic): with only the granular authors permission set, change authors and expect success, change the title and expect refusal.

### R17.2: Protected Metadata Overrides

Three overrides each have their own permission, and general metadata management does not include any of them:

- **Override status.** Setting the status of a specification by hand.
- **Override approver.** Setting who approved a specification.
- **Override test results.** Setting or clearing the recorded result of a specification test (`verification R61`).

The rules:

- Only the Administrator has these permissions by default, through having all permissions (`roles-and-permissions R42`). They are not enabled for any role in a default preset (`roles-and-permissions R57`).
- An override is marked as an override in the record it creates and in the audit log, naming who made it. The mark stays until the value is replaced by a normal Specplane action, such as a new approval.
- An override of status never skips later recalculation: when the specification or a part it cites changes, status follows `R11.2` and `specifications R11` again.
- An override of test results is shown as an override wherever test results are shown, so a reader can tell it from a run.

Scenario: Given a Standard User, When they try to set a specification's status to Approved by metadata, Then it is refused naming the status override permission.

Scenario: Given an Administrator who sets the approver to another person's name, When the metadata is shown, Then the approver is shown with the mark that it is an override and the audit log names the Administrator.

Test T1 (deterministic): set each protected value as the Administrator and check the override mark in the metadata and one audit entry; repeat as the Standard User and check refusal.

## R33: Plan Management

A person can manage plans from the CLI by changing plan metadata: a plan carries the same metadata as a specification (`plans R29`). A person runs `plan meta get <id>` and `plan meta set <id> <field> <value>`.

- Changes made here are overrides and are recorded in the audit log in the same way as for specifications (`R17`, `R13.1`).
- This is about metadata. Starting, resuming, stopping and finishing plans, and the plan's steps, are described in `plans R29` and `plan-execution R31.1`, and in a harness they are LLM actions that follow the LLM's role.
- Reading plan metadata shows the current values, including the plan's approval status and the plan's execution status as `plans R29` describes them.

Scenario: Given a plan with an outdated title in its metadata, When a person with the plan metadata permission changes it, Then the plan's title changes and the audit log records the change.

### R33.1: Plan Metadata Permissions

Plan metadata has a read permission, a general write permission that covers all plan metadata, and granular write permissions per piece of metadata, each with the three modes. They combine as in `R17.1`. There is no protected override for plans in this release.

The settable pieces are the title, the authors, the references and the specifications the plan implements or writes. Execution status and progress are shown but not settable: they change through the plan commands. A plan that is archived, completed or abandoned cannot be changed. Changing the title, references or specifications changes the plan's content, so the plan is Awaiting Review again; changing the authors does not.

Scenario: Given a plan whose execution status is stopped, When a person tries to set its status by metadata, Then it is refused and names the plan commands.

Test T1 (deterministic): set each piece as a person with and without the matching permission, check the audit entry with old and new values, and check that status is refused.

## §2 Edge cases

- **Approval order.** Specifications that need another to be approved first are approved after it, or together with it if they reference each other (`R16`). A specification that references an Awaiting Review specification that is not part of its group must wait for that one.
- **Chains.** If `a` cites `b` and `b` cites `c`, and `c` does not cite back, approve `c`, then `b`, then `a`. The first command that names `a` fails and names `b`.
- **Two cycles joined.** A group includes everything reachable in both directions through citations, so a specification that cites a cycle but is not cited back is not part of it.
- **Approval during a plan.** A plan does not approve the specifications it edits (`specifications R11`); approving them is a separate action by the user.
- **Reapproval after metadata change.** Changing metadata alone does not reopen a specification, and does not approve one either.
- **No LLM.** The CLI is not callable by LLMs in the harness (`R47`, `harness R47`): an LLM asks the user to run a CLI command rather than running it, and the user's CLI permissions are the user's own. A person running the CLI in a terminal outside the harness acts as themselves, with the role that applies to them.
- **Headless and guardrails.** Preventing an LLM from using the CLI through a shell or a headless session is described in `roles-and-permissions R58`.
- **Same checks everywhere.** Approving from the CLI, from a harness command and by asking an LLM all end in the same checks; only the permission used differs.
