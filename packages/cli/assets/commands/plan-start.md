<!-- Specplane command contract v0.1.3; source: architecture/agent-skills §7 -->
# plan-start

## Purpose

Start a plan in its own branch and worktree (`plan-execution R27`, `R27.6`). This contract is wholly mechanical.

## Preconditions

Configuration must be present at HEAD. Stop with the reason and no change if a precondition fails. The adapter checks required capabilities and refuses missing capabilities by name. Instruction loading on demand is preferred when supported; otherwise use instruction injection. Typed commands without arguments run only mechanical steps and start no model turn; arguments accompany this contract under the acting role. Plain-language requests use the LLM role, never the user role.

`plan.start` must not be deny. With start conditions enabled, the plan and existing referenced specifications must be approved. Specifications the plan will write are excluded. Session opening is required for automatic launch; budgets require usage-measurement for the selected resource.

## Steps

1. [code] `config.get`: read .specplane/config.yaml from HEAD and resolve every path from it. If configuration is absent, say Specplane is not set up and stop without changes.
2. [code] `plan.start`: use the supplied target, otherwise the current branch; record explicitly forced dependencies in the handoff. Check approvals, create the worktree on plan/<id>, and launch its session through the adapter. A refusal names all unapproved dependencies or the missing permission. If session opening is unavailable, report the capability error and the adapter-provided session-opening instruction; do not claim a launch.

## Permissions and requests

`config.get` needs no permission; starting uses `plan.start`.

Every action checks its permissions in code. Allow acts directly unless custom steering asks for a request first. Request-user sends the exact action through `request.send`, writes nothing first, and ends outside a plan with the pending request ID. Deny refuses, names the permission, and permits no retry by another tool, role or direct edit. The LLM cannot switch roles. It answers a request (`request.accept`, `request.decline`) only when its own role has the permission of the requested action and steering says to, and it withdraws its own stale or mistaken requests with `request.cancel`; otherwise it leaves the request to the user. Never edit approval or execution status into a file.

## Output

Give the plan ID, branch, worktree and actual session-launch result. The original checkout stays unchanged. More documentation is available through `docs.search`; search it when information is missing rather than guessing.
