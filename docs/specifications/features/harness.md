---
id: feature/harness
title: Harness
status: approved
approval:
  by:
    llm: claude-sonnet-5-5
    delegated-by: spiralsky
  date: 2026-11-09
  commit: 9d26072570c2908b53b6ebca8958aef7fdbb32bc
  note: approved by the LLM, not a human, under the user's 2026-11-09 delegation (hand-edited; see docs/work-records/2026-11-09-spec-format.md)
authors:
  - llm: claude-sonnet-5-5
    contribution: drafted
covers: [R14, R18, R19, R19.1, R19.2, R20, R20.1, R21, R21.1, R26, R26.1, R26.2, R34, R35, R35.1, R38, R38.1, R47]
references: [R4, R10, R11, R16, R22, R24, R27, R37, R61.1, R66, later-releases R37, later-releases R37.1, later-releases R66, requests R52, roles-and-permissions R50, roles-and-permissions R57, steering R51, steering R59, specifications R9, configuration R25, plans R30.1, specifications R11.3]
---

# Harness

A harness is the environment in which an LLM works with the user, for example Claude Code or Codex. This spec describes what Specplane provides inside a harness: how commands typed by the user run, how instructions reach the LLM, how specifications are written, approved, retrieved and reviewed through it, which harnesses are supported, and what the LLM may not do (call the CLI). Permissions are decided by roles (`roles-and-permissions R50`); this spec states which permission each harness action uses. Parts marked as a later release follow `docs/release-plan.md`: spec viewing (`R21`) and spec review (`R38`) come after the first release. Everything else here is part of the first release.

## §1 Terms

- **Harness command:** a command the user types in the harness, such as `/requests` (placeholder style). It is run by Specplane, not interpreted by the LLM.
- **Instructions:** text Specplane gives the LLM about a command, a permission or a workflow. Steering is the part that keeps the LLM within its role (`steering R59`).
- **In context:** the LLM has already received the instructions in the current conversation and they have not been lost to compaction.
- **Capability:** something a harness can do, such as loading instructions on demand, push notifications, subagents or showing a specification to the user.

## R14: Command Instructions

Commands carry instructions, and sometimes optional content, that Specplane gives to the LLM when the command runs. Other specs say what a given command carries (for example `steering R59`, `steering R51` and `requests R52`); this section says how and when they are delivered.

- **Sent when needed.** Instructions for a command are delivered when the command is used, not carried in every session. Standing instructions that always apply are described in `§2`.
- **Not sent twice.** If the instructions are already in context, they are not sent again.
- **Sent again when unsure.** If Specplane cannot tell whether the instructions are in context, or the context has been compacted, it sends them again.
- **Use what the harness does better.** If the harness can load instructions on demand (skills loaded when needed, for example), Specplane uses that instead of sending the text itself. The behaviour the user sees is the same.
- **Customisable.** The user can change the instructions for a command. By default they are the command's documentation (`R22`). A customisation changes only the text; it cannot remove a limit that Specplane checks itself (`roles-and-permissions R50`). Where the configuration option lives is described in `configuration R25`.
- **Optional separation check.** Where the harness helps write specifications, optional instructions can ask the LLM to verify that feature and architecture content is separated and to warn the user per change or per review (`R4`). They are configurable and can be turned off.
- **Migration prompt.** The prompt used by the project migration command is one of these instructions and is configurable the same way (`R66`, `later-releases R66`, a later release).
- **Cannot deliver.** If a harness cannot deliver instructions at the point a command runs, Specplane delivers them at the nearest earlier point it can, for example the start of the session, and tells the user. It does not pretend they were delivered (`R35.1`).

Scenario: Given the LLM already received the instructions for the plan commands in this conversation, When the user runs a plan command again, Then the instructions are not sent again.

Scenario: Given the context was compacted after the instructions were sent, When the user runs the command, Then the instructions are sent again.

Test (deterministic): run a command twice in one session on a harness that reports its context, and check the instructions are sent once; simulate compaction and check they are sent again.

## R18: Harness - General commands

When the user types a harness command, the harness runs it itself and passes arguments to the LLM only if there are any.

- A command without arguments makes no LLM call. For example, a command that opens a pane or shows a status does not start a model turn.
- A command with arguments passes only those arguments to the LLM, together with the instructions that belong to the command (`R14`).
- The command runs under the role of the person who typed it. A person who types a command acts as themselves, not as the LLM (`roles-and-permissions R50`).
- This does not limit what the LLM can do. An LLM can do what its own role allows by the same means, for example by being asked in plain language to approve a specification (`R20`). The command is a convenience for the user, not a gate in front of the action.

Scenario: Given the user types a command with no arguments, When it runs, Then the result appears without a model turn.

Scenario: Given the user asks the LLM in plain language to do something its role allows, When the LLM acts, Then it does so under its own role and the same permission checks apply as for a typed command.

## R47: CLI-Harness Separation

