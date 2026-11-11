#!/bin/sh
# PreToolUse hook (matcher: Bash): keep the model off the Specplane CLI (architecture/claude-integration §4,
# reference-cli §12.7). Denies a shell command that runs `specplane` directly, with an env/command/sudo prefix, with a
# path, through `sh -c`, `npx`, `bunx` or a subshell. Best effort: the same forms the core's `isSpecplaneCommand`
# recognises, as a pattern, so it works without the CLI installed. Exits 0 whenever it cannot do its job.
[ -f "${CLAUDE_PROJECT_DIR:-.}/.specplane/config.yaml" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0
cmd=$(jq -r '.tool_input.command // empty' 2>/dev/null) || exit 0
[ -n "$cmd" ] || exit 0
q="[\"']"
head="(^|[;&|(\`{]|\\\$\\(|[[:space:]]-[A-Za-z]*c[[:space:]]+$q)[[:space:]]*"
prefix="(([A-Za-z_][A-Za-z_0-9]*=[^[:space:]]*|([^[:space:]]*/)?env|command|exec|sudo|doas|nohup|time|xargs|-[^[:space:]]+)[[:space:]]+)*"
runner="((npx|bunx|pnpx|npm[[:space:]]+exec|pnpm[[:space:]]+(dlx|exec)|yarn[[:space:]]+dlx|bun[[:space:]]+x)([[:space:]]+-[^[:space:]]+)*[[:space:]]+)?"
bin="([^[:space:];&|()\"'\`]*/)?specplane(@[^[:space:]\"']*)?(\\.m?c?js)?"
end="([[:space:];&|)\"'\`]|\$)"
if printf '%s\n' "$cmd" | grep -Eq "${head}${prefix}${runner}${bin}${end}"; then
  echo "The Specplane CLI is for people. Use the Specplane harness actions (the Specplane MCP tools) instead, or ask the user to run the command." >&2
  exit 2
fi
exit 0
