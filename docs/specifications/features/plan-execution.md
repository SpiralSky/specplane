---
id: feature/plan-execution
title: Plan Execution
status: awaiting-review
authors:
  - llm: claude-sonnet-5-5
    contribution: drafted
covers: [R27, R31]
references: [R11, R18, R19.2, R24, R33, plans R28, plans R28.1, plans R29, plans R30, plans R30.1, plans §1, plans §2.1, plans §2.2, plans §3.1, plans §3.2, requests R52, steering R59, roles-and-permissions R57, configuration R25]
---

# Plan Execution

This spec describes how a plan is managed and run through the harness: who may create, edit, start, abandon and complete a plan, how a plan is started in its own worktree and branch, how steps run without asking the user for input, how budgets stop a run, how a stopped plan is resumed, and what happens at the final review. What a plan contains and how its status and progress are stored is described in `plans R29`; the final review's contents are described in `plans R28`.

## §1 Terms

- **Run**: a stretch of work on a plan by one harness session, from a start or resume until the plan completes its steps, stops, or the session ends.
- **Soft stop**: a stop in which the LLM is told to finish cleanly and write a handoff entry (`plans §2.1`). Nothing is lost and a later session continues from the handoff.
- **Hard stop**: a stop in which the harness ends the session by force. The handoff may be missing or incomplete.
- **Plan checkout**: the worktree and branch a plan works in.
- **Target branch**: the branch the plan is meant to be merged into (`plans §1`).

## R31: Plan management

The user can create, edit and manage plans through the harness (`R18`), by asking the LLM or by using the harness's plan commands. Creating and editing a plan produces a plan in the format of `plans R30`, which starts as Awaiting Review (`R11`) and is approved like any specification. The plan's execution status is changed by the commands described below, not by editing the status by hand.

- Managing plans through the harness is an LLM action and follows the LLM's role (`R19.2`). A person using the CLI to change plan metadata is described by `R33`, which is outside this spec.
- A request to manage a plan that the role may not do is denied, or sent to the user when the permission is request user (`requests R52`).

Scenario: Given the user asks the LLM "create a plan for export", When the role may create plans, Then a new plan exists in Awaiting Review with a name made from today's date and a few words, and nothing runs.

### R31.1: Plan management permissions

Plan management has one permission for each of: editing, creating, deleting, starting, abandoning and completing plans. Each has three modes: allow, request user, and deny. The default of each comes from the role presets (`roles-and-permissions R57`).

- Resuming a plan and setting a plan budget have their own permissions (`R27.2.1`, `R27.1.1`).
- Completing a plan means declaring it completed at the final review (`§2`). Deleting an unarchived plan that is in progress needs the deleting permission and also stops its run first (`§3`).
- Starting a plan checks both this permission and the start conditions (`R27.6`); neither replaces the other.

Test (deterministic): with the starting permission set to deny, ask for a plan to start and expect a refusal and no worktree.

### R31.2: Parallelism (later release)

The user can control how much parallelism a plan run uses. A step may contain several tasks that do not depend on each other; with parallelism on, the harness runs them in parallel through subagents.

- The setting is the greatest number of tasks run at once. Its default is one, which means tasks run one after another.
- Whether tasks are independent is stated by the step (`plans §3.2` describes step contents); tasks that depend on each other are never run in parallel.
- A harness without subagents runs the tasks one after another and tells the user that parallelism is not available there.
- Parallelism applies inside a step. Steps themselves still run in order (`R27`).

Scenario: Given parallelism is set to three and a step lists four independent tasks, When the step runs, Then at most three run at once and the step is done only when all four are.

## R27: Plan execution

The user can start a plan run through the harness. The run is a session the user can read and can step into if they choose. The user controls which steps run, or runs all remaining steps. A selection that skips a step that is not yet completed is denied.

