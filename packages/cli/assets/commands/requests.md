<!-- Specplane command contract v0.1.0; source: architecture/agent-skills §7 -->
# requests

## Purpose

Open the requests pane for the user, with no model turn (`requests R52.1`, `R52.2`, `R52.4`).

## Preconditions

Configuration must be present at HEAD. Stop with the reason and no change if a precondition fails. The adapter checks required capabilities and refuses missing capabilities by name. Instruction loading on demand is preferred when supported; otherwise use instruction injection. Typed commands without arguments run only mechanical steps and start no model turn; arguments accompany this contract under the acting role. Plain-language requests use the LLM role, never the user role.

This is a user-only adapter command. It requires the requests pane capability. It exposes no accept/decline action to the LLM.

## Steps

1. [code] `config.get`: read .specplane/config.yaml from HEAD and resolve every path from it. If configuration is absent, say Specplane is not set up and stop without changes.
2. [code] User-command adapter: open the requests pane. This UI is adapter-owned, not an LLM action in the registry. Show the proposed action and specification diff from last approval; answer through the user runner, which checks the permission for the requested action and checks that it is still applicable.

## Permissions and requests

`config.get` needs no permission. The user answering needs the requested action permission. The LLM can only send requests through `request.send`, never answer them.

Every action checks its permissions in code. Allow acts directly unless custom steering asks for a request first. Request-user sends the exact action through `request.send`, writes nothing first, and ends outside a plan with the pending request ID. Deny refuses, names the permission, and permits no retry by another tool, role or direct edit. The LLM cannot accept or decline requests or switch roles. Never edit approval or execution status into a file.

## Output

Show pending requests and their results in the pane; start no model turn. More documentation is available through `docs.search`; search it when information is missing rather than guessing.
