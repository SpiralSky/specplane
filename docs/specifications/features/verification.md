---
id: feature/verification
title: Verification
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
covers: [R12, R13, R13.1, R24, R24.1, R32, R36, R36.1, R36.2, R36.3, R61, R61.1, R61.2, R61.3, R61.4, R64]
references: [R4, R7, R9, R11.2, R16, R17.2, R22, R40, R50, R59, R62, R63, specifications R5, specifications R7, specifications R9, specifications R10, specifications R11, requests R52, plans R28, plans R30, roles-and-permissions R50, roles-and-permissions R57, cli R17, steering R59, harness R14, configuration R25, plans R29.3, specifications R1, specifications R68, plans]
---

# Verification

Specplane tracks intended behaviour, review, implementation and evidence separately. This spec describes the checks that give people evidence about their specifications: validating that specifications follow the rules, showing what covers what, keeping a list of warnings, an internal log of everything Specplane did, and tests that show a specification layer is satisfied by the layer below it. It also describes how an architecture specification becomes implemented. None of this proves the code is correct: a passing test is evidence, not a guarantee, and a recorded result never changes what a person approved.

## §1 Terms

- **Validation:** checking that specifications, plans and configuration follow the rules in this product's requirements and specs. It changes nothing; its status and outdated checks use committed state (`R40`).
- **Error and warning:** an error is a broken rule that Specplane cannot work around, for example metadata that cannot be read. A warning is something worth a person's attention that does not stop work, for example a requirement that nothing covers.
- **Test:** a check a specification declares to show that the layer below it complies with it. It is deterministic or checked with intelligence (`§2.1`).
- **Result:** the recorded outcome of a test (passed or failed), with who ran it, a short summary and the commit it ran on.
- **Implemented:** a status only architecture specifications have (`R36`).
- **Audit log:** Specplane's internal log of the actions it took in one repository (`R13`).

## R12: Validation

There is a command to validate the project (`specplane validate`), and the same check is available to an LLM through the harness (`harness R14`). Validation covers every rule that specifications must follow, wherever the rule is described.

- **What is checked.** At least:
  - the format of each specification: metadata present and readable, status one of Awaiting Review or Approved, the identifier matching the file's name, the authors, the references and the covered requirements well formed (`specifications R5`, `specifications R7`, `specifications R10`, `specifications R11`);
  - every citation in a body resolves to something that exists, and every citation appears in the references (`specifications R9`);
  - requirement identifiers are unique and not reused; a retired or already used number cannot be added (`specifications R1`);
  - a file called `INFO.md` has no specification metadata, and a file with invalid metadata is reported rather than ignored;
  - plans: identifier matches folder, referenced specifications and plans exist, no reference cycle, steps are readable (`plans R28`, `plans R30`);
  - approval and test state: a specification outdated by a change of what it cites, or an outdated test result, is reported as such, not as an error (`R11.2`, `R61.1`);
  - configuration: unknown or malformed keys and values (`configuration R25`).
- **Errors, warnings and notes.** Each finding says what is wrong, where (file, section and line where known), and which rule it breaks. Findings that depend only on the project's state, such as an uncovered requirement or a spec that has been outdated by a change, are warnings and join the warnings list (`R24`). Findings that mean a file cannot be trusted or used are errors.
- **Scope.** The command checks the whole project by default. It can be limited to named specifications or plans. Status, outdated and test-state checks use committed content only (`R40`). Format checks can also read the working tree, and a finding says which one it came from when they differ.
- **Result for scripts.** The command ends with a failure status when there are errors and a success status when there are none, so it can be used in automation. Warnings alone do not make it fail. The output can be read by people and by programs.
- **Read-only.** Validation never edits a file, approves anything or changes a status.
- **Missing layers.** A project without requirements, plans or decision records validates without complaints about their absence (`specifications R68`).
- **Intelligent checks.** Rules that need judgement, for example that a feature spec keeps architecture out (`R4`), are not decided by the command. Where the harness can run them, they are instructions to the LLM and their results are reported as warnings, never as errors.

Scenario: Given a feature spec that cites a section of `plans` that does not exist, When the user runs `specplane validate`, Then the unresolved citation is reported as an error naming the spec and the citation, and the command ends with a failure status.

Scenario: Given two requirements that both use `R7`, When the project is validated, Then the clash is reported naming both places.

Scenario: Given a project where the only problem is a feature spec nothing implements, When the project is validated, Then it reports a warning and ends with a success status.

