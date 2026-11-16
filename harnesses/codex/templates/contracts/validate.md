<!-- Specplane command contract v0.1.1; source: architecture/agent-skills §7 -->
# validate

## Purpose

Check specifications and show warnings and coverage (`verification R12`, `R64`).

## Preconditions

Configuration must be present at HEAD. Stop with the reason and no change if a precondition fails. The adapter checks required capabilities and refuses missing capabilities by name. Instruction loading on demand is preferred when supported; otherwise use instruction injection. Typed commands without arguments run only mechanical steps and start no model turn; arguments accompany this contract under the acting role. Plain-language requests use the LLM role, never the user role.

Requires: `info.retrieve`.

`info.retrieve` must not be deny. Validation does not authorise edits.

## Steps

1. [code] `config.get`: read .specplane/config.yaml from HEAD and resolve every path from it. If configuration is absent, say Specplane is not set up and stop without changes.
2. [code] `validate`: check the requested scope.
3. [code] `warnings` and `coverage`: retrieve findings and coverage gaps.
4. [llm] Summarise by severity and name a fix for each. Never edit merely to silence findings without the user asking. Without arguments the adapter prints the results without a model turn.

## Permissions and requests

`config.get` needs no permission; validation, warnings and coverage use `info.retrieve`.

Every action checks its permissions in code. Allow acts directly unless custom steering asks for a request first. Request-user sends the exact action through `request.send`, writes nothing first, and ends outside a plan with the pending request ID. Deny refuses, names the permission, and permits no retry by another tool, role or direct edit. The LLM cannot accept or decline requests or switch roles. Never edit approval or execution status into a file.

## Output

Report findings, coverage gaps and suggested fixes; distinguish errors from warnings. More documentation is available through `docs.search`; search it when information is missing rather than guessing.