The Specplane CLI is not directly callable by an LLM inside a harness. The CLI is for people; the harness is the LLM's route into Specplane.

- Inside a supported harness, Specplane blocks the LLM from running the Specplane CLI, using what the harness offers for that. A harness that cannot block it says so (`R35.1`).
- Steering tells the LLM not to call the CLI and to ask the user to run a command instead where needed (`steering R59`). Steering guides; the block above is the enforcement.
- What the LLM needs from Specplane is provided as harness actions, each checked against the LLM's role. Nothing an LLM needs requires the CLI.
- A person using the CLI in their own terminal is not affected. The stronger guardrails against running the CLI through a side route (such as a headless session) are described in `roles-and-permissions` and are a later release.

Scenario: Given an LLM in the harness tries to run a Specplane CLI command, When the harness checks it, Then the command is not run and the LLM is told to use the harness actions or ask the user.

## R19: Spec creation, deletion, editing

The user can edit, delete and create specifications in the harness through commands that take natural language arguments. These are actions carried out by the LLM on the user's behalf, so the LLM needs the ability to do them.

- The user describes the change in their own words. The LLM identifies the specification and makes the change. A new specification starts as Awaiting Review, and an edit to an approved specification makes it Awaiting Review (`specifications R11.3`).
- Each action is checked against the LLM's role (`R19.2`). A denied action is refused and says which permission applies. A request-user action sends a request and the change is made only if the user accepts it (`requests R52`).
- Creating, editing or deleting a specification never approves it (`roles-and-permissions R57`).

### R19.1: Change Granularity

When the LLM changes a specification, it adds itself as an author, with details of what it contributed, in the specification's metadata (`R10`). How fine this is depends on the size of the change: one record per change, per section, or per session. The LLM does not record authorship it did not do, and a human is never recorded as an author of text they did not write.

- Recording LLM authorship is on by default and the user can turn it off (`configuration R25`).

### R19.2: Spec management Permissions

Whether a role may edit, delete or create specifications is controlled by granular permissions: one for each of edit, delete and create, for each type of specification (requirement, feature, architecture). Each permission has the modes allow, deny and request user.

- A role with allow does the action without asking.
- A role with request user sends a request to the user, who sees the change as a difference from the last approved text (`requests R52`).
- A role with deny cannot do it, and the LLM is told so (`steering R51`).
- Which role holds which mode by default is in the default presets (`roles-and-permissions R57`). Plan steps that write specifications follow these permissions too (`plans R30.1`).

Scenario: Given the LLM role has request user for editing feature specifications, When the user asks the LLM to change a feature spec, Then the user gets a request showing the change, and the file changes only if the user accepts.

Scenario: Given the LLM role has deny for editing requirement specifications, When the user asks the LLM to reword the requirements, Then it refuses and says which permission applies.

Test (deterministic): with each of the three modes set, run an edit through the harness and check it is made, held as a request, or refused.

## R20: Spec approval

The user can approve a specification in the harness with a command that takes a direct specification reference, such as its ID. It runs under the same checks as the CLI (`R16`, `R61.1`) and does not use an LLM (`R18`).

The user can also ask the LLM in natural language to approve a specification, for example "Plan Execution". The LLM identifies the specification and then uses its own approval permission (`R20.1`), under the same checks:

- Allow: the specification is approved.
- Request user: a request is sent to the user (`requests R52`).
- Deny: the LLM refuses.

An LLM never approves by editing a file; approval is recorded only through the approval action, which checks the role (`roles-and-permissions R57`).

### R20.1: Spec approval Permissions

Spec approval has the modes allow, deny and request user.

- The user documentation (`R22`) states that an LLM role with allow approves without confirmation, and that steering does not guarantee the LLM asks first.
- Where confirmation is needed, the role should use request user.
- Approval of specifications needs its own permission, separate from the permission to edit them (`R19.2`).

Scenario: Given the LLM role has request user for approval, When the user says "approve Plan Execution", Then a request is sent and the specification is approved only after the user accepts it.

Scenario: Given the LLM role has allow for approval, When the user says "approve Plan Execution", Then it is approved with no further question, and the documentation warned that this would happen.

Test (deterministic): with each mode set, ask for approval by name and check the outcome is approved, requested or refused.

## R26: Information Retrieval

The LLM can retrieve the information for a specification, including every section of other specifications that it references, and only the referenced sections. The goal is fewer read attempts: one retrieval gives the LLM what it needs to work on a specification without reading each referenced file in full.

- The result names the specification, then each referenced section with its source, so the LLM can tell where text came from.
- A reference to a part of a specification, such as `specifications R9`, returns that section and its subsections only.
- If a referenced section does not exist, the result says so rather than leaving it out.
- Retrieval is read-only.

### R26.1: Retrieval Configurability

Retrieval is flexible and controllable. The LLM or user can ask for several related specifications at once or for a single one, and can choose whether referenced sections are included. Whether the default includes referenced sections is configurable (`configuration R25`).

### R26.2: Information Retrieval Permissions

