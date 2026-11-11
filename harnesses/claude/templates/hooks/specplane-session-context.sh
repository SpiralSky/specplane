#!/bin/sh
# SessionStart hook: export agent identity, load the documentation essentials into context (`specplane docs essentials`,
# `steering R23`) and, in a plan checkout (branch plan/<id>), print the plan, its next step and the instruction to
# work only on that step (architecture/claude-integration §4). Runs again after compaction, which redelivers the essentials.
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
plan_message() {
  branch=$(cd "$root" && git rev-parse --abbrev-ref HEAD 2>/dev/null) || return 0
  case "$branch" in plan/?*) id=${branch#plan/} ;; *) return 0 ;; esac
  dir=$(sed -n '/^plans:/,/^[^[:space:]#]/{s/^[[:space:]]*dir:[[:space:]]*//p;}' "$config" | head -n 1 | sed 's/[[:space:]]*#.*$//; s/^["'"'"']//; s/["'"'"'][[:space:]]*$//; s/[[:space:]]*$//')
  [ -n "$dir" ] || dir=plans
  pdir="$root/$dir/$id"
  [ -d "$pdir/steps" ] || return 0
  [ -f "$pdir/progress.yaml" ] || return 0
  status=$(sed -n 's/^status:[[:space:]]*//p' "$pdir/progress.yaml" | head -n 1)
  reason=$(sed -n 's/^[[:space:]]*reason:[[:space:]]*//p' "$pdir/progress.yaml" | head -n 1)
  # progress.yaml `done` is a flow list ([1, 2]) or a block list; leave it as space-separated numbers.
  done_list=$(awk '
    /^done:/ { s=$0; sub(/^done:[[:space:]]*/, "", s); if (s ~ /^\[/) { gsub(/[][,]/, " ", s); print s; exit } inlist=1; next }
    inlist && /^[[:space:]]*-[[:space:]]*/ { v=$0; sub(/^[[:space:]]*-[[:space:]]*/, "", v); printf "%s ", v; next }
    inlist { exit }' "$pdir/progress.yaml")
  total=0; done_n=0; next=
  for f in "$pdir"/steps/*.md; do
    [ -f "$f" ] || continue
    num=$(basename "$f" | sed -n 's/^\([0-9][0-9]*\).*/\1/p')
    [ -n "$num" ] || continue
    num=$(expr "$num" + 0)
    total=$((total+1))
    case " $done_list " in
      *" $num "*) done_n=$((done_n+1)) ;;
      *) if [ -z "$next" ]; then
           title=$(awk 'NR==1 && $0 !~ /^---[[:space:]]*$/ { exit } NR>1 && /^---[[:space:]]*$/ { exit } /^title:/ { t=$0; sub(/^title:[[:space:]]*/, "", t); print t; exit }' "$f")
           next="$num|$title"
         fi ;;
    esac
  done
  [ "$total" -gt 0 ] || return 0
  stopnote=
  [ "$status" = stopped ] && stopnote=" The plan is stopped${reason:+ ($reason)}."
  if [ -n "$next" ]; then
    n=${next%%|*}; title=${next#*|}
    msg=$(printf 'Specplane: this checkout is plan %s (branch plan/%s). Steps done: %s/%s. Next step: %02d %s.%s Run the plan-step command to execute it; work on that step only.' "$id" "$id" "$done_n" "$total" "$n" "$title" "$stopnote")
  else
    msg=$(printf 'Specplane: this checkout is plan %s (branch plan/%s). Steps done: %s/%s. All steps are done; the final review is next (plan-finish).%s' "$id" "$id" "$done_n" "$total" "$stopnote")
  fi
  printf '%s' "$msg"
}
ess=
if command -v specplane >/dev/null 2>&1; then
  ess=$(cd "$root" && specplane docs essentials 2>/dev/null) || ess=
fi
plan=$(plan_message)
text=$ess
[ -n "$plan" ] && text="${text:+$text

}$plan"
[ -n "$text" ] || exit 0
jq -n --arg m "$text" '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$m}}'
exit 0
