---
id: feature/plans
title: Plans
status: approved
approval:
  by:
    llm: claude-sonnet-5-5
    delegated-by: spiralsky
  date: 2026-11-09
  commit: eb3828a72200f6445cd9e9d7199de7f952896a20
  note: re-approved by the LLM, not a human, under the user's 2026-11-09 delegation after the session 16 fixes (hand-edited; see docs/work-records/2026-11-09-spec-format.md)
authors:
  - llm: claude-sonnet-5-5
    contribution: drafted
covers: [R28, R28.1, R29, R29.1, R29.2, R29.3, R30, R30.1, R69]
references: [R7, R9, R11, R11.2, R19.2, R24, specifications R65, plan-execution R27, plan-execution R27.1, plan-execution R27.2, plan-execution R27.6, plan-execution R27.3, requests R52, steering R59, R27, R4, plan-execution R31.1, feature/cli]
---

# Plans

A plan is a managed list of markdown files that says what to change so the implementation follows the specifications, one step at a time. This spec describes what a plan and its steps contain, how a plan records its status and progress, how finished and abandoned plans are archived, how plans use branches, and how a plan can write specifications of a higher layer. How a plan is run, stopped and resumed is described in `plan-execution R27`.

## §1 Terms

- **Plan**: a folder of markdown files, described in `§2`.
- **Step**: one piece of work in a plan, small enough for one working session. It says *what to do*, not how an LLM or tool does it.
- **Shared files**: markdown files in the plans folder that several plans use for metadata or shared memory.
- **Plan record**: everything a plan keeps about itself: its steps, its progress and its notes (`§2`).
- **Target branch**: the branch the plan is meant to be merged into.

## R69: Optional plans

Plans are optional. A project can write specifications, implement them, verify them and approve them without ever creating a plan, and nothing is reported as missing because there are no plans.

- Work on a branch that is not a plan's branch is ordinary work. Specplane does not require a branch to be registered or named after a plan.
- Where there is no plan, an LLM records gaps and assumptions in conversation or in the record the user chooses (`specifications R65`).

Scenario: Given a project with no plans, When the user validates it, Then nothing is reported because plans are absent.

## R30: Plan format

A plan is written in a format similar to a specification (`R7`): metadata at the top, then a body, and citations in the same shape. A plan can reference other plans and specifications.

- A plan has an identifier, a title, a status (`R29`), authors, and its references. Authors are recorded as for specifications.
- A plan's identifier is the date it was created followed by two to four words, for example `2026-11-09-plan-editing`. It matches the plan's folder name and never changes, even if the title does. Two plans created on parallel branches with the same identifier show up as an ordinary git conflict.
- A plan is cited as `plan/<id>`. Citing another plan or a specification makes it a dependency of the plan (`R9`), and a reference that does not exist is reported.
- The plan body states, in any order and with any of these left out: the goal, what is in and out of scope, the specifications it implements or writes, acceptance criteria that confirm the plan is complete, risks, and the list of steps with a one-line summary each.
- A plan that references another plan does not start before that plan is completed unless the user says otherwise (`plan-execution R27.6`; this rule is an assumption beyond the page).
- A reference cycle between plans is reported before the plan starts.

Scenario: Given plan A references plan B and plan B references plan A, When the user validates, Then the cycle is reported naming both.

Test (deterministic): validate a plan whose identifier differs from its folder name and expect a mismatch report naming both.

### R30.1: Specification steps

A step can write or change specifications of a higher layer than the implementation it leads to: feature specifications from requirements, and architecture specifications from features.

- Such a step follows the permissions of the LLM's role (`R19.2`). A role that may not write a specification cannot run the step; the plan stops (`plan-execution R27.1`) or sends a request (`requests R52`) instead of writing.
- Specifications a step writes start as Awaiting Review (`R11`). Writing them never approves them.
- A step that implements a specification written by an earlier step in the same plan cannot run until that specification is Approved. Until then the plan stops at that step with a soft stop that names the approval it waits for (`plan-execution R27.3`). No later step runs past it, because the next step is always the lowest-numbered step that is not done; only work inside the held step that does not depend on the specification may continue.
- Each step names the specifications it writes and those it implements, so the dependency is visible before anything runs.

Scenario: Given step 2 writes `feature/export` from a requirement and step 3 implements it, When step 2 finishes, Then `feature/export` is Awaiting Review and step 3 does not run until it is Approved.

Scenario: Given the same plan and the user edits `feature/export` after approving it, When step 3 is about to run, Then it does not run, because the specification is Awaiting Review again.

