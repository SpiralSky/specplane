---
id: feature/spec-precedence
title: Implementation precedence and gap/contradiction handling
status: review
author: mixed
---

# Implementation precedence and gap/contradiction handling

This spec defines the rules an implementer (human or agent) follows when generating an implementation from Specplane specs.

---

## Precedence model

Implementations are generated from specs in a defined priority order. The goal is to ensure that architecture specs drive implementation detail (they exist for that purpose) while feature specs remain authoritative for user-visible behaviour.

### Rule 1: Architecture spec is the primary implementation authority

When generating or modifying an implementation, the implementer reads the architecture spec first and follows it for all structure and detail it covers: component names and responsibilities, data models, interfaces, error handling, algorithms, and module organisation.

The implementer does not need to consult the feature spec for anything the architecture spec already specifies.

### Rule 2: Feature spec fills behavioural gaps

When the architecture spec does not specify a behaviour — for example, the exact message returned on a validation failure, a rule for how edge cases are handled, or what the user sees in a given condition — the implementer consults the corresponding feature spec.

Feature specs are authoritative for:
- The intended user-visible outcome of an operation.
- Acceptance criteria and scenarios.
- Rules and invariants stated from the user's perspective.

### Rule 3: Gaps must be recorded

When the implementer uses the feature spec to fill a gap in the architecture spec, the gap must be recorded. The gap record goes into the step's `HANDOFF.md` (see `feature/plan-steps`), specifically in the "gaps found in specs" section.

Recording a gap allows the architecture spec to be updated to include the detail, so future implementers do not need to re-derive it from the feature spec.

Gaps are informational, not blocking. The implementer proceeds with the feature spec's guidance.

### Rule 4: Contradictions are blocking

If the architecture spec and the feature spec make contradictory claims about the same behaviour, the implementer must not silently choose one:

- **In attended mode** (a human is watching the session): the implementer stops and presents the contradiction clearly, showing the conflicting passages from both specs, and asks the human to resolve it.
- **In unattended mode** (no human in the session): the implementer records the contradiction as a **blocking issue** in `HANDOFF.md`, marks it with a `BLOCKED:` prefix, and does not implement the contradicted behaviour. It may continue with unrelated tasks in the same step. If the contradiction prevents the step's acceptance criteria from being met, the step ends with status `blocked` (see `feature/plan-steps`); otherwise it ends `done` with the `BLOCKED:` item listed under open issues.

Whether a session is attended is decided by the harness, not by config: a session is attended when the agent can ask a human and wait for the answer, and unattended otherwise (for example, background, scheduled, CI, or `external`-backend runs). When in doubt, the agent treats the session as unattended, so that it never waits indefinitely for an answer.

A contradiction is a signal that one or both specs need to be updated. The resolution is a spec edit, not a code decision.

### Rule 5: Specs describe desired current state

Specs describe the desired state of the implementation at the time they are approved. They are not changelogs.

A plan that changes behaviour includes spec edits on its own branch. Spec and code land in the same review. This ensures the approved specs always reflect what is currently implemented.

An approved spec edited on a plan branch keeps `status: approved`: approval of the plan's pull request (or local merge) is approval of the spec edit. The spec authorship policy still applies to the edit itself — for example, under `specs.feature.llm_role: assist` the agent proposes the feature spec change and a human makes it. Spec approval requirements for starting a plan (`plans.require_approved_specs`) are checked only when the plan first starts, so a plan's own spec edits never block its resumption.

---

## Summary table

| Situation | Action |
|-----------|--------|
| Architecture spec covers the detail | Follow the architecture spec |
| Architecture spec silent; feature spec covers it | Follow the feature spec; record the gap in HANDOFF.md |
| Both specs silent | Make a reasonable default; record the assumption in HANDOFF.md |
| Architecture spec and feature spec contradict | Stop (attended) or block and record (unattended) |
| Architecture spec contradicts a deprecated spec | Follow the architecture spec; note the deprecated reference for cleanup |

---

## Acceptance scenarios

### Scenario 1: Architecture spec is authoritative

Given `architecture/search` specifies "Search results are sorted by relevance score descending",
And `feature/search` does not mention sort order,
When implementing search result ordering,
Then the implementer follows `architecture/search` and sorts by relevance score descending without consulting the feature spec.

### Scenario 2: Filling a behavioural gap

Given `architecture/validation` specifies "Check that each spec ID matches its file path",
But does not specify the error message for a mismatch,
And `feature/spec-system` Scenario 2 specifies "ID `feature/wrong-name` does not match path-derived ID `feature/search`.",
When implementing the ID-mismatch error message,
Then the implementer uses the message from `feature/spec-system` and records in HANDOFF.md: "Gap: `architecture/validation` does not specify the ID-mismatch error message; used `feature/spec-system` Scenario 2 text."

### Scenario 3: Contradiction in attended mode

Given `architecture/plan-status` specifies "`done` is a stored status set in the final commit",
And `feature/plan-status` specifies "`done` is a derived status set automatically when a PR is merged",
When the implementer encounters this during a step,
Then the implementer stops, presents both passages to the human, and does not implement plan status until the contradiction is resolved.

### Scenario 4: Contradiction in unattended mode

Given the same contradiction as Scenario 3,
And the agent is running in unattended mode,
When the implementer encounters the contradiction,
Then HANDOFF.md includes: "BLOCKED: Contradiction between `architecture/plan-status` (stored status) and `feature/plan-status` (derived status) for `done`. Implementation of plan status is deferred. Human must resolve before the next step proceeds."
And the step continues with other tasks that are not affected by this contradiction,
And because the step's acceptance criteria include plan status, the step ends with status `blocked`.

### Scenario 5: Both specs silent

Given neither architecture nor feature spec mentions what to do when a config file is missing,
When the implementer encounters this situation,
Then the implementer chooses a reasonable default (e.g. use built-in defaults and emit a warning),
And records in HANDOFF.md: "Assumption: config file missing → use defaults + warning. Neither spec addresses this case. Consider adding to `feature/configuration` and `architecture/reference-cli`."

### Scenario 6: Spec edit included in plan branch

Given a plan changes the validation error message format,
When the plan is executed,
Then the spec edit (`feature/spec-system` or `architecture/file-formats`, as appropriate) is committed on the same plan branch as the implementation change,
So that the PR for review contains both the spec update and the code change.

---

## Edge cases

- An architecture spec may contradict a deprecated feature spec. This is not a blocking contradiction; the implementer notes it and follows the architecture spec.
- When a feature spec has `allow_architecture: true` and specifies an implementation detail, that detail is treated as authoritative for behaviour (it is part of the feature contract) but the architecture spec still takes precedence for structure and additional detail.
- A contradiction within a single spec (e.g. two sections of the same architecture spec say different things) is treated as a gap rather than a blocking contradiction; the implementer uses the more specific passage and records the internal inconsistency.