Test (deterministic): validate a project with an unresolved citation, a mismatched identifier and an uncovered requirement; expect two errors, one warning and a failure status, then fix the two errors and expect a success status with the warning left.

Test (deterministic): record the working tree before and after a validation run on a project with errors and expect no file to have changed.

## R13: Auditing

Specplane keeps an internal log of every action it takes in a repository: commands run by people, commands and requests made by LLMs, approvals, overrides, permission decisions, test runs and configuration changes.

- **Who and what.** Each entry records when it happened, who did it (the person or the LLM role and, where the harness reports it, the model), what was asked, what the outcome was (done, refused, request sent) and the old and new value for changes.
- **Branch.** Each entry names the branch the action was run on.
- **Not in git.** The log is local to the machine and repository and is not committed. A person can read it through a command, and an LLM can read it only if its role may retrieve project information (`R50`).
- **Refusals count.** A refused action, such as one blocked by a permission or by a failed test, is logged with the reason, because what was tried matters as much as what happened.
- **Never blocks work.** If the log cannot be written, the action still runs and Specplane warns once per command (`R24`); it does not hide the failure.
- **Private information.** The log holds what was done, not file contents or test output; test output has its own storage (`R61.4`).

Scenario: Given an LLM asks to approve a specification and its role has deny for approval, When the request is refused, Then the audit log records the attempt, the refusal and the branch.

Scenario: Given a person overrides a recorded test result through the command line, When the override is made, Then the log records who did it, the old result and the new one (`R17.2`).

Test (deterministic): run an approval and a refused action on two branches and expect both entries, each with the right branch, and no file of the log to show up in the repository's tracked or untracked files.

### R13.1: Audit Retention

How long audit entries are kept is configurable (`configuration R25`). Entries older than the retention are removed. The default is stated in the user documentation (`R22`).

- A retention of "forever" is allowed. Removing old entries is itself logged as one entry saying how many were removed and the oldest date kept.
- Changing the retention is a configuration change and follows its permission (`roles-and-permissions R50`).

Scenario: Given the retention is 30 days, When Specplane runs a command and an entry is 31 days old, Then that entry is removed and a single entry records the removal.

Test (deterministic): set the retention to one day, add an entry dated two days ago and run any command; expect the old entry gone and a removal entry present.

## R24: Warnings List

Specplane keeps one list of warnings about the project. It is available through a command (`specplane warnings`) and, in a harness, to the LLM (`harness R14`).

- **Sources.** Anything in the product's behaviour that says "reported as a warning" feeds this list: for example uncovered requirements and feature specs (`R64`), plans that reference an older version of a specification (`plans R29.3`), specifications outdated by a change of what they cite (`R11.2`), outdated test results (`R61.1`), steering that is missing or older than what is active (`steering R59`), permissions without instructions, a missing or stale harness installation, and an audit log that cannot be written (`R13`).
- **Each warning** has a short text, the thing it is about (specification, plan, permission, installation), and why it matters. Listing never edits anything. The list can be narrowed to one specification or plan.
- **Current, not stored.** The list is worked out from the project's present state each time, so a warning disappears when its cause does. Nothing is remembered as dismissed; if a person wants a warning not to appear they fix its cause or change the configuration that produces it.
- **Warnings never block.** They inform. Something that must block is an error (`R12`) or a permission, not a warning.

Scenario: Given a feature spec nothing covers and a plan referencing an old commit of a specification, When the user asks for the warnings, Then both are listed with what they are about.

Test (deterministic): create the two situations above, list the warnings and expect two entries; fix one and expect one.

### R24.1: Auto Warn

Each Specplane command ends by reporting how many warnings exist, for example "3 warnings; run `specplane warnings`". This can be switched on or off (`configuration R25`) and is on by default.

- The line is shown at the bottom of the output and does not change the command's own result or status. When the setting is on and there are no warnings, it says so briefly (for example "0 warnings").
- In a harness, the same count is included where the command's output is given to the LLM.
- Commands whose output is meant for programs keep the line out of the data and report the count as a separate field.

Scenario: Given the setting is on and two warnings exist, When the user runs `specplane validate`, Then the output ends with the count of warnings.

Scenario: Given the setting is off, When the user runs any command, Then no count is shown.

Test (deterministic): run a command with the setting on and off against a project with one warning and compare the last line of the output.

## R32: Requirements Testing (later release)

Requirements can be checked for duplicate identifiers before they are committed, not only when validating (`R12`).

