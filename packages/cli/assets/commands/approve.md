<!-- Specplane command contract v0.1.1; source: architecture/agent-skills §7 -->
# approve

## Purpose

Approve specified IDs under the acting role and dependency checks (`harness R20`, `R20.1`, `cli R16`).

## Preconditions

Configuration must be present at HEAD. Stop with the reason and no change if a precondition fails. The adapter checks required capabilities and refuses missing capabilities by name. Instruction loading on demand is preferred when supported; otherwise use instruction injection. Typed commands without arguments run only mechanical steps and start no model turn; arguments accompany this contract under the acting role. Plain-language requests use the LLM role, never the user role.

The typed approval command is user-only and mechanical, taking exact IDs without interpreting words. Plain-language requests let the LLM resolve IDs and use its own `spec.approve.requirement`, `spec.approve.feature` or `spec.approve.architecture` mode (one per specification type, R16.1; a group needs each member's); never impersonate the user.

## Steps

1. [code] `config.get`: read .specplane/config.yaml from HEAD and resolve every path from it. If configuration is absent, say Specplane is not set up and stop without changes.
2. [code] `spec.retrieve`: for plain-language requests, retrieve the candidate working set and cited parts to identify the specification; read files only for missing parts. Typed ID approval does not need a model.
3. [code] `spec.approve`: check committed content, required approvals, missing cites and failed tests. List cyclic group approvals with their warning and required group confirmation. Under the LLM role, allow approves without extra permission confirmation, request-user stores a request, and deny refuses. A person typing the command uses the user runner.

## Permissions and requests

`config.get` needs no permission; retrieval uses `info.retrieve`; approval uses the `spec.approve.requirement`, `spec.approve.feature` or `spec.approve.architecture` permission of each specification type (decision records and plans use the feature one; approving the requirements page is the user's decision). Allow does not guarantee the LLM asks first; use request-user when confirmation is required. Never accept a request or edit approval records by hand.

Every action checks its permissions in code. Allow acts directly unless custom steering asks for a request first. Request-user sends the exact action through `request.send`, writes nothing first, and ends outside a plan with the pending request ID. Deny refuses, names the permission, and permits no retry by another tool, role or direct edit. The LLM cannot switch roles. It answers a request (`request.accept`, `request.decline`) only when its own role has the permission of the requested action and steering says to, and it withdraws its own stale or mistaken requests with `request.cancel`; otherwise it leaves the request to the user. Never edit approval or execution status into a file.

## Output

Name the approved IDs or exact pending request or refusal, including any approval group. More documentation is available through `docs.search`; search it when information is missing rather than guessing.
