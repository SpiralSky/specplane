#!/bin/sh
# PreToolUse hook (matcher: Edit|MultiEdit|Write|NotebookEdit): enforce specs.<type>.llm_role on spec edits.
# none -> deny; assist -> ask (blocks in non-interactive sessions); draft -> allow.
# Exits 0 whenever it cannot do its job.
root="${CLAUDE_PROJECT_DIR:-.}"
config="$root/.specplane/config.yaml"
[ -f "$config" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0
input=$(cat) || exit 0
tool=$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null) || exit 0
case "$tool" in Edit|MultiEdit|Write|NotebookEdit) ;; *) exit 0 ;; esac
file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' 2>/dev/null)
content=$(printf '%s' "$input" | jq -r '.tool_input.content // empty' 2>/dev/null)
if [ "$tool" = Write ] && [ -n "$content" ]; then
  text=$content
else
  [ -n "$file" ] || exit 0
  case "$file" in /*) path=$file ;; *) path="$root/$file" ;; esac
  [ -f "$path" ] || exit 0
  text=$(cat "$path" 2>/dev/null) || exit 0
fi
id=$(printf '%s\n' "$text" | awk '
  NR==1 && $0 !~ /^---[[:space:]]*$/ { exit }
  NR>1 && /^---[[:space:]]*$/ { exit }
  NR>1 && /^id:/ { sub(/^id:[[:space:]]*/, ""); sub(/[[:space:]]*#.*$/, ""); gsub(/["'"'"']/, ""); sub(/[[:space:]]+$/, ""); print; exit }')
[ -n "$id" ] || exit 0
id=${id#*:}
case "$id" in
  feature/*) type=feature; default=assist ;;
  architecture/*) type=architecture; default=draft ;;
  *) exit 0 ;;
esac
role=$(awk -v t="$type" '
  /^[[:space:]]*(#.*)?$/ { next }
  { match($0, /^[[:space:]]*/); ind = RLENGTH }
  ind == 0 { insp = ($0 ~ /^specs:/); intype = 0; next }
  insp && ind > 0 && !intype && $0 ~ ("^[[:space:]]*" t ":") { tind = ind; intype = 1; next }
  intype && ind <= tind { intype = 0 }
  intype && /^[[:space:]]*llm_role:/ {
    v = $0; sub(/^[[:space:]]*llm_role:[[:space:]]*/, "", v); sub(/[[:space:]]*#.*$/, "", v)
    gsub(/["'"'"']/, "", v); sub(/[[:space:]]+$/, "", v); print v; exit
  }' "$config" 2>/dev/null)
[ -n "$role" ] || role=$default
case "$role" in
  none)
    decision=deny
    reason="Policy (specs.$type.llm_role: none) forbids editing $type specs. Tell the user instead." ;;
  assist)
    decision=ask
    reason="Policy (specs.$type.llm_role: assist): the user must approve this exact edit." ;;
  *) exit 0 ;;
esac
jq -n --arg d "$decision" --arg r "$reason" \
  '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:$d,permissionDecisionReason:$r}}'
exit 0
