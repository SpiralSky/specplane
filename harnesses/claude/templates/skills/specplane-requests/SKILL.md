---
name: specplane-requests
description: "Open the requests pane. Only the user runs this command."
argument-hint: "[list | show <id> | accept <id> | decline <id>]"
disable-model-invocation: true
---
<!-- Specplane command contract v0.1.2; source: architecture/agent-skills §7 -->
# requests

## Purpose

Tell the user where the interactive requests view is. Do nothing else (`requests R52.1`, `R52.2`, `R52.4`).

## Preconditions

If you are reading this text, the Specplane plugin is not loaded: the interactive requests view is the plugin's `/requests` command and this typed command only reaches you without it. Typed commands run only mechanical steps and start no model turn when the plugin handles them.

## Steps

1. [llm] Tell the user, and do nothing else: the interactive requests view is the plugin's `/requests` command, available when Claude Code is started with the Specplane plugin (`claude --plugin-dir <path to packages/cli/dist/plugin>`; see the user documentation `harnesses`). Until then the user can accept a request in a terminal outside this session with `specplane requests accept <id>`; a `!` command inside a session counts as the LLM, so it does not work.

## Permissions and requests

Call no action: this typed command only tells the user where the requests pane is. Answering requests is done through `request.accept` and `request.decline` outside this command. The LLM cannot switch roles. It answers a request (`request.accept`, `request.decline`) only when its own role has the permission of the requested action and steering says to, and it withdraws its own stale or mistaken requests with `request.cancel`; otherwise it leaves the request to the user. Never edit approval or execution status into a file.

## Output

Only the message from the step above; start no other work. More documentation is available through `docs.search`; search it when information is missing rather than guessing.
