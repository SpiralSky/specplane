---
name: specplane-spec-assist
description: "Write or change a specification together with the user. Use when the user asks to write, refine or review a spec."
argument-hint: "<spec or description>"
disable-model-invocation: false
---
<!-- Specplane command contract v0.1.1; source: architecture/agent-skills §7 -->
# spec-assist

## Purpose

Write or edit a feature or architecture specification with the user (`harness R19`, `specifications R4`).

## Preconditions

Configuration must be present at HEAD. Stop with the reason and no change if a precondition fails. The adapter checks required capabilities and refuses missing capabilities by name. Instruction loading on demand is preferred when supported; otherwise use instruction injection. Typed commands without arguments run only mechanical steps and start no model turn; arguments accompany this contract under the acting role. Plain-language requests use the LLM role, never the user role.

The relevant `spec.create.<type>` or `spec.edit.<type>` must not be deny.

## Steps

1. [code] `config.get`: read .specplane/config.yaml from HEAD and resolve every path from it. If configuration is absent, say Specplane is not set up and stop without changes.
2. [code] `spec.retrieve`: retrieve the working set, cited higher-layer parts and related specifications the user names in one call; read files only for missing parts.
3. [llm] Discuss and refine the content until the user finalises it. Do not invent requirements; ask about unclear requirements. When requirements exist and specification design is delegated to you, consider whether the work belongs in a subproject and choose one where needed, respecting the user’s settings and specification creation permissions. Use a declared subproject, or describe the needed declaration for the user; do not bypass configuration permissions. Qualify references to the root project with `root:`. A feature specification states behaviour and scenarios, not architecture (components, interfaces, data formats, technology); when the text you are asked to write or change contains architecture, warn the user and suggest moving it to an architecture specification (`specifications R4`).
4. [code] `decision.retrieve` and `decision.add`: only when `decisions.enabled` is on and the user states a decision during the discussion. Search first and say when a record already applies; store the user's decision with its context, reasons the user gave and the specifications or plans it concerns, never your own suggestion. With records off, store and search nothing.
5. [code] `spec.create` or `spec.edit`: submit the new text with source cites. The action appends model authorship with contribution detail when configured, and rejects status, approval and other legacy record keys. Under request-user it stores the exact patch without writing it.
6. [code] `validate`: validate the changed specification and report findings.

## Permissions and requests

`config.get` needs no permission; retrieval and validation use `info.retrieve`; writing uses `spec.create.<type>` or `spec.edit.<type>`; `decision.retrieve` and `decision.add` use their own permissions.

Every action checks its permissions in code. Allow acts directly unless custom steering asks for a request first. Request-user sends the exact action through `request.send`, writes nothing first, and ends outside a plan with the pending request ID. Deny refuses, names the permission, and permits no retry by another tool, role or direct edit. The LLM cannot switch roles. It answers a request (`request.accept`, `request.decline`) only when its own role has the permission of the requested action and steering says to, and it withdraws its own stale or mistaken requests with `request.cancel`; otherwise it leaves the request to the user. Never edit approval or execution status into a file.

## Output

Say what changed, that changed content is awaiting-review, and that approval is a separate permission-checked action. Name any decision record stored or request pending; a record needs the user’s approval by ID before it counts as confirmed. More documentation is available through `docs.search`; search it when information is missing rather than guessing.
