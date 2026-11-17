---
name: specplane-migrate
description: "Bring an existing project, including one in an older Specplane format, into Specplane. Use when the user asks to migrate a project."
argument-hint: "[what to migrate from]"
disable-model-invocation: false
---
<!-- Specplane command contract v0.1.1; source: architecture/agent-skills §7 -->
# migrate

## Purpose

Bring an existing project, including one in an older Specplane format, into Specplane from its specifications, documents and code (`later-releases R66`).

## Preconditions

Configuration must be present at HEAD. Stop with the reason and no change if a precondition fails. The adapter checks required capabilities and refuses missing capabilities by name. Instruction loading on demand is preferred when supported; otherwise use instruction injection. Typed commands without arguments run only mechanical steps and start no model turn; arguments accompany this contract under the acting role. Plain-language requests use the LLM role, never the user role.

Prefer asking the user over guessing, and leave out what you cannot find evidence for. If every `spec.create` permission is deny, do not write: propose the specifications and tell the user what to create, or send requests where the mode is request-user.

## Steps

1. [code] `config.get`: read .specplane/config.yaml from HEAD and resolve every path from it. If configuration is absent, say Specplane is not set up and stop without changes.
2. [code] `info.retrieve`: list the specifications that already exist, so a later run recognises what an earlier run wrote and adds only what is missing.
3. [llm] Read the sources the user named: existing specifications, documents and code, including old architecture records, overlay roots and per-type role settings. Show the user what you found and what you propose to write, and what you will leave out and why. Ask about anything uncertain. Do not write before the user has seen the proposal.
4. [code] `spec.create` (`spec.create.requirement`, `spec.create.feature` or `spec.create.architecture` by layer): write each proposed specification. Trace feature and architecture specifications to the project's requirements when it has them. Every new specification starts as Awaiting Review whatever the source's status; never write approval. Never overwrite an existing specification; never delete or rewrite the old files unless the user asks.
5. [code] `decision.add`: only when decision records are on and the user chose to keep an old architecture record as one. Overlays become subprojects only after the user accepts the mapping and its inheritance. Old role settings are replaced by a permission preset the user chooses, not written by you.

## Permissions and requests

`config.get` needs no permission; reading uses `info.retrieve`; writing uses the `spec.create.*` permission of the layer.

Every action checks its permissions in code. Allow acts directly unless custom steering asks for a request first. Request-user sends the exact action through `request.send`, writes nothing first, and ends outside a plan with the pending request ID. Deny refuses, names the permission, and permits no retry by another tool, role or direct edit. The LLM cannot switch roles. It answers a request (`request.accept`, `request.decline`) only when its own role has the permission of the requested action and steering says to, and it withdraws its own stale or mistaken requests with `request.cancel`; otherwise it leaves the request to the user. Never edit approval or execution status into a file.

## Output

List what you migrated, what you left, and what you were unsure about, and name any pending request. State that every new specification is Awaiting Review and the old files are unchanged. More documentation is available through `docs.search`; search it when information is missing rather than guessing.