- An option in the configuration (`configuration R25`) installs a pre-commit check that refuses a commit in which two requirements share an identifier. It is off by default.
- The check only concerns identifiers; it does not run the rest of validation.
- Turning the option on adds the check to the repository's pre-commit steps without changing anything else there, and turning it off removes it again by itself, leaving the other steps as they were. A person can also remove it by hand without affecting the others.
- When the check refuses a commit it says which identifier clashes and where.

Scenario: Given the option is on and a commit adds a second R14, When the user commits, Then the commit is refused and both places are named.

Scenario: Given the repository already has another pre-commit step, When the option is turned off, Then only Specplane's check is removed and the other step still runs.

Test (deterministic): enable the option, try a commit with a duplicate requirement id and expect refusal; disable it and expect the other pre-commit step unchanged and the commit to succeed.

## R36: Architecture Spec Status

Architecture specifications record whether they are implemented or unimplemented. No other layer has this status: requirements and feature specifications are complete when approved, and they are compared with the layer below through tests (`R61`).

- A new architecture specification is unimplemented. Approval (`specifications R11`) and implementation are separate: a specification can be implemented without having been approved, though the usual order is to approve first.
- The status is shown wherever the specification is shown, together with the commit it was last verified on.
- A specification that has a failed test (`R61.1`) cannot be marked implemented. The command refuses and says which test failed.
- Marking a specification implemented is an act of verification, not a declaration: it only succeeds when everything the specification declares passes (`R36.1`) on the commit (`R36.2`).

Scenario: Given an architecture specification with a failed deterministic test, When the user asks to mark it implemented, Then it is refused naming the failed test and the specification stays unimplemented.

Test (deterministic): record a failed result for an architecture spec and run the mark-implemented command; expect refusal and an unchanged status. Record a pass and expect the status to change.

### R36.1: Implementation Tracking

A specification, or a section of it, declares how its implementation is checked: with tests, with intelligent judgement, or with both. Everything it declares has to pass. One that declares neither is judged with intelligence.

- **Tests.** Declared in the specification with what and how to test (`R61`).
- **Intelligent judgement.** An LLM in a harness reads the specification and the implementation and decides whether the specification is met, giving its reasons. It is only available in a harness; the command line cannot do it and says so rather than substitute a deterministic guess.
- **Who confirms.** Marking implemented after the checks pass is done by a person or an LLM. An LLM may do it by default; this is configurable (`configuration R25`), and when it is off only a person can. In every case the person or LLM needs the permission to record a test result (`R61.2`).
- **Sections.** Where only some sections declare tests, the others are judged by intelligence, and all of them must pass for the specification as a whole.
- **Evidence.** The reasons and summaries are recorded as the result (`R61.3`) so a person reading the specification can see why it is, or is not, implemented.

Scenario: Given an architecture specification with one section declaring a deterministic test and another declaring nothing, When it is verified, Then the test is run, an LLM in a harness judges the other section, and the specification is implemented only if both pass.

Scenario: Given the same specification and only the command line, When the user asks to verify, Then the test runs, the other section is reported as needing a harness, and the status stays unimplemented.

Test (deterministic): verify a specification with a deterministic test and a section declaring nothing without a harness; expect the test result recorded and the status unimplemented, with the second section reported as needing intelligent judgement.

### R36.2: Implementation Status Commit

Implemented is tied to one commit. It is set only when everything the specification declares passes on that commit, and checks run against committed state, ignoring uncommitted changes (`R40`).

- A commit that changes the content of the specification returns it to unimplemented. Commits that do not change its content leave the status as it is; the status shows the commit it was last verified on.
- If the working tree has uncommitted changes, the run says the check used the commit and not those changes.
- If the specification is changed and then changed back, it is still unimplemented until verified again; matching an earlier content does not restore earlier evidence.
- The status survives rebase and merge as long as the content and the verified commit are still part of the history; if the verified commit is no longer part of the history, the status shows unimplemented.

Scenario: Given an architecture specification verified as implemented on commit A, When commit B changes only code, Then the status still shows implemented, verified on A.

Scenario: Given the same specification, When commit C edits its text, Then it shows unimplemented.

Test (deterministic): mark a specification implemented on a commit, make a commit that edits another file and expect it still implemented, then edit the specification and expect unimplemented.

### R36.3: Test Commit Gate (later release)

An option in the configuration (`configuration R25`) blocks a commit when the deterministic tests of an architecture specification fail. It is off by default and is a pre-commit step installed and removed the same way as in `R32`.

- Only deterministic tests run in the gate. Tests that need intelligence never run in a commit.
- The refusal names the specification and the failing test.
- The gate checks the changes being committed, not unrelated working-tree files.
- The gate does not set implemented status or record results itself; it only decides whether the commit goes ahead.

