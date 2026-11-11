---
name: specplane-spec-assist
description: "Write or change a specification together with the user. Use when the user asks to write, refine or review a spec."
argument-hint: "<spec or description>"
disable-model-invocation: false
---
<!-- Specplane command contract v0.1.0; source: architecture/agent-skills §7 -->
# spec-assist

## Purpose

Write or edit a feature or architecture specification with the user (`harness R19`, `specifications R4`).

## Preconditions

Configuration must be present at HEAD. Stop with the reason and no change if a precondition fails. The adapter checks required capabilities and refuses missing capabilities by name. Instruction loading on demand is preferred when supported; otherwise use instruction injection. Typed commands without arguments run only mechanical steps and start no model turn; arguments accompany this contract under the acting role. Plain-language requests use the LLM role, never the user role.

The relevant `spec.create.<type>` or `spec.edit.<type>` must not be deny.

## Steps

1. [code] `config.get`: read .specplane/config.yaml from HEAD and resolve every path from it. If configuration is absent, say Specplane is not set up and stop without changes.
2. [code] `spec.retrieve`: retrieve the working set, cited higher-layer parts and related specifications the user names in one call; read files only for missing parts.
3. [llm] Discuss and refine the content until the user finalises it. Do not invent requirements; ask about unclear requirements.
4. [code] `spec.create` or `spec.edit`: submit the new text with source cites. The action appends model authorship with contribution detail when configured, and rejects status, approval and other legacy record keys. Under request-user it stores the exact patch without writing it.
5. [code] `validate`: validate the changed specification and report findings.

## Permissions and requests

`config.get` needs no permission; retrieval and validation use `info.retrieve`; writing uses `spec.create.<type>` or `spec.edit.<type>`.

Every action checks its permissions in code. Allow acts directly unless custom steering asks for a request first. Request-user sends the exact action through `request.send`, writes nothing first, and ends outside a plan with the pending request ID. Deny refuses, names the permission, and permits no retry by another tool, role or direct edit. The LLM cannot accept or decline requests or switch roles. Never edit approval or execution status into a file.

## Output

Say what changed, that changed content is awaiting-review, and that approval is a separate permission-checked action. More documentation is available through `docs.search`; search it when information is missing rather than guessing.
