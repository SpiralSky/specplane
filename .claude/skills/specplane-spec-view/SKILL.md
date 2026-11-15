---
name: specplane-spec-view
description: "Show one specification with its status and what changed since its last approval. Only the user runs this command."
argument-hint: "[spec id]"
disable-model-invocation: true
---
<!-- Specplane command contract v0.1.1; source: architecture/agent-skills §7 -->
# spec-view

## Purpose

Show the user one specification with its status and the change since its last approval, with no model turn (`harness R21`, `R21.1`).

## Preconditions

Configuration must be present at HEAD. Stop with the reason and no change if a precondition fails. The adapter checks required capabilities and refuses missing capabilities by name. Instruction loading on demand is preferred when supported; otherwise use instruction injection. Typed commands without arguments run only mechanical steps and start no model turn; arguments accompany this contract under the acting role. Plain-language requests use the LLM role, never the user role.

This is a user-only adapter command. It requires the viewing capability; an adapter without it refuses and names it. It uses `info.retrieve` (`harness R26.2`) and has no permission of its own. It exposes no LLM action.

## Steps

1. [code] `config.get`: read .specplane/config.yaml from HEAD and resolve every path from it. If configuration is absent, say Specplane is not set up and stop without changes.
2. [code] User-command adapter: with a spec ID, show its status, authors and approval, then the change since the last approval as a highlighted diff (a never-approved spec shows as all new; a requirement file shows its change since HEAD), then the text. With no ID, list the specs with their status. Start no model turn.

## Permissions and requests

`config.get` needs no permission. Viewing uses `info.retrieve` and has no permission of its own (`harness R21.1`). The LLM reads specs with `spec.retrieve` under the same permission.

Every action checks its permissions in code. Allow acts directly unless custom steering asks for a request first. Request-user sends the exact action through `request.send`, writes nothing first, and ends outside a plan with the pending request ID. Deny refuses, names the permission, and permits no retry by another tool, role or direct edit. The LLM cannot accept or decline requests or switch roles. Never edit approval or execution status into a file.

## Output

The spec's status, authors, approval, the change since its last approval and its text; start no model turn. More documentation is available through `docs.search`; search it when information is missing rather than guessing.
