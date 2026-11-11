# CLI step 6 notes: requests, budgets, permission engine

Written 2026-11-09. Scope: `requests` R52 and `reference-cli` §8, budgets (`plan-execution` R27.1, `reference-cli` §11.4), completing the permission engine of `roles-and-permissions`, and the legacy-code check. Specs were not edited.

## Code

- `requests/store.ts` (records of `file-formats` §9.2, structural validation instead of `ajv`, lock-file compare-and-set), `requests/hold.ts` (stores a request when the guard says `request-user`, audits `request-sent`, push notifier hook), `requests/actions.ts` (what accepting runs again, per command), `requests/ops.ts` (send, list, show, accept, decline), `commands/requests.ts` (`specplane requests [list|show|accept|decline]`).
- `spec/edit.ts`: `editSpec` (the LLM's body edit): allow writes the text and the review state; `request user` stores a unified diff in `params.patch`; accept applies it with `git apply`. `diff` is recomputed at show time against the last approved text (`approval.commit`), whole text as additions when never approved.
- Every guarded action now holds instead of refusing: `spec approve|reopen|meta set|override *` return a result with `request` (exit 0); `config set|unset` return `request`; plan operations throw `RequestSent` (printed, exit 0). The guard's `request` result now carries all permissions of the action.
- `plan/budget.ts` (`evaluateBudget`, `checkBudget`), `plan usage <id> --reading r=percent [--finished]` for adapters, `assertMeasurable` (adapter names measurable resources in `SPECPLANE_MEASURABLE_RESOURCES`).
- Permission engine: `plan.step` added, `switchRole` refuses an LLM actor, `role switch` is audited.
- Tests: `requests/requests.test.ts` (11), `perm/permissions.test.ts` (6), plan tests for budgets, request acceptance, blocking requests and `plan.step`.

## Assumptions and deviations

- **`plan step-done` permission.** The catalog had none and `roles-and-permissions` R50 says a new command brings its own permission with a default in every preset. I added `plan.step` (not in `file-formats` §7.1): allow for the LLM in all four presets, allow for the Standard User. Recording a step is part of a run the user started, so a request per step would stop every run; the permission still lets a custom preset deny it, and the step is audited. `file-formats` §7.1/§7.2 should list it.
- **Accepting a request is the user's confirmation.** A spec group approval accepted from a request runs with `yes: true`; the group list is in the request's `params.ids`. The acceptor is recorded as the approver (a person is required; an LLM never accepts).
- **Accept failures.** Any action that returns not-ok or throws after the permission check marks the request `failed` with `error` (as `file-formats` §9.2 says). Permission failures leave it pending.
- **Declining** needs no permission, only a person (the spec says nothing else).
- **`request send`** exists as the function `sendRequest` (the harness action `request.send`), not as a CLI command: `reference-cli` §13.1 lists only `requests [list|show|accept|decline]` and the CLI is not for LLMs. Sending is refused when the role's mode for a listed permission is `deny`. Allow-mode sends are accepted without steering (steering is not built).
- **Blocking requests.** `sendRequest` with `blocking` and a plan soft stops the plan with `waiting for request <id>`; accept or decline return `resume: <plan>` when the plan is still stopped for that reason; `plan resume` returns `answers` for it. The harness does not resume by itself (no adapter yet).
- **Spec requests other than edit.** Create and delete of a spec have no command and so no action; `spec edit` covers body edits of feature and architecture specs. Requirement-page edits are not handled (`requirement` layer has no spec doc in the project model).
- **Request shapes.** `params` per command: spec approve `{ids}`, reopen `{id}`, meta set `{id,field,value}`, override `{kind,id,args}`, config `{key,old,new,op,arg}`, plan commands `{id, ...options}`.
- **Audit.** The guarded action's own entries carry the request id when it runs from an accept, plus a `requests accept|decline` entry. Reads and the command runner's per-command entry are still not audited (as in step 2).
- **Budgets.** Usage is a percent per resource. The soft stop is two-phase: `plan usage` returns the instruction and does not stop the plan until the adapter calls it again with `--finished`; the hard stop is recorded at once (`stop.kind: hard`). A stopped plan is not stopped again. There is still no adapter to measure usage or end a session, so enforcement is only as good as the caller.
- **LLM role rules (R44.1), custom roles, strict mode** are later releases and not built. A subagent has the role of its parent because the engine knows only `llm`.

## Legacy code (not removed)

`legacy-config.ts` and `legacy-plan/` are still imported by live code, so they stay. Importers outside tests and `legacy-*`: `commands/decision.ts`, `init.ts`, `plan.ts`, `plan-approve.ts`, `search.ts`, `spec.ts`, `spec-pin.ts`, `validate.ts`, `generate.ts`, `core/*` (conductor, confirmed-operations, content-recording, creation-plans, index, non-plan-recording, pending-recovery, recording-recovery, verification, workflow-preparation, workflow-recording, completion-writer, contribution-capture, contribution-history), `generate/*` (snapshot, mermaid, plans-md), `harness/claude.ts`, `harness/claude-mcp.ts`, `harness/conformance-matrix.ts`, `docs/freshness.ts`. `cli.ts` registers `commands/decision`, `init`, `spec`, `search`, `validate`, `workflow` and `core/index`, which reach them. They go with the harness step (core operation engine, MCP, generate), not here.
