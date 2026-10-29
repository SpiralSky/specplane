#!/bin/sh
# PostToolUse hook (matcher: Bash): after a plan step commit, warn if HANDOFF.md was not part of it.
# Optional; not registered by default. To enable, add this to the hooks.PostToolUse array in .claude/settings.json:
#   { "matcher": "Bash", "hooks": [ { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/specplane-handoff-check.sh" } ] }
# Always exits 0.
config="${CLAUDE_PROJECT_DIR:-.}/.specplane/config.yaml"
[ -f "$config" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0
cmd=$(jq -r '.tool_input.command // empty' 2>/dev/null) || exit 0
printf '%s\n' "$cmd" | grep -Eq '(^|[;&|(])[[:space:]]*git([[:space:]]+-[Cc][[:space:]]+[^[:space:]]+|[[:space:]]+-[^[:space:]]+)*[[:space:]]+commit([[:space:]]|$)' || exit 0
subject=$(git log -1 --format=%s 2>/dev/null) || exit 0
printf '%s\n' "$subject" | grep -Eq '^plan/[^ ]+ step [0-9]+:' || exit 0
id=$(printf '%s\n' "$subject" | sed -n 's|^plan/\([^ ]*\) step [0-9][0-9]*:.*|\1|p')
[ -n "$id" ] || exit 0
dir=$(sed -n '/^plans:/,/^[^[:space:]#]/{s/^[[:space:]]*dir:[[:space:]]*//p;}' "$config" | head -n 1 | sed 's/[[:space:]]*#.*$//; s/^["'"'"']//; s/["'"'"'][[:space:]]*$//; s/[[:space:]]*$//')
[ -n "$dir" ] || dir=plans
path="$dir/$id/HANDOFF.md"
if ! git show --name-only --format= HEAD 2>/dev/null | grep -Fxq "$path"; then
  echo "Warning: step commit did not update $path."
fi
exit 0
