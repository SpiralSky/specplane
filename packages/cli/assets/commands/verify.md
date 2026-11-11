<!-- Specplane command contract v0.1.0; source: architecture/agent-skills §7 -->
# verify

## Purpose

Judge an architecture specification against its implementation and record evidence (`verification R36.1`, `R61.2`, `R61.3`).

## Preconditions

Configuration must be present at HEAD. Stop with the reason and no change if a precondition fails. The adapter checks required capabilities and refuses missing capabilities by name. Instruction loading on demand is preferred when supported; otherwise use instruction injection. Typed commands without arguments run only mechanical steps and start no model turn; arguments accompany this contract under the acting role. Plain-language requests use the LLM role, never the user role.

Retrieve and test against committed state, ignoring pending implementation changes and explicitly noting a dirty tree. Marking implemented also requires architecture.llm_may_mark_implemented and the action permission.

## Steps

1. [code] `config.get`: read .specplane/config.yaml from HEAD and resolve every path from it. If configuration is absent, say Specplane is not set up and stop without changes.
2. [code] `spec.retrieve` and `spec.review-context`: retrieve the specification working set and cited parts, declared checks, coverage, warnings and results. Identify committed content to check and sections without tests; read only missing parts directly.
3. [code] `test.run`: run every declared deterministic test at the checked commit.
4. [llm] For each section declaring intelligent judgement or no tests, inspect the committed specification and implementation, then decide met or not with concise evidence and no credentials or private data.
5. [code] `test.record`: record each result on the checked specification. Request-user records nothing before acceptance and refuses changed commits or content; deny leaves the result unrecorded.
6. [code] `spec.implement`: mark implemented only when every declared check passes and the permission and configuration allow it; report the failing or missing check otherwise.

## Permissions and requests

`config.get` needs no permission; retrieval, review and test runs use `info.retrieve`; recording and marking implementation use `test.record`. No verification result approves a specification.

Every action checks its permissions in code. Allow acts directly unless custom steering asks for a request first. Request-user sends the exact action through `request.send`, writes nothing first, and ends outside a plan with the pending request ID. Deny refuses, names the permission, and permits no retry by another tool, role or direct edit. The LLM cannot accept or decline requests or switch roles. Never edit approval or execution status into a file.

## Output

Give per-section outcomes, recorded versus unrecorded evidence, and implementation status at the checked commit. More documentation is available through `docs.search`; search it when information is missing rather than guessing.