- **Selection.** The user can ask for the next step, a number of steps, or all remaining steps. The first step in any selection must be the plan's next step (`plans §3.1`); a selection that would begin later is denied with the name of the step that comes first. A step is never skipped by a selection; a step the user no longer wants is removed by editing the plan (`plans §3.1`).
- **No input needed.** Steps never need the user's input to run. Where the LLM lacks something, it records a gap or assumption and goes on (`plans §2.2`), sends a request (`R27.5`), or stops (`R27.3`). The user may read the session and step in, and doing so does not change what the plan requires.
- **Plan checkout.** A run happens in a separate worktree on a separate branch for the plan (`plans R28`), so the directory the user is working in is never switched or changed. The branch is `plan/<id>`, created when the plan starts from the target branch.
- **Where the worktree lives (assumption: the page says only that plans run in a separate worktree and branch).** The worktree is a directory outside the project's working directory, in a folder for plan worktrees whose location is configurable (`configuration R25`) and whose default is next to the project. Each plan has its own subfolder named after its id, and the project's folder name is part of the path so that sibling projects do not clash.
- **Setup.** If the project defines a setup command (`configuration R25`), it runs once in a new worktree, because the worktree does not share installed dependencies. If it fails, the worktree is removed again and the start fails with the command's error.
- **Files that are not tracked.** Files git does not track, such as local secrets, are not in the worktree. A step must not assume they are there; where one is needed, the run stops or sends a request.
- **Target branch.** The target branch is the one named when the plan starts, and otherwise the branch the user is on. It is recorded with the commit the plan started from, and later steps and the final review use that record even if the branches move. A plan whose target branch no longer exists stops until the user chooses a new one.
- **Steps and sessions.** A session works through steps in order, one at a time. Each finished step ends with a handoff entry (`plans §2.1`) and at least one commit (`R27.4`). A session that continues for several steps and a fresh session on a later step behave the same, because the plan record and handoff carry everything needed.
- **Status.** While a run is working the plan is in progress. A run that ends without finishing, without a stop having been recorded, for example because the machine lost power, leaves the plan stopped with the reason "session ended unexpectedly" the next time its status is read (`plans R29`).
- **Steps that implement an unapproved specification** do not run until it is Approved (`plans R30.1`). Where later steps do not depend on it, the run continues with them and stops at the end of what it can do, naming what it waits for.
- **A plan outdated by specification changes.** If a referenced specification changed since the plan was written, the run warns (`R24`) and the LLM is told to check what changed before continuing (`steering R59`).
- **Cleanup.** After the plan's branch is merged, or the plan is abandoned, its worktree is removed. Removal is refused while the worktree has uncommitted changes unless the user says to force it, so no work is lost silently. The plan's branch is kept when the plan is abandoned, since it may hold useful work, and removed after a merge.
- **Unrelated plans can run at the same time**, each in its own checkout. Two runs never share a plan checkout.

Scenario: Given a plan with steps 1 to 4 and step 1 done, When the user asks to run step 3, Then the harness denies it and says step 2 comes first.

Scenario: Given the user is working on `main` in the project directory, When the user starts a plan, Then the project directory stays on `main` and the plan works in a new worktree on `plan/<id>`.

Test (deterministic): start a plan and check that the project directory's branch and files are unchanged and that a worktree exists on the plan's branch.

Test (deterministic): ask to run a step after an incomplete step and expect a denial.

### R27.1: Plan budgeting

A plan run can have a budget. The budget is measured in tokens or, depending on the provider and subscription, in usage limits. Every kind of usage limit the provider has is supported; for example a five-hour limit and a weekly limit are separate and each can have its own budget.

- Each budget has a soft stop and a hard stop. The soft stop is reached first and is a share of the resource; the hard stop is reached after it.
- At the soft stop the LLM is told to finish cleanly: it brings the current work to a safe point, commits what is done, and writes a handoff entry (`plans §2.1`) that records the partial state and where a re-run must start. Then it ends the session. The plan is stopped, and the reason names the budget.
- If the resource runs out after the soft stop, because the LLM did not finish in time, the harness ends the session by force. The plan is stopped and the reason says it was a hard stop.
- Both stops, and which kind of stop ended the run, are kept with the plan's status and progress (`plans R29`).
- A harness that cannot measure a budget says so when the budget is set and does not pretend to enforce it. Budgets apply to one plan; a budget over several projects is not handled by Specplane.
- No budget is set by default; running a plan without one is allowed.

