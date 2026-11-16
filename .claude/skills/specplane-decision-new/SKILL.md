---
name: specplane-decision-new
description: "Record a decision the user made, with its context, as a decision record. Use when the user states a decision to keep."
argument-hint: "[what was decided]"
disable-model-invocation: false
---
<!-- Specplane command contract v0.1.1; source: architecture/agent-skills §7 -->
# decision-new

## Purpose

Store a decision the user made, with its context, as a decision record, optionally written from the user's description (`later-releases R37`, `R37.1`).

## Preconditions

Configuration must be present at HEAD. Stop with the reason and no change if a precondition fails. The adapter checks required capabilities and refuses missing capabilities by name. Instruction loading on demand is preferred when supported; otherwise use instruction injection. Typed commands without arguments run only mechanical steps and start no model turn; arguments accompany this contract under the acting role. Plain-language requests use the LLM role, never the user role.

Decision records must be on (`decisions.enabled`); with them off, store and search nothing and tell the user how to turn them on. `decision.add` must not be deny. A record holds the user's decision, never the LLM's suggestion: write it only after the user has made the decision in the conversation, or when the user's description states it.

## Steps

1. [code] `config.get`: read .specplane/config.yaml from HEAD and resolve every path from it. If configuration is absent, say Specplane is not set up and stop without changes. Read `decisions.enabled`; if it is off, stop.
2. [code] `decision.retrieve`: search the records for the topic in one call, so a settled or conflicting decision is shown to the user before another is stored.
3. [llm] From the user's description, or the decision the user has just made in the conversation, write the title, the decision, the context and reasons the user gave, and the specifications or plans it concerns. Use the user's words; do not add reasons the user did not give. Ask when it is unclear whether the user has decided.
4. [code] `decision.add`: submit the record. The action assigns the ID and the date and appends model authorship when configured. Under request-user it stores the exact record without writing it.

## Permissions and requests

`config.get` needs no permission; searching uses `decision.retrieve`; storing uses `decision.add`. Editing or deleting a record is `decision.edit` or `decision.delete` and only on the user's explicit request.

Every action checks its permissions in code. Allow acts directly unless custom steering asks for a request first. Request-user sends the exact action through `request.send`, writes nothing first, and ends outside a plan with the pending request ID. Deny refuses, names the permission, and permits no retry by another tool, role or direct edit. The LLM cannot switch roles. It answers a request (`request.accept`, `request.decline`) only when its own role has the permission of the requested action, it did not send the request, and steering says to; otherwise it leaves the request to the user. Never edit approval or execution status into a file.

## Output

Say which record was stored or which request is pending, and that a record needs the user's approval by ID before it counts as confirmed. If a related record exists, say how it applies. More documentation is available through `docs.search`; search it when information is missing rather than guessing.