Scenario: Given the option is on and a change breaks a declared test, When the user commits, Then the commit is refused with the failing test named.

Test (deterministic): enable the gate, make a change that fails a declared test and expect the commit to be refused; disable the gate and expect the commit to go through.

## R61: Spec Compliance Verification

Each layer can declare tests that show the layer below it complies with it: requirements are checked against feature specifications, feature specifications against architecture specifications, and architecture specifications against the implementation (`R36.1`). The tests are written in the specification, with what to test and how.

### R61.1: Test Pass State

The result of a test, including who ran it, is recorded in the metadata of the specification being tested (`R17.2`).

- **Whose metadata.** The result belongs to the specification that was checked: the feature specification when it is verified against requirements, the architecture specification when it is verified against feature specifications or its implementation.
- **Content.** Passed or failed, who ran it (a person or an LLM role and model), when, the commit it ran on, and the summary (`R61.3`).
- **Outdated.** A recorded result becomes outdated when either specification changes, that is the one tested or the one it was tested against (`R11.2`). An outdated result is shown as outdated and counts as no result for approval and implementation. It is not deleted.
- **A failed test does not change status.** A failed test leaves the specification Awaiting Review or Approved as it was. What it does is block: a specification with a failed test cannot be approved (`R16`), and an architecture specification with a failed test cannot be marked implemented (`R36`). A later pass, or an outdated failure, lifts the block.
- **Override.** A person who holds the protected permission can set or clear a recorded result by hand (`R17.2`, `cli R17`). An overridden result is marked as an override wherever it is shown, with who set it.

Scenario: Given an approved feature specification with a recorded pass, When someone edits the specification's text, Then the pass is shown as outdated and the status follows the rules for edited content (`specifications R11`).

Scenario: Given a feature specification with a failed test, When someone tries to approve it, Then approval is refused and names the failed test.

Scenario: Given a failed result that has been overridden to passed by a person, When the specification is shown, Then the pass is marked as an override with who set it, and approval is possible.

Test (deterministic): record a failure, attempt approval and expect refusal; edit the specification and expect the failure to be shown as outdated and approval to be possible.

### R61.2: Test Result Permissions

Recording a test result has its own permission with the modes allow, request user and deny (`roles-and-permissions R50`). LLM roles are allowed in every default preset (`roles-and-permissions R57`).

- **Allow.** The result is recorded.
- **Request user.** The test runs and its outcome is shown, a request is sent to record the result, and the result is recorded when the user accepts (`requests R52`). It is recorded for the commit and content the test ran on; if either changed, the accepted request records nothing and says why.
- **Deny.** The result is not recorded. The test may still run and its outcome is shown, with a note that it was not recorded.
- This permission is separate from overriding results, which is a protected permission (`R17.2`), and from running tests, which needs none.
- A person using the command line is a role like any other and is checked in the same way.

Scenario: Given an LLM role with deny for recording test results, When it runs a specification's tests, Then the results are shown to it, nothing is recorded and it is told that recording was denied.

Scenario: Given a role with request user, When it runs a test, Then a request to record the result is sent and the result is recorded only after the user accepts.

Test (deterministic): run a test under each of the three modes and expect a recorded result, a pending request, and no recorded result.

### R61.3: Test Records

Each recorded result has a short summary: for deterministic tests what failed, and for tests checked with intelligence the reasoning behind the result.

- Steering tells the LLM to keep private information, such as credentials, out of the summary (`R59`, `steering R59`). The summary is short; the full output goes to the logs (`R61.4`).
- A pass records a one-line summary stating what was checked.
- Where Specplane itself can tell that the summary looks like it holds a credential, it warns (`R24`) and does not stop the recording.

Scenario: Given a deterministic test fails with an error message, When the result is recorded, Then the summary names the failed step and the reason, not the whole output.

Test (intelligent): read the records of failed tests and check that each says what failed and why in a few lines, and that none includes private information.

### R61.4: Test Logs

Full test output and the LLM's session logs for tests checked with intelligence are stored on the machine that ran them.

- **Default.** Local per machine and not committed, with retention configurable in the same way as the audit log (`R13.1`).
- **Configurable.** Storing logs can be switched on or off, and can be set to store them in git instead of locally (`configuration R25`).
- **Logs in git.** The documentation warns that logs in git can expose private information and are not removed by retention (`R22`). Switching to git is a conscious choice, and Specplane tells the user what that does when it is selected.
- When logs are off, only the summary in the record remains.
- A result's record points to its log when one exists on this machine; on another machine it shows that the log is not available.

