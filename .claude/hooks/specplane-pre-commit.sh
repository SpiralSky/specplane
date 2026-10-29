#!/bin/sh
# PreToolUse hook (matcher: Bash): block `git commit` while specplane validation reports errors.
[ -f "${CLAUDE_PROJECT_DIR:-.}/.specplane/config.yaml" ] || exit 0
command -v specplane >/dev/null 2>&1 || exit 0
if ! command -v jq >/dev/null 2>&1; then
  echo "specplane pre-commit hook: jq not found; skipping validation." >&2
  exit 0
fi
cmd=$(jq -r '.tool_input.command // empty')
printf '%s\n' "$cmd" | grep -Eq '(^|[;&|(])[[:space:]]*git([[:space:]]+-[Cc][[:space:]]+[^[:space:]]+|[[:space:]]+-[^[:space:]]+)*[[:space:]]+commit([[:space:];&|)]|$)' || exit 0
specplane validate >&2 && exit 0
echo "specplane validate reported errors; fix them before committing." >&2
exit 2
