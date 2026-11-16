<!-- Specplane command contract v0.1.1; source: architecture/agent-skills §7 -->
# plan-create

## Purpose

Create an optional plan, or propose later changes to one (`plans R69`, `plan-execution R31`).

## Preconditions

Configuration must be present at HEAD. Stop with the reason and no change if a precondition fails. The adapter checks required capabilities and refuses missing capabilities by name. Instruction loading on demand is preferred when supported; otherwise use instruction injection. Typed commands without arguments run only mechanical steps and start no model turn; arguments accompany this contract under the acting role. Plain-language requests use the LLM role, never the user role.

Requires: `plan.create`.

`plan.create` must not be deny; later edits require `plan.edit`. No plan is required for ordinary work.

## Steps

1. [code] `config.get`: read .specplane/config.yaml from HEAD and resolve every path from it. If configuration is absent, say Specplane is not set up and stop without changes.
2. [code] `spec.retrieve`: retrieve the named specifications and their cited parts as one working set; read files only for missing parts.
3. [llm] Propose the goal, acceptance criteria, small ordered steps, implements cites, referenced plans and context cites. Show the proposal to the user and refine it.
4. [code] `plan.create`: create the dated two-to-four-word ID and template folder, with no status or approval in PLAN.md, empty not-started progress, and step files. For later changes use `plan.edit`, which refuses edits to started steps.
5. [code] `validate`: validate the plan.

## Permissions and requests

`config.get` needs no permission; retrieval and validation use `info.retrieve`; creation uses `plan.create`, later edits `plan.edit`.

Every action checks its permissions in code. Allow acts directly unless custom steering asks for a request first. Request-user sends the exact action through `request.send`, writes nothing first, and ends outside a plan with the pending request ID. Deny refuses, names the permission, and permits no retry by another tool, role or direct edit. The LLM cannot switch roles. It answers a request (`request.accept`, `request.decline`) only when its own role has the permission of the requested action, it did not send the request, and steering says to; otherwise it leaves the request to the user. Never edit approval or execution status into a file.

## Output

Give the plan ID, path and steps. Nothing has started; approval is separate. More documentation is available through `docs.search`; search it when information is missing rather than guessing.
