<!-- Specplane command contract v0.1.1; source: architecture/agent-skills §7 -->
# plan-status

## Purpose

Show plan execution state and what is waiting (`plan-execution R31`, `architecture/reference-cli §11.2`). This contract is wholly mechanical.

## Preconditions

Configuration must be present at HEAD. Stop with the reason and no change if a precondition fails. The adapter checks required capabilities and refuses missing capabilities by name. Instruction loading on demand is preferred when supported; otherwise use instruction injection. Typed commands without arguments run only mechanical steps and start no model turn; arguments accompany this contract under the acting role. Plain-language requests use the LLM role, never the user role.

`info.retrieve` must not be deny.

## Steps

1. [code] `config.get`: read .specplane/config.yaml from HEAD and resolve every path from it. If configuration is absent, say Specplane is not set up and stop without changes.
2. [code] `plan.list`: request live status from running checkouts. A run marker without a live session is stopped with reason session ended unexpectedly.

## Permissions and requests

`config.get` needs no permission; listing uses `info.retrieve`.

Every action checks its permissions in code. Allow acts directly unless custom steering asks for a request first. Request-user sends the exact action through `request.send`, writes nothing first, and ends outside a plan with the pending request ID. Deny refuses, names the permission, and permits no retry by another tool, role or direct edit. The LLM cannot switch roles. It answers a request (`request.accept`, `request.decline`) only when its own role has the permission of the requested action, it did not send the request, and steering says to; otherwise it leaves the request to the user. Never edit approval or execution status into a file.

## Output

List each plan with status, stop reason, next step and waiting specifications or requests. More documentation is available through `docs.search`; search it when information is missing rather than guessing.
