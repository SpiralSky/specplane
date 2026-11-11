---
id: feature/cli
title: CLI
status: approved
approval:
  by:
    llm: claude-sonnet-5-5
    delegated-by: spiralsky
  date: 2026-11-09
  commit: 17593fb2d8b9e511414505bbc75c799d37eb5297
  note: approved by the LLM, not a human, under the user's 2026-11-09 delegation (hand-edited; see docs/work-records/2026-11-09-spec-format.md)
  fingerprint: spec-v3:sha256:3849a1a579ad520ab7f0e46baacbcf52c316a45474d285d9e798049439a9af3d
  cited:
    R16: sec-v1:sha256:3502177c2bc715f4d662d3bc5442b9c87f431d27f47ae2c5a574ec6528a364ea
    R16.1: sec-v1:sha256:9c8cc6fe04de7202d76a9a8c7ca612fce0cb1aafe38f7ead0eb38e1fa9c3dd5c
    R17: sec-v1:sha256:4f107e162972c3d29b2b11458054005642855b0e1e6cdafd6e3cc8c20103a694
    R17.1: sec-v1:sha256:93a78c3118f5672de8ca159f7b33c6f060ae8406f1ef7a4fa1b463b54176458f
    R17.2: sec-v1:sha256:de4223ef43d8165839f793c9df3cb6345076941af0045d0c87361735a1ef64eb
    R33: sec-v1:sha256:5b8559ccf07969d062201ec2dd35563e21b03a619d514337da899c3d2fec4d22
    R33.1: sec-v1:sha256:b44daa9e230cd6a68c2df195122c756bbce8889365ee179b7fa6e85d69504bd7
    R11.1: sec-v1:sha256:7bf709eb5b4666fdbf8b696d64f53d34105853e4c5ed2e5e94736413a2fd8505
    R11.2: sec-v1:sha256:afcaf48f6c11dc6ab83134a95c72322e891a5bff9f296cabe9bda28400d3e861
    R13.1: sec-v1:sha256:847f7387b19758600e7498a0b329fa4681747b474745e7bc10935acb0550fe61
    R18: sec-v1:sha256:f8638c210b1f25a3dcf8a55c5f3919bc18be649f8d396857afafd8c89e8f3e7a
    R20: sec-v1:sha256:e504a6fb35a8e7416c317b08613e6950cf4050b49f40213d1c152fdc56eede09
    R22: sec-v1:sha256:3447e20b17238f3f89477fa7bffbdd2bc9ce994e0abedb6687f26536e580ceba
    R47: sec-v1:sha256:fe34b03e48652f20bf25ef6b4e150b084b73f3d30a552a60d1ce3e1d50afb68c
    R61.1: sec-v1:sha256:63f91112b7067d4352621bd1c174f03d7e599ab96cca99c3dc674a09e9e3cb2c
    specifications R9: sec-v1:sha256:faa3544c96036f5eb5010877f99d4e5bd3e346628f86440922d0b919ba0203e7
    specifications R10: sec-v1:sha256:da377d2da649662a194aadf3214d2b0284eb19ee156cfe48a3cd3490102d782c
    specifications R11: sec-v1:sha256:57fb631a35838abb06b893d183aae50c7cd3ab7d8e322aae1b81908c1be1f94e
    plans R29: sec-v1:sha256:3fe70a4219adab63a737d32016915ed60a5fcebed12fa497d026c1b66bb1eb7d
    plan-execution R31.1: sec-v1:sha256:bac85a98405325af2ed382a8ef7d41a7d6065a3dd5401ed330eaa852f184c4e7
    roles-and-permissions R42: sec-v1:sha256:bf5c701b7be78ea0f002a6ae7ea6086718d25a4eea136d17d2d38eb847a3f22d
    roles-and-permissions R50: sec-v1:sha256:6e06bc008e3c498900010a6e4117f60f0626279609ce22d6b0bcb36c4c245ce2
    roles-and-permissions R57: sec-v1:sha256:1b06f3e6eaf07d7054ecb2cfcd8fb151df181db7d98bba461eae8802dd944f38
    roles-and-permissions R58: sec-v1:sha256:d7ec215e8a95f13439d06e3727cf9048f635da9c3bf3b6f993671f6edf3944ff
    harness R20: sec-v1:sha256:5bee5d75e8ce4a7bab24183624e0a504c6246f286a07ad4181d8b19f6aeaab87
    harness R47: sec-v1:sha256:00141da5fe320b391ee24b77a44a26f4771c990c0fc6df86dc6bb6bad7596471
    verification R61: sec-v1:sha256:8faf1fe8368dd68ecc9eaf7104385c4bf47d9db883e0bdcfbcf8323b9b38a87d
    configuration R25: sec-v1:sha256:e07f837db35bfe39bbd28e56e36f3bbb1d0afc25bc3b8784f90a92be6d49b071
    R9: sec-v1:sha256:5a307f37b0f358e2e7f96ba80fb97ce16e2a0a8f1cf9d7ec3ec75bec4a348bec
    verification: spec-v3:sha256:b57ebad1ae275a2bf7fc5d0818467d26c4987151616b20efdde421dd1dbbd5ed
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

