#!/bin/sh
# SessionStart hook: export agent identity and, in a plan checkout, print the plan/step scope.
# Exits 0 whenever it cannot do its job.
root="${CLAUDE_PROJECT_DIR:-.}"
config="$root/.specplane/config.yaml"
[ -f "$config" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0
input=$(cat) || exit 0
model=$(printf '%s' "$input" | jq -r '.model // empty' 2>/dev/null)
sid=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  agent=claude-code
  [ -n "$model" ] && agent="claude-code/$model"
  {
    printf 'export SPECPLANE_AGENT=%s\n' "$agent"
    printf 'export SPECPLANE_SESSION=%s\n' "$sid"
  } >> "$CLAUDE_ENV_FILE" 2>/dev/null
fi
branch=$(cd "$root" && git rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0
case "$branch" in plan/?*) id=${branch#plan/} ;; *) exit 0 ;; esac
dir=$(sed -n '/^plans:/,/^[^[:space:]#]/{s/^[[:space:]]*dir:[[:space:]]*//p;}' "$config" | head -n 1 | sed 's/[[:space:]]*#.*$//; s/^["'"'"']//; s/["'"'"'][[:space:]]*$//; s/[[:space:]]*$//')
[ -n "$dir" ] || dir=plans
pdir="$root/$dir/$id"
[ -d "$pdir/steps" ] || exit 0
total=0; done_n=0; next=
for f in "$pdir"/steps/*.md; do
  [ -f "$f" ] || continue
  row=$(awk '
    NR==1 && $0 !~ /^---[[:space:]]*$/ { exit }
    NR>1 && /^---[[:space:]]*$/ { exit }
    /^step:/ { s=$0; sub(/^step:[[:space:]]*/, "", s) }
    /^title:/ { t=$0; sub(/^title:[[:space:]]*/, "", t) }
    /^status:/ { st=$0; sub(/^status:[[:space:]]*/, "", st) }
    END { printf "%s|%s|%s\n", s, st, t }' "$f")
  total=$((total+1))
  status=$(printf '%s' "$row" | cut -d'|' -f2)
  if [ "$status" = done ]; then done_n=$((done_n+1))
  elif [ -z "$next" ]; then next=$row; fi
done
[ "$total" -gt 0 ] || exit 0
hf="$pdir/HANDOFF.md"
blockers=0
[ -f "$hf" ] && blockers=$(grep -Ec '^[[:space:]]*(-[[:space:]]*)?BLOCKED:' "$hf" 2>/dev/null)
if [ -n "$next" ]; then
  num=$(printf '%s' "$next" | cut -d'|' -f1)
  st=$(printf '%s' "$next" | cut -d'|' -f2)
  title=$(printf '%s' "$next" | cut -d'|' -f3-)
  msg=$(printf 'Specplane: this checkout is plan %s (branch plan/%s). Steps done: %s/%s. Next step: %02d %s (%s). Run /plan-step to execute it; work on that step only. Open blockers: %s.' "$id" "$id" "$done_n" "$total" "$num" "$title" "$st" "$blockers")
else
  msg=$(printf 'Specplane: this checkout is plan %s (branch plan/%s). Steps done: %s/%s. All steps are done; run /plan-finish. Open blockers: %s.' "$id" "$id" "$done_n" "$total" "$blockers")
fi
jq -n --arg m "$msg" '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$m}}'
exit 0
