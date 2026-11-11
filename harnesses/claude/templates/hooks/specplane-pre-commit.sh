#!/bin/sh
# PreToolUse hook (matcher: Bash): before a `git commit`, run Specplane validation through the core and deny the
# commit (exit 2) when it reports errors; warnings do not block (architecture/claude-integration §4). Handles
# `git -C d commit`, `git -c k=v commit`, `cd x && git commit` and subshell forms; does not match `git commit-tree`
# or `echo commit`. Exits 0 whenever it cannot do its job (no config, no jq, no specplane).
root="${CLAUDE_PROJECT_DIR:-.}"
[ -f "$root/.specplane/config.yaml" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0
command -v specplane >/dev/null 2>&1 || exit 0
cmd=$(jq -r '.tool_input.command // empty' 2>/dev/null) || exit 0
[ -n "$cmd" ] || exit 0
head="(^|[;&|(\`{]|\\\$\\()[[:space:]]*"
prefix="(([A-Za-z_][A-Za-z_0-9]*=[^[:space:]]*|([^[:space:]]*/)?env|command|exec|sudo|time)[[:space:]]+)*"
gitopts="(-C[[:space:]]+[^[:space:]]+|-c[[:space:]]+[^[:space:]]+|--[A-Za-z-]+(=[^[:space:]]*)?)"
if printf '%s\n' "$cmd" | grep -Eq "${head}${prefix}([^[:space:];&|()]*/)?git([[:space:]]+${gitopts})*[[:space:]]+commit([[:space:];&|)]|\$)"; then
  out=$(cd "$root" && specplane validate 2>&1)
  if [ $? -ne 0 ]; then
    printf 'Specplane validation reports errors; fix them before committing.\n%s\n' "$(printf '%s\n' "$out" | tail -n 20)" >&2
    exit 2
  fi
fi
exit 0