Approving a specification has a single permission. It controls whether a role may approve, whatever the specification's type, from the CLI or from the harness.

- It has the three modes (allow, request user, deny) as described in `roles-and-permissions R50`. In the default presets it is request user for the LLM role and allow for the Standard User (`roles-and-permissions R57`).
- The permission does not change the checks in `R16`. A role with allow still cannot approve a specification that fails them.
- The permission is needed for every specification in a group. A group is not approved if the role lacks the permission, and nothing is approved.
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

A person can manage plans from the CLI by changing plan metadata: a plan carries the same metadata as a specification (`plans R29`). This is a later release.

- Changes made here are overrides and are recorded in the audit log in the same way as for specifications (`R17`, `R13.1`).
- This is about metadata. Starting, resuming, stopping and finishing plans, and the plan's steps, are described in `plans R29` and `plan-execution R31.1`, and in a harness they are LLM actions that follow the LLM's role.
- Reading plan metadata shows the current values, including the plan's approval status and the plan's execution status as `plans R29` describes them.

Scenario: Given a plan with an outdated title in its metadata, When a person with the plan metadata permission changes it, Then the plan's title changes and the audit log records the change.

### R33.1: Plan Metadata Permissions

Plan metadata has a read permission, a general write permission that covers all plan metadata, and granular write permissions per piece of metadata, each with the three modes. They combine as in `R17.1`. There is no protected override for plans in this release.

## §2 Edge cases

- **Approval order.** Specifications that need another to be approved first are approved after it, or together with it if they reference each other (`R16`). A specification that references an Awaiting Review specification that is not part of its group must wait for that one.
- **Chains.** If `a` cites `b` and `b` cites `c`, and `c` does not cite back, approve `c`, then `b`, then `a`. The first command that names `a` fails and names `b`.
- **Two cycles joined.** A group includes everything reachable in both directions through citations, so a specification that cites a cycle but is not cited back is not part of it.
- **Approval during a plan.** A plan does not approve the specifications it edits (`specifications R11`); approving them is a separate action by the user.
- **Reapproval after metadata change.** Changing metadata alone does not reopen a specification, and does not approve one either.
- **No LLM.** The CLI is not callable by LLMs in the harness (`R47`, `harness R47`): an LLM asks the user to run a CLI command rather than running it, and the user's CLI permissions are the user's own. A person running the CLI in a terminal outside the harness acts as themselves, with the role that applies to them.
- **Headless and guardrails.** Preventing an LLM from using the CLI through a shell or a headless session is described in `roles-and-permissions R58`.
- **Same checks everywhere.** Approving from the CLI, from a harness command and by asking an LLM all end in the same checks; only the permission used differs.
