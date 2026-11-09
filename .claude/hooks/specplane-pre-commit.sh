#!/bin/sh
# PreToolUse hook (matcher: Bash): deny an agent's
# `specplane plan step-done` (a manual, self-assessed declaration that skips the verification minimum; the core records
# a step through the structured workflow). The CLI cannot tell a person from an agent, so this is the host's policy guard.
[ -f "${CLAUDE_PROJECT_DIR:-.}/.specplane/config.yaml" ] || exit 0
deny_step_done() {
  echo "specplane plan step-done is a manual declaration that skips the verification minimum; an agent records a step through /plan-step. Ask the user to run it if they want a manual record." >&2
  exit 2
}
input=$(cat)
if ! command -v jq >/dev/null 2>&1; then
  # The command cannot be parsed without jq, so the deny matches the raw tool call.
  printf '%s\n' "$input" | grep -Eq 'plan[[:space:]]+step-done' && deny_step_done
  exit 0
fi
cmd=$(printf '%s\n' "$input" | jq -r '.tool_input.command // empty')
# `specplane plan step-done`, also through npx/bunx, a path to the binary, or `node .../cli.js`; global flags may precede `plan`.
printf '%s\n' "$cmd" | grep -Eq '(^|[;&|(])[[:space:]]*([A-Za-z_][A-Za-z_0-9]*=[^[:space:]]*[[:space:]]+)*((npx|bunx)([[:space:]]+-[^[:space:]]+)*[[:space:]]+)?([^[:space:];&|]*specplane|node([[:space:]]+-[^[:space:]]+)*[[:space:]]+[^[:space:];&|]*cli\.js)([[:space:]]+-[^[:space:]]+)*[[:space:]]+plan[[:space:]]+step-done([[:space:];&|)]|$)' && deny_step_done
exit 0
