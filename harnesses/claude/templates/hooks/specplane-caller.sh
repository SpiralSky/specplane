#!/bin/sh
# PreToolUse hook (matcher: Specplane's MCP tools, `mcp__specplane__.*`): records which subagent makes a
# harness action call (roles-and-permissions R58, architecture/reference-cli §12.1). All callers of a session share one
# MCP process, so the core cannot tell them apart; the host's hook input names the subagent (`agent_id`, `agent_type`)
# and the MCP request carries the same tool-use ID. The record goes to <git-common-dir>/specplane/callers/<tool_use_id>.json
# and the core reads and deletes it. A main-agent call without `agent_type` gets no record. This hook never decides
# a call: it prints nothing and always exits 0.
root="${CLAUDE_PROJECT_DIR:-$PWD}"
[ -f "$root/.specplane/config.yaml" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0
input=$(cat) || exit 0
id=$(printf '%s' "$input" | jq -r '.tool_use_id // empty' 2>/dev/null) || exit 0
printf '%s' "$id" | grep -Eq '^[A-Za-z0-9_-]{1,128}$' || exit 0
rec=$(printf '%s' "$input" | jq -c --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '
  select((.agent_id // .agent_type | type) == "string" and (.agent_id // .agent_type) != "")
  | {agent_type: (.agent_type // null), agent_id: (.agent_id // null), at: $at}' 2>/dev/null) || exit 0
[ -n "$rec" ] || exit 0
common=$(cd "$root" && git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exit 0
[ -n "$common" ] || exit 0
dir="$common/specplane/callers"
( umask 077; mkdir -p "$dir" ) 2>/dev/null || exit 0
tmp="$dir/.$id.$$.tmp"
( umask 077; printf '%s\n' "$rec" > "$tmp" ) 2>/dev/null && mv -f "$tmp" "$dir/$id.json" 2>/dev/null
rm -f "$tmp" 2>/dev/null
exit 0
