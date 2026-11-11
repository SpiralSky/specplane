---
name: specplane-plan-abandon
description: "Abandon a plan after the user confirms."
argument-hint: "<plan-id>"
disable-model-invocation: true
---
<!-- Specplane command contract v0.1.0; source: architecture/agent-skills §7 -->
# plan-abandon

## Purpose

End a plan that will not be completed (`plan-execution §3`).

## Preconditions

Configuration must be present at HEAD. Stop with the reason and no change if a precondition fails. The adapter checks required capabilities and refuses missing capabilities by name. Instruction loading on demand is preferred when supported; otherwise use instruction injection. Typed commands without arguments run only mechanical steps and start no model turn; arguments accompany this contract under the acting role. Plain-language requests use the LLM role, never the user role.

`plan.abandon` must not be deny. The user confirms abandoning and chooses whether to force removal or keep a dirty worktree.

## Steps

1. [code] `config.get`: read .specplane/config.yaml from HEAD and resolve every path from it. If configuration is absent, say Specplane is not set up and stop without changes.
2. [code] `plan.list`: show the selected plan, live run state and worktree status; the adapter asks the user for confirmation.
3. [code] `plan.abandon`: after confirmation stop the run, archive as abandoned and remove the worktree only if clean or removal was explicitly forced. Keep the branch. Deletion follows the same confirmation flow through `plan.delete` under its separate permission.

## Permissions and requests

`config.get` needs no permission; listing uses `info.retrieve`; abandoning uses `plan.abandon`; deleting uses `plan.delete`.

Every action checks its permissions in code. Allow acts directly unless custom steering asks for a request first. Request-user sends the exact action through `request.send`, writes nothing first, and ends outside a plan with the pending request ID. Deny refuses, names the permission, and permits no retry by another tool, role or direct edit. The LLM cannot accept or decline requests or switch roles. Never edit approval or execution status into a file.

## Output

Report the result, kept branch or dirty worktree, and dependent plans that can no longer start. More documentation is available through `docs.search`; search it when information is missing rather than guessing.