Information retrieval has the modes allow, deny and request user.

- Spec viewing (`R21.1`) and spec review (`R38.1`) use this permission and have none of their own.
- A role with deny cannot retrieve and the LLM is told so (`steering R51`). The default LLM role has allow (`roles-and-permissions R57`).
- Retrieval does not depend on whether the role may edit the specification. A role that cannot write a specification can still read it, retrieve it and review it.

Scenario: Given a feature spec cites two sections of other specs, When the LLM retrieves it, Then it gets the spec and those two sections only.

Test (deterministic): retrieve a specification with citations and check the result has exactly the cited sections.

## R21: Spec Viewing (Optional, per harness)

Later release. If the harness can show a specification to the user, Specplane adds a command that lets the user view a specific specification directly. If the specification changed since it was last approved, the change is highlighted.

- It is a user command with no LLM involvement (`R18`).
- A harness that cannot show specifications does not offer it, and Specplane says so (`R35.1`).
- A specification that was never approved is shown without highlighting.

### R21.1: Spec Viewing Permissions

Spec viewing uses `R26.2` and has no permissions of its own. The user documentation states this (`R22`).

## R38: Spec reviewal and discussion

Later release. A command lets the LLM review each specification and give feedback. It points out problems and possible gaps in feature and architecture specifications, and asks the user questions about the requirement specification where it needs clarification. It also covers grammar mistakes, poor wording and unclear instructions across all specifications.

- Review is read-only. The LLM does not change files, with one exception: when user decision records are enabled it can store the user's decisions (`R37`, `later-releases R37`, permissions `later-releases R37.1`).
- Feedback goes to the user in the conversation. A change that follows from feedback is a separate action under `R19.2`.

### R38.1: Spec reviewal permissions

Spec reviewal uses `R26.2` and has no permissions of its own. The user documentation states this (`R22`). A role without permission to edit a specification can still review it.

## R34: Harness Flexibility

Adding a harness requires building only its integration, with no change to Specplane's core behaviour.

- Every harness gets the same behaviour from the core: the same commands, permissions, steering and requests. A harness differs only in how it delivers them and in capabilities it lacks (`R35.1`).
- A harness does not add rules of its own that contradict what the specifications say.
- Specplane never picks a harness for the user from files that happen to be installed. The user names the harness at setup (an assumption, not on the page).

## R35: Supported Harnesses

Specplane aims to support Codex and Claude Code. Specplane's own text and rules are the same for both; each harness has its own way of installing and delivering them.

### R35.1: Harness Capabilities

Plan execution (`R27`) is required on every supported harness. Other capabilities can differ between harnesses.

- The user documentation lists what each harness supports (`R22`).
- If a harness lacks a capability, Specplane says so and refuses the action. It does not quietly use a weaker substitute, such as telling the user to run the CLI instead or skipping a check it cannot make.
- When a harness cannot enforce a thing it was asked to enforce, for example a budget it cannot measure or blocking the CLI (`R47`), Specplane says so when it is set up and does not claim enforcement.

Scenario: Given a harness cannot show a specification, When the user runs the view command, Then Specplane says the harness lacks the capability and does nothing else.

## §2 Standing instructions

Some instructions apply even when no command is running. They are given to the LLM in every session and are short.

- They say Specplane is in use, tell the LLM to read the configuration before acting on specifications or plans and to resolve paths from it, and point to the steering for its role (`steering R59`). They do not repeat steering, rules or procedures; the details arrive with the command that needs them (`R14`).
- Assumption, not on the page: instruction files in the project that belong to its maintainers, such as `AGENTS.md` or `CLAUDE.md`, are never overwritten or reordered. A harness delivers the standing instructions through a file or place Specplane owns. Where the harness has none, Specplane may add one clearly marked block to a shared instruction file (a project may instead forbid this, as Specplane's own repository does) and changes only that block when updating. Text outside it belongs to the user.
- A user who edits inside the marked block loses the edits at the next update; the block says so.
- When steering is regenerated (`steering R59`) the standing instructions are refreshed in the same way. Specplane warns when the delivered text is missing or older than the installed Specplane (`R24`).
- An LLM in a project without Specplane configuration does not apply Specplane rules.
- Commits an LLM makes in a Specplane workflow identify the workflow, plan and step where there is one, and the session, without replacing the git identity of the person or account. Ordinary work does not need a plan or these markers.

Scenario: Given a project whose `AGENTS.md` holds the team's own rules, When Specplane sets up the harness, Then the team's text is unchanged and Specplane's block is added once; a later update replaces only that block.

## §3 Edge cases

- Two harnesses installed in one project share the same text and do not replace each other's delivery.
- A command whose instructions the user emptied runs normally; only the extra instructions are absent. Limits checked by Specplane still apply.
- If specification text is retrieved while its referenced section is in a specification that is Awaiting Review, the result still contains it and marks it as awaiting review (`R11`).
- Typing a command that the user's role may not run is refused with the permission named.