Test (deterministic): with a plan whose step implements an Awaiting Review specification, ask for the next runnable step and expect that step to be reported as waiting for approval.

## R29: Plan metadata

A plan carries the same metadata as a specification: identifier, title, status as Awaiting Review or Approved (`R11`), authors, and references. A plan's approval is separate from its execution status below (`plan-execution R27.6`).

Additionally a plan records the specifications it implements or writes from. Each is recorded with the commit of the specification the plan was written against, so what the plan meant stays knowable when the specification later changes. Where a plan was written from a specification, that specification's layer is higher than the plan's implementation steps.

A plan changes to Awaiting Review when its content changes or when a part of a specification it references changes, as for specifications (`R11.2`).

### R29.1: Plan execution status and progress

A plan has an execution status, one of:

- **Not started**: the plan exists and has not run.
- **In progress**: a session is working on it, or it can continue from where it is.
- **Stopped**: the plan was halted, by the LLM through a soft stop, by the user, or by a failure, and has not been resumed (`plan-execution R27.1`).
- **Completed**: the final review accepted it (`R28`).
- **Abandoned**: the user decided it will not be done.

A plan in progress or stopped stores its current progress:

- the step it is at, and which steps are done;
- a reference to the session that last worked on it, so it can be resumed (`plan-execution R27.2`);
- for a stopped plan, why it stopped and what a person or a later session must do before it continues.

The plan's handoff notes (`§2`) carry the details of each finished step. The stored progress and the handoff notes together are enough for a new session to continue without reading earlier conversations.

Completed plans are archived automatically (`R29.2`). A plan cannot return from completed or abandoned; the user creates a new plan instead.

Scenario: Given a plan stopped at step 3 with the reason "waiting for approval of `feature/export`", When the user later resumes it, Then it continues at step 3 and the stop reason is cleared.

### R29.2: Archived and abandoned plans

Archived plans rest in a separate directory from other plans, inside the plans folder. Completed plans are moved there automatically when they are completed. Abandoned plans are archived the same way, and the plan's status tells completed plans and abandoned plans apart within the archive. A plan's notes move with it.

- Plans can be deleted. A deleted plan has no status because it no longer exists. Deleting a plan that other plans reference leaves those references reported as missing.
- Archiving does not delete anything and is not a status of its own.
- Archived plans stay citable.

Scenario: Given a plan is abandoned, When the user lists the archive, Then the plan is there with the status abandoned, not completed.

### R29.3: Outdated plan references

If a plan references a specification at an older commit than that specification's latest commit on the current branch, Specplane shows a warning (`R24`). Steering (`steering R59`) tells the LLM to check what changed in the specification before it continues the plan.

- The warning names the plan, the specification and both commits.
- It does not block the plan. After the user or the LLM has checked what changed, the plan's reference can be updated to the newer commit.

Scenario: Given a plan references `feature/export` at an old commit and a later commit on the branch changed it, When the user checks the plan, Then a warning names the plan and the specification.

Test (deterministic): change a referenced specification after the plan was written and expect the outdated-reference warning.

## R28: Plan branches

By default a plan works in a separate git branch for the plan. Work is committed when each step is done, and a final review before the merge decides whether the plan is completed.

- The plan's branch is created when the plan starts, from the target branch, and the commit it started from is recorded. Where it is checked out is described in `plan-execution R27`.
- Each finished step is committed on the plan branch together with its handoff notes (`§2`). How many commits make up a step is the user's choice, with at least one per finished step.
- The final review checks the plan against its acceptance criteria and shows the user, before deciding:
  - what each step did, and the gaps and assumptions recorded in the plan's gaps and assumptions record (`§2`);
  - steps that never ran;
  - requests that nobody has answered (`requests R52`);
  - the changes to referenced specifications described in `R28.1`.
- The user, or a role with the permission to do so, decides the outcome: the plan is completed, or it goes back in progress with the reasons recorded. A plan is not completed because its steps are done or its branch is merged; completion is a declaration at the final review (`plan-execution R27`).
- When the plan is completed it is archived (`R29.2`) as part of the plan branch's last commit, so the merge brings the completed plan into the target branch.
- Gaps and assumptions an LLM finds while implementing, where the specifications are silent or where it fills a gap from a lower layer, are recorded in the plan's gaps and assumptions record (`§2`), as `specifications R65` requires. They never block a step or the final review; the review lists them.
- A plan can be run without a separate branch if the user chooses, and the other rules here then apply to the branch in use.