Scenario: Given a weekly usage budget with a soft stop at 80% and a hard stop at 95%, When the run reaches 80%, Then the LLM writes a handoff and the plan becomes stopped with the reason "soft stop at 80% of the weekly limit".

Scenario: Given the same plan, When the run reaches 95% before the LLM has finished, Then the session is ended by force and the plan is stopped with the reason "hard stop".

Test (deterministic): with a fake usage reading above the soft stop, expect the LLM to be told to write a handoff and the plan to be stopped with the budget as reason.

#### R27.1.1: Plan budget permissions

Setting or changing a plan's budget has a permission with three modes: allow, request user, and deny.

- A run that has no permission to set a budget runs with the budget the plan already has, or none.
- Lowering the budget of a stopped plan before resuming it needs the same permission.

### R27.2: Resuming plans

A stopped plan can be resumed through a harness command. The command starts a new run in the plan's existing checkout, at the step recorded in its progress (`plans R29`).

- **After a soft stop** the new session reads the handoff and the step, and nothing else about the earlier session.
- **After a hard stop**, or after a session that ended unexpectedly, the new session reads the handoff and also skims the earlier session's log to find what the handoff misses. The partial state in the log is not trusted over what the files and the last commit show.
- Resuming clears the stop reason and sets the plan to in progress. The earlier stop reason stays in the handoff, so the record of what happened is kept.
- A resume does not check the start conditions again (`R27.6`), because the plan's own changes to specifications must not keep it from continuing. It does check that the plan's checkout still exists; if it was removed, resuming recreates it from the plan's branch.
- A resume does not skip steps. It continues at the first step that is not done.
- A plan that is completed or abandoned cannot be resumed (`plans R29`).
- Anything the user changed in the environment since the stop, such as a fixed permission or a restored file, is what resuming is meant to pick up.

Scenario: Given a plan stopped by a soft stop at step 3 with a handoff entry, When the user resumes it, Then the new session reads the handoff and continues at step 3.

Scenario: Given a plan hard stopped in the middle of step 3 and no handoff entry for step 3, When the user resumes it, Then the new session reads the earlier steps' handoff and skims the stopped session's log before it re-runs step 3.

Test (deterministic): resume a plan stopped by a soft stop and expect the new session's context to hold the handoff and not the earlier session log; for a hard stop expect both.

#### R27.2.1: Plan resuming permissions

Resuming a plan has a permission with three modes: allow, request user, and deny.

### R27.3: Blocking in case of failure

When a run hits something that blocks it, such as a restriction in its environment, the LLM decides whether to go on with work that is not blocked or to stop the plan. Steering guides the decision (`steering R59`).

- The LLM can stop the plan itself with a soft stop (`R27.1`). Every default role preset allows this (`roles-and-permissions R57`).
- Stopping records why, and what a person or a later session must change before the plan continues (`plans R29`). The plan can then be resumed once the environment is changed (`R27.2`).
- A block is never turned into a skipped step. The step stays as it is until it is done or the user edits it out of the plan.
- A plan can also be stopped by the user at any time. This is the same soft stop, and also covers the user pausing a plan on purpose; there is no separate paused status.

Scenario: Given a step needs a tool the environment forbids, When the LLM cannot do the step any other way, Then it stops the plan, the handoff says which tool is needed, and the plan is stopped with that reason.

### R27.4: Plan sub-commits

How changes are committed while a step is implemented is the user's choice. At least one commit is made for each step, and it includes the step's handoff entry.

- A step with no change to the project still ends with a commit of its handoff entry.
- A step that is stopped partway commits its partial work and the partial handoff entry, so a resume starts from committed state.

### R27.5: Requests during execution

A request sent during a run is added to the requests list (`requests R52`) and is either blocking or non-blocking. The LLM decides which, guided by steering (`steering R59`).

- A request that cannot be answered by the user quickly never holds the run open; a run waiting for an answer is a stopped plan.

#### R27.5.1: Blocking requests

A blocking request soft stops the plan (`R27.1`). It is shown with the stop reason. When the request is answered, the plan is resumed and the answer is part of what the new session reads (`R27.2`).

#### R27.5.2: Non-blocking requests