Scenario: Given log storage is on and local, When a test is run, Then the full output is stored on this machine, no file in the repository changes, and the result's record refers to it.

Scenario: Given logs are set to git, When a test is run, Then the log is written into the repository and retention does not remove it.

Test (deterministic): run a test with logs set to local, git and off, and expect a local file, a file in the repository and no file respectively.

## R64: Specification Coverage

Specplane shows which specifications cover each requirement and feature specification, using their references (`R9`).

- **Direction.** For a requirement: the feature specifications that cover it. For a feature specification: the architecture specifications that cover it. For a specification of any layer, the things above it that it covers. Coverage also appears in `covers` and in what a specification cites.
- **Warnings.** Requirements and feature specifications that nothing covers are warnings (`R24`), not errors. A requirement that is requirement-only (below) is exempt.
- **Any layers.** It works with whatever layers exist. A project with feature and architecture specifications and no requirements shows coverage for those two and no complaint about the missing layer.
- **Two views.** One lists each item with what covers it; the other lists the uncovered items only. Both are available to people and LLMs.
- **Several covers.** A requirement covered by more than one specification is shown with all of them. This is not a warning.
- **How coverage is read.** A specification covers an item when the item is in its `covers` list or the specification cites it (`specifications R9`), which is how the page words it ("using their references").
- **Requirement-only.** Non-goals and unwanted outcomes (`R62`, `R63` and their sub-requirements) describe no behaviour to cover and are never reported. Any other requirement the owner keeps requirement-only is listed in the setting `coverage.requirement_only` (`configuration R25`; assumption, the page has no way to mark it).

Scenario: Given a requirement that no feature specification references, When the user asks for coverage, Then the requirement shows as uncovered and the warnings list includes it.

Scenario: Given a project with feature and architecture specifications only, When coverage is shown, Then feature specifications show which architecture specifications cover them, and nothing is reported about requirements.

Test (deterministic): create a requirement, a covering feature specification and an uncovered feature specification; expect the coverage view to list the covered pair and one warning for the uncovered specification.

## §2 How tests are declared and run

### §2.1 Kinds of test

- **Deterministic tests** are steps whose result does not depend on judgement, for example a command to run and the output or status it must give. They run through the command line and the harness.
- **Tests checked with intelligence** are checks an LLM carries out by reading and exercising what is described, and reporting what it found. They run only in a harness.
- In a specification, a section declares a test as `Test (deterministic): <what and how>` or `Test (intelligent): <what and how>` (`specifications R5`). A section that declares none is checked by intelligent judgement, by an LLM in a harness.

### §2.2 Running

- A test is run for one specification, for a section, or for all specifications with tests. The command shows each test's name, kind and result, and the summary for failures.
- Running a test needs only the information retrieval permission (`roles-and-permissions R50`); recording the result does (`R61.2`). Without the permission to record, the test still runs and its outcome is shown, with a note that it was not recorded.
- Deterministic tests run against committed state like everything else (`R40`), and say so when the working tree differs.
- A test that cannot run, for example because the harness is missing, is reported as not run. It is neither a pass nor a fail.

Scenario: Given a feature specification with one deterministic and one intelligent test, When it is run from the command line, Then the deterministic test runs and is recorded, and the intelligent one is reported as not run because it needs a harness.

Test (deterministic): run a specification's tests from the command line with both kinds declared and expect one recorded result and one not-run entry.

## §3 Edge cases

- **Result for an unapproved specification.** A test can be run and recorded for an Awaiting Review specification. Approval then happens as usual (`R16`) and the result carries over unless the content changed since.
- **Reopened or edited specification.** An edit makes recorded results outdated and an implemented architecture specification unimplemented. Neither takes effect on its own for a person who has not seen the edit; the status and the warning say why.
- **Removed test.** If a section no longer declares a test, its old result is shown as outdated like any other change to the specification.
- **Override and re-run.** If a result was overridden and the test is run again, the new result replaces the override and the audit log keeps both (`R13`).
- **Two people run the same test.** Each result keeps who ran it; the latest result for the current content is the one in effect, and earlier results stay in the history.
- **No tests anywhere.** A specification that declares nothing is judged with intelligence (`R36.1`, `R61`); a project with no harness can still validate and show coverage, and any intelligent judgement is reported as needing a harness.
- **Cancelled run.** A test run that is interrupted records nothing and is logged as cancelled (`R13`).
- **Unwanted outcomes.** A passing result is never presented as proof that code is correct or that the specification is right (`R63`).