Scenario: Given all steps of a plan are done, When the final review is opened, Then it lists open gaps, unanswered requests and changed specifications, and the plan is still not completed until the user decides.

Scenario: Given the final review is declined, When the user gives a reason, Then the plan returns to in progress and the reason is kept in the plan's notes.

### R28.1: Specification changes during a plan

The final review shows every referenced specification that changed on the target branch since the plan started. For each, it shows what changed and whether the specification is still Approved, so the user can tell whether what was implemented still matches what is now specified.

- Specifications changed only on the plan branch itself are shown separately, as changes the plan made.
- Nothing is changed automatically by a difference; the user decides whether to complete the plan, change it or add a step.

Scenario: Given the target branch changed `feature/export` after the plan started, When the final review opens, Then `feature/export` is listed with the change and its current status.

## §2 The plan record

The files named here are the user-facing record and an assumption beyond the page; their exact layout belongs in an architecture specification (`R4`).

A plan folder inside the plans folder (`plans.dir` in configuration) holds the plan's files; the archive directory (`R29.2`) holds the folders of finished plans.

- The plan file holds the metadata and body from `R30` and `R29`, and its steps are listed there.
- One file per step holds the step's goal, acceptance criteria, tasks, the specifications it writes or implements, and the context it needs. Steps are numbered, and run in order.
- A **handoff** file holds one entry for each step that ended, appended in order and never rewritten. It is the memory that lets a new session continue.
- A **gaps and assumptions** file holds the gaps, assumptions and proposed specification edits found while working. It is created when the first one is recorded.
- Shared files in the plans folder, such as conventions or notes several plans use, are referenced by the plans that use them like any other dependency (`R9`).

All of these are markdown the user can read and edit with ordinary tools. Because one plan has its own folder, plans on parallel branches do not conflict.

### §2.1 Handoff entries

Each entry records, for the step it describes: the step and its outcome (done), what changed and why, how the work differed from the step, gaps found (by identifier), open issues or follow-ups, and what the next step must know. Every part is present; one with nothing to report says "None". The entry is self-contained: the next session reads the handoff and the step file, not the diff.

- A step that is run again after being stopped adds a new entry. The latest entry for a step is the authoritative one; earlier entries stay as the record.
- If a step is halted partway, the entry records the partial state and where a re-run must start.
- A step that changes nothing but investigates is valid and records its findings.

### §2.2 Gaps and assumptions record

Each entry has an identifier that counts up within the plan and is never reused, the step that recorded it, its kind, what the specifications do not cover, what was done about it, the specifications it should be added to, and its state.

- **Kind** is `gap` (the higher layer was silent and a lower layer filled in), `assumption` (neither layer covered the case and a default was chosen), or `proposal` (a specification edit the LLM may not make itself).
- **State** is open, applied or rejected. A person, or an LLM whose role allows editing the target specification, changes it once the specification is updated or the entry is declined.
- Open entries never block a step. They are listed in the final review (`R28`).

Scenario: Given an LLM implements a step and `architecture/cli` is silent about an error message that `feature/cli` describes, When it follows the feature spec, Then the plan's record gains a `gap` entry naming both and the step's handoff entry lists its identifier.

## §3 Steps

### §3.1 Step status

A step is either not done or done. There is no skipped status: a step the user no longer wants is removed by editing the plan, which is a plan edit (`plan-execution R31.1`), and the denial of a selection that skips an uncompleted step (`R27`) has no exception. A step is never left in a blocked state for a person to reset: a step that cannot go on because of a missing answer is handled by a request (`requests R52`) or by stopping the plan (`plan-execution R27.1`).

The next step is the lowest-numbered step that is not done.

### §3.2 Step contents

- **Goal**: one paragraph, small enough for one session.
- **Acceptance criteria**: conditions that confirm the step is complete, checked before the step is committed.
- **Tasks**: an ordered list of imperative actions.
- **Context**: the specifications, decisions and files the session must read. A session reads this context, the step, and the handoff entries so far, and avoids unrelated files. If it must read more, it records that in the handoff so later steps can be corrected.
- **Guidance** (optional): pitfalls and conventions the specifications do not cover.

A step's body is not edited once the step has started. If its tasks turn out wrong, the deviation is recorded in the handoff and later steps may be edited.

### §3.3 Step size

Tasks that share context belong in one step; unrelated concerns belong in separate steps. A step that would touch more than about five files or build more than one non-trivial component is probably too large. If two sets of changes need independent review, they are better as two plans, one referencing the other.

How the session is run, including whether it uses subagents or a particular model, is up to the harness and the user (`plan-execution R27`).