The run continues with work that does not depend on the answer, and does not do what was requested. Requests still unanswered when the steps are finished are listed at the final review (`plans R28`).

Scenario: Given a step asks to change an approved specification, When the LLM marks the request blocking, Then the plan stops with that request as the reason and resumes later with the answer.

### R27.6: Plan start conditions

A plan starts only when the plan itself and every specification it already references are Approved (`R11`). Specifications the plan will write do not count, because they do not exist as Approved before the plan runs. This check is configurable as on or off and is on by default (`configuration R25`).

- The check happens when the plan starts for the first time. A refusal names each plan or specification that is not Approved.
- A plan that references another plan does not start before that plan is completed (`plans R30`). Abandoned or unfinished plans do not satisfy it. If the user says to start anyway, naming the plans, the plan starts, and the handoff records which plans were not completed.
- A plan that has a reference cycle does not start (`plans R30`).
- With the check off, the plan starts without the approval conditions, but plan dependencies and cycles are still checked.
- Starting also needs the permission to start plans (`R31.1`).
- A plan that is stopped does not recheck this; resuming is described in `R27.2`.

Scenario: Given a plan in Awaiting Review, When the user starts it, Then the start is refused and says the plan itself must be Approved first.

Scenario: Given the plan references `feature/export`, which is Awaiting Review, and will write `feature/import`, When the user starts it, Then it is refused naming `feature/export` only.

Test (deterministic): start a plan that references an Awaiting Review specification with the check on and expect a refusal naming it; with the check off expect the start.

## §2 The final review and finishing

This section describes how the final review of `plans R28` runs. It adds no behaviour to the plan's contents; those are in `plans R28` and `plans R28.1`.

- **When it opens.** When every step is done, the run ends by opening the final review instead of completing the plan. The plan stays in progress until the review decides. A user can also ask for the review earlier, and it then lists the steps that have not run.
- **Who prepares it.** The LLM gathers the review: for each step what it did, the open entries of the gaps and assumptions record (`plans §2.2`), unrun steps, unanswered requests (`requests R52`), and referenced specifications that changed on the target branch or on the plan branch (`plans R28.1`). It checks the plan's acceptance criteria and says which are met and on what evidence, but it does not decide.
- **Who decides.** The user, or a role with the completing permission (`R31.1`), completes the plan or sends it back. With the permission set to request user, the decision goes to the user as a request (`requests R52`). An LLM never completes a plan without that permission.
- **Sent back.** The plan returns to in progress with the reasons recorded in its notes. The reasons can add steps or change later steps, and the run continues from the first step that is not done.
- **Completed.** The plan is completed and archived in the plan branch's last commit (`plans R28`). The plan's worktree stays until the branch is merged.
- **Merging (assumption: the page says only that a final review decides completion).** Specplane does not merge on its own authority. After completion the plan's branch is ready for merging into the target branch, either by opening a pull request or by a local merge, as the user chooses. A local merge always creates a merge commit so the plan's commits stay together, and only runs in a checkout of the target branch without uncommitted changes. If the target branch moved after the final review began, the review is shown again before a merge, because the changes to specifications may have changed. Conflicts are shown to the user and are never resolved automatically.
- **After the merge** the worktree and the plan's branch are removed (`R27`).

Scenario: Given every step is done and one request is unanswered, When the run ends, Then the final review lists the request, and the plan is still in progress.

Scenario: Given a plan was completed and its branch merged, When the user lists plans, Then it appears in the archive as completed and its worktree is gone.

Test (deterministic): finish all steps of a plan and expect the plan to be in progress with a final review waiting, not completed.

## §3 Abandoning and deleting

- **Abandoning.** A plan that will not be done is abandoned with the abandoning permission (`R31.1`). Its run is stopped first, the plan is archived with the status abandoned (`plans R29`), and its worktree is removed unless that would lose uncommitted work. The plan's branch is kept.
- **Deleting.** A plan is deleted with the deleting permission. The plan's run is stopped first and its worktree is removed under the same rule. Plans that referenced it get a reported missing reference (`plans R29`).
- Abandoning or deleting a plan that other plans reference leaves those plans unable to start until their references are updated, because `R27.6` needs the referenced plan to be completed.
