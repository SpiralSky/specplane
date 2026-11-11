---
name: specplane-plan-finish
description: "Run the final review of a plan and decide whether it is complete."
argument-hint: "[plan-id]"
disable-model-invocation: true
---
<!-- Specplane command contract v0.1.0; source: architecture/agent-skills §7 -->
# plan-finish

## Purpose

Present the final review and the user decision, with merging separate (`plan-execution §2`, `plans R28`, `R28.1`).

## Preconditions

Configuration must be present at HEAD. Stop with the reason and no change if a precondition fails. The adapter checks required capabilities and refuses missing capabilities by name. Instruction loading on demand is preferred when supported; otherwise use instruction injection. Typed commands without arguments run only mechanical steps and start no model turn; arguments accompany this contract under the acting role. Plain-language requests use the LLM role, never the user role.

The user decides whether to complete or return for more work. Completion and merging need `plan.complete`; the contract never makes the decision for them.

## Steps

1. [code] `config.get`: read .specplane/config.yaml from HEAD and resolve every path from it. If configuration is absent, say Specplane is not set up and stop without changes.
2. [code] `plan.review`: collect outcomes, gaps, unrun steps, pending requests, changed target references and plan-branch specification changes.
3. [llm] Assess each acceptance criterion with evidence and show the review to the user. Do not decide for the user.
4. [code] `plan.finish`: apply the user choice, complete or back with a reason. Completion archives in the final plan-branch commit; back returns to in-progress. Request-user creates a pending request; deny stops after review.
5. [llm] If returned for work, propose added or changed steps to the user.
6. [code] `plan.edit`: apply approved plan changes under its own permission, respecting started-step protection.
7. [code] `plan.merge`: offer a separate pull request or local merge choice; act only on the user decision. If the target moved, show a fresh `plan.review` first. Report conflicts to the user, never resolve them automatically.

## Permissions and requests

`config.get` needs no permission; review uses `info.retrieve`; finish and merge use `plan.complete`; edits use `plan.edit`. Review cannot itself complete or merge the plan.

Every action checks its permissions in code. Allow acts directly unless custom steering asks for a request first. Request-user sends the exact action through `request.send`, writes nothing first, and ends outside a plan with the pending request ID. Deny refuses, names the permission, and permits no retry by another tool, role or direct edit. The LLM cannot accept or decline requests or switch roles. Never edit approval or execution status into a file.

## Output

Show the review, decision or pending request, and separate merge options. More documentation is available through `docs.search`; search it when information is missing rather than guessing.
