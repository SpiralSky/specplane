#!/bin/sh
# PreToolUse hook (matcher: Edit|MultiEdit|Write|NotebookEdit): enforce specs.<type>.llm_role on spec edits
# and keep approval with the user (never let an edit set approved/ready/accepted).
# none -> deny; review, assist -> ask (blocks in non-interactive sessions); draft -> allow.
# Approval check -> deny for specs, PLAN.md/steps/*.md, and ADRs.
# The edit is reconstructed against the file on disk: only a change to the top-level lifecycle
# status counts as approval, and an edit confined to the frontmatter `implementation:` block
# (a metadata-only declaration) leaves the body alone, so it needs no body approval.
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
# Text the edit writes: Write content, each MultiEdit new_string, Edit new_string.
new_texts=$(printf '%s' "$input" | jq -r '
  if .tool_name == "Write" then (.tool_input.content // empty)
  elif .tool_name == "Edit" then (.tool_input.new_string // empty)
  elif .tool_name == "MultiEdit" then ((.tool_input.edits // [])[] | .new_string // empty)
  else empty end' 2>/dev/null)
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
sid=${id#*:}
cfg_dir() { # $1 top-level key -> its dir value (default handled by caller)
  sed -n "/^$1:/,/^[^[:space:]#]/{s/^[[:space:]]*dir:[[:space:]]*//p;}" "$config" 2>/dev/null | head -n 1 \
    | sed 's/[[:space:]]*#.*$//; s/^["'"'"']//; s/["'"'"'][[:space:]]*$//; s/[[:space:]]*$//'
}
pdir=$(cfg_dir plans); [ -n "$pdir" ] || pdir=plans
ddir=$(cfg_dir decisions); [ -n "$ddir" ] || ddir=decisions
case "$file" in
  "") fpath= ;;
  /*) fpath=$file ;;
  *) fpath="$root/$file" ;;
esac
# Reconstruct the postimage (Write content; Edit/MultiEdit applied to the file) and compare parsed
# frontmatter and body. Prints "unknown" when it cannot, and the sed fallbacks below then apply.
calc=$(printf '%s' "$input" | jq -r --rawfile pre "${fpath:-/dev/null}" '
  def rep($old; $new; $all):
    (index($old)) as $i
    | if $i == null then . else .[:$i] + $new + (.[$i + ($old | length):] | if $all then rep($old; $new; $all) else . end) end;
  def doc: if startswith("---\n") then (.[4:] as $r | ($r | index("\n---\n")) as $e
      | if $e != null then {fm: $r[:$e], body: $r[$e + 5:]}
        elif ($r | endswith("\n---")) then {fm: $r[:-4], body: ""} else null end) else null end;
  def strip: split("\n") | reduce .[] as $l ({keep: [], inimpl: false};
      if ($l | test("^implementation:")) then .inimpl = true
      elif .inimpl and (($l | test("^[ \t]")) or $l == "") then .
      else .inimpl = false | .keep += [$l] end) | .keep | join("\n");
  def topstatus: split("\n") | map(select(test("^status:"))) | (first // "")
      | sub("^status:[ \t]*"; "") | sub("[ \t]*#.*$"; "") | gsub("[\"\u0027]"; "") | sub("[ \t]+$"; "");
  def apply($e): if . == null or ($e.old_string // "") == "" or (index($e.old_string) == null) then null
      else rep($e.old_string; ($e.new_string // ""); ($e.replace_all // false)) end;
  .tool_name as $t | .tool_input as $i
  | (if $t == "Write" then $i.content
     elif $t == "Edit" then ($pre | apply($i))
     elif $t == "MultiEdit" then reduce ($i.edits // [])[] as $e ($pre; apply($e))
     else null end) as $post
  | if $post == null then "unknown" else
      ($pre | doc) as $a | ($post | doc) as $b
      | [ ($b | if . == null then "" else .fm | topstatus end),
          ($a | if . == null then "" else .fm | topstatus end),
          (if $a != null and $b != null and ($a.body | sub("\\s+$"; "")) == ($b.body | sub("\\s+$"; "")) and ($a.fm | strip) == ($b.fm | strip) then "metadata" else "body" end) ] | join(" ") end
' 2>/dev/null) || calc=unknown
[ -n "$calc" ] || calc=unknown
# Approval check: before the type-based early return, and under every llm_role.
approval=0
case "$sid" in feature/*|architecture/*) approval=1 ;; esac
[ -n "$fpath" ] && case "$fpath" in
  "$root/$pdir"/*/PLAN.md|"$root/$pdir"/*/steps/*.md) approval=1 ;;
  "$root/$ddir"/[0-9][0-9][0-9][0-9]-*.md) approval=1 ;;
esac
if [ "$approval" = 1 ]; then
  if [ "$calc" != unknown ]; then
    set -- $calc; new_status=$1; old_status=$2
  else
    new_status=$(printf '%s\n' "$new_texts" \
      | sed -n 's/^[[:space:]]*status:[[:space:]]*\([^[:space:]#]*\).*$/\1/p' | tail -n 1 | tr -d "\"'")
    old_status=""
    if [ -n "$fpath" ] && [ -f "$fpath" ]; then
      old_status=$(sed -n '/^---[[:space:]]*$/,/^---[[:space:]]*$/s/^status:[[:space:]]*\([^[:space:]#]*\).*$/\1/p' "$fpath" 2>/dev/null | head -n 1 | tr -d "\"'")
    fi
  fi
  case "$new_status" in
    approved|ready|accepted)
      # An edit that leaves the existing status in place is not an approval.
      if [ "$new_status" != "$old_status" ]; then
        jq -n --arg d deny \
          --arg r "Approval is the user's decision: run /approve <id> instead of editing status." \
          '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:$d,permissionDecisionReason:$r}}'
        exit 0
      fi
      ;;
  esac
fi
[ -n "$id" ] || exit 0
case "$sid" in
  feature/*) type=feature; default=assist ;;
  architecture/*) type=architecture; default=draft ;;
  *) exit 0 ;;
esac
# A metadata-only implementation declaration leaves the body's authorship unchanged: no body approval.
case "$calc" in *" metadata") exit 0 ;; esac
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
    reason="Policy (specs.$type.llm_role: none) forbids editing $type spec bodies. Tell the user instead." ;;
  review|assist)
    decision=ask
    reason="Policy (specs.$type.llm_role: $role): the user must approve this exact edit." ;;
  *) exit 0 ;;
esac
jq -n --arg d "$decision" --arg r "$reason" \
  '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:$d,permissionDecisionReason:$r}}'
exit 0
