---
title: Verification, warnings, audit and logs
summary: Declaring and running tests, implementation records, coverage, warnings, the audit log and test logs.
related: [specification-format, configuration, commands, permissions]
---

# Verification, warnings, audit and logs

## Tests and implementation

Tests are declared in specs (see `specification-format`). `test run <spec>[#<section>]` or `test run --all` runs the deterministic tests on the content committed at `HEAD`, in a temporary checkout, so uncommitted edits are not tested. Results are recorded as `test-result` records bound to the spec's fingerprint; a result for changed content is shown as outdated and counts for nothing. Recording needs `test.record`. A person can set or clear a result by hand with `spec override test`, which needs the protected `override.test` permission.

To block commits that break tests, turn on `pre_commit.tests` (off by default). The pre-commit hook then runs the deterministic tests of every architecture spec that declares them, on the staged content, whenever anything is staged, and refuses the commit on a failure; this includes commits that change only code. Intelligent tests are never run by the hook.

`spec implement <id>` verifies an architecture spec: every declared check must pass on the committed content, intelligent judgements must carry a recorded verdict, and `HEAD` must not move meanwhile. Only then is an implementation record written. An LLM may do this only when `architecture.llm_may_mark_implemented` is on and the permissions allow it. A failed current result blocks both approval and mark-implemented.

`coverage` shows which specs cover each requirement and feature section; `--uncovered` lists what nothing covers. `coverage.requirement_only` marks requirements that need no spec; they are still reported as uncovered warnings.

## Warnings

`warnings [id]` lists the current warnings, or those of one spec or plan; `validate` reports the same findings together with errors. With `auto_warn` on, each command ends with the count of warnings. An LLM reads the same list through a harness action.

## Audit log

Every command and action is appended to the local audit log with the actor, role, command, permission, outcome (`done`, `refused`, `request-sent`, `cancelled`, `failed`) and old and new values of changes. File contents and test output are never stored. `audit` reads it; an LLM can read it only with `info.retrieve`. The log is not committed and is shared by the worktrees of one repository.

<!-- note: audit-retention -->
**Audit retention.** Entries older than `audit.retention` days (default 30) are removed the next time a command runs, and the removal is itself recorded. Set `forever` to keep everything.

## Test logs

`tests.logs` chooses where full test output goes: `local` (the default, under the local store), `git` (committed under `paths.test_logs`) or `off`. Local logs older than `tests.logs_retention` days (default 30) are deleted at the next command.

<!-- note: private-logs -->
**Logs in git may expose private information.** Test output and LLM session text can contain private data. Logs kept in git are not removed by retention, and anyone with the repository can read them. Choose `tests.logs: git` only when that is acceptable; Specplane prints this warning when you choose it and when a log is written.

A recorded result keeps only a short summary, and Specplane warns when a summary looks like a credential.

## Continuous integration

For contributors to Specplane itself, `npm test` in `packages/cli` builds and runs the repository suite. Its wrapper clears inherited LLM identity and session markers for both runners, so it also works from a harness shell. Tests that exercise an LLM identity supply their own markers. Set `SPECPLANE_TEST_RUNNER=bun` to require Bun without Node fallback.

Run `specplane validate --json` on the checked-out commit; a non-zero exit fails the job. It reads committed content only, needs no permission, local store or harness, and writes nothing. A project may also run `specplane test run --all`, which executes the deterministic tests in a temporary checkout and fails on any failure. Neither command records results in CI.
