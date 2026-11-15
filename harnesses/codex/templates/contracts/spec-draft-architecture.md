<!-- Specplane command contract v0.1.1; source: architecture/agent-skills §7 -->
# spec-draft-architecture

## Purpose

Generate an architecture specification from features, or a feature specification from requirements (`specifications R67`).

## Preconditions

Configuration must be present at HEAD. Stop with the reason and no change if a precondition fails. The adapter checks required capabilities and refuses missing capabilities by name. Instruction loading on demand is preferred when supported; otherwise use instruction injection. Typed commands without arguments run only mechanical steps and start no model turn; arguments accompany this contract under the acting role. Plain-language requests use the LLM role, never the user role.

Source specifications must exist; approval is not required. `spec.create.<type>` must not be deny.

## Steps

1. [code] `config.get`: read .specplane/config.yaml from HEAD and resolve every path from it. If configuration is absent, say Specplane is not set up and stop without changes.
2. [code] `spec.retrieve`: retrieve the source working set and referenced parts, including higher-layer requirements where cited; read files only for missing parts.
3. [llm] When requirements exist and specification design is delegated to you, consider whether the work belongs in a subproject and choose one where needed, respecting the user’s settings and specification creation permissions. Use a declared subproject, or describe the needed declaration for the user; do not bypass configuration permissions. Qualify references to the root project with `root:`. Draft by topic. Cite the source parts in frontmatter and in each section. List unclear or contradictory sources as questions, report conflicts and follow the higher layer; label choices the sources leave open as assumptions.
4. [code] `spec.create`: submit the draft with cites. The action appends model authorship when configured and rejects status, approval and other legacy record keys. A request stores the proposed change without writing it.
5. [code] `validate`: validate the draft.
6. [code] `coverage`: retrieve uncovered source parts.
7. [llm] Explain coverage, open questions and any sources awaiting-review.

## Permissions and requests

`config.get` needs no permission; retrieval, validation and coverage use `info.retrieve`; creation uses `spec.create.<type>`.

Every action checks its permissions in code. Allow acts directly unless custom steering asks for a request first. Request-user sends the exact action through `request.send`, writes nothing first, and ends outside a plan with the pending request ID. Deny refuses, names the permission, and permits no retry by another tool, role or direct edit. The LLM cannot accept or decline requests or switch roles. Never edit approval or execution status into a file.

## Output

Name the new awaiting-review specification, its source cites, uncovered parts and open questions, and its model author. More documentation is available through `docs.search`; search it when information is missing rather than guessing.
