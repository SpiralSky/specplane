<!-- Specplane command contract v0.1.2; source: architecture/agent-skills §7 -->
# spec-review

## Purpose

Review specifications and discuss the result with the user, read-only (`harness R38`, `R38.1`).

## Preconditions

Configuration must be present at HEAD. Stop with the reason and no change if a precondition fails. The adapter checks required capabilities and refuses missing capabilities by name. Instruction loading on demand is preferred when supported; otherwise use instruction injection. Typed commands without arguments run only mechanical steps and start no model turn; arguments accompany this contract under the acting role. Plain-language requests use the LLM role, never the user role.

Before reading or reviewing, call `command.begin` with `command: "spec-review"` to activate the session guard. If it fails, stop. The harness refuses write actions while review is active, even when the role allows them; only `decision.add` and its request path are permitted. Reads retain their permissions. The restriction survives context compaction and ends when the next command begins or the session ends. Begin any subsequent workflow with `command.begin` naming that command. Do not switch commands just to evade a review refusal.

Requires: `info.retrieve`.

Review changes no file. `info.retrieve` must not be deny; if it is, stop and say so. A role that may not edit a specification can still review it.

## Steps

1. [code] `config.get`: read .specplane/config.yaml from HEAD and resolve every path from it. If configuration is absent, say Specplane is not set up and stop without changes.
2. [code] `spec.list` when the user named no specification or asked for all: choose the specifications to review from the list, and say which you chose.
3. [code] `spec.retrieve` for the working set in one call, with the parts it cites, then `spec.review-context` for coverage, warnings and recorded results. Read a file directly only for a part retrieval did not return.
4. [llm] Review each specification and give feedback in the conversation. In feature and architecture specifications point out problems (contradictions with a cited requirement or another specification, behaviour no scenario or test covers, content in the wrong layer; warn the user about architecture content in a feature specification, which belongs in an architecture specification, `specifications R4`) and possible gaps (cases, errors, permissions or limits the cited requirements imply that the specification does not say). In a requirement file do not propose changes: ask the user numbered questions about what is unclear, ambiguous or missing. In every specification also report grammar mistakes, poor wording and unclear instructions, each with the cite or section it concerns and the wording you suggest. Group findings by specification, most important first, and keep to what the text and its references support.
5. [llm] Discuss with the user. Answer follow-up questions from retrieved text, and ask for the user's answer to each open question.
6. [code] `decision.retrieve` and `decision.add`: only when decision records are on and the user states a decision during the discussion. Search first and say when a record already applies; store only what the user decided, never your own suggestion.

## Permissions and requests

`config.get` needs no permission; listing, retrieval and review context use `info.retrieve`, which review shares and has no permission of its own; `decision.retrieve` and `decision.add` use their own permissions.

Every action checks its permissions in code. Allow acts directly unless custom steering asks for a request first. Request-user on `decision.add` creates its pending request without writing the decision record; `request.send` may also submit that exact `decision add` request. Reads can still request permission. Other write requests are refused as read-only. End outside a plan with the pending request ID. Deny refuses, names the permission, and permits no retry by another tool, role or direct edit. The LLM cannot switch roles. It answers a request (`request.accept`, `request.decline`) only when its own role has the permission of the requested action and steering says to, and it withdraws its own stale or mistaken requests with `request.cancel`; otherwise it leaves the request to the user. Never edit a specification, approval or execution status during review. A change that follows from feedback is a separate action: tell the user to use `spec-assist`.

## Output

Findings by specification, then the open questions for the user. State that no file was changed, and name any decision record stored or request pending. More documentation is available through `docs.search`; search it when information is missing rather than guessing.
