#!/bin/sh
# PostToolUse hook (matcher: Edit|Write): regenerate derived files after a PLAN.md edit.
# Optional; not registered by default. To enable, add this to the hooks.PostToolUse array in .claude/settings.json:
#   { "matcher": "Edit|Write", "hooks": [ { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/specplane-generate.sh" } ] }
# Always exits 0.
[ -f "${CLAUDE_PROJECT_DIR:-.}/.specplane/config.yaml" ] || exit 0
command -v specplane >/dev/null 2>&1 || exit 0
command -v jq >/dev/null 2>&1 || exit 0
file=$(jq -r '.tool_input.file_path // empty' 2>/dev/null) || exit 0
case "$file" in
  */PLAN.md) specplane generate >&2 || true ;;
esac
exit 0
