#!/bin/sh
# Claude Code statusLine command: one-line Specplane plan/step summary in a plan checkout, empty elsewhere.
# To combine with your own status line, call this script from it and append its output.
# Exits 0 whenever it cannot do its job.
command -v jq >/dev/null 2>&1 || exit 0
input=$(cat) || exit 0
cwd=$(printf '%s' "$input" | jq -r '.workspace.current_dir // .cwd // empty' 2>/dev/null)
[ -n "$cwd" ] || cwd=${CLAUDE_PROJECT_DIR:-.}
root=$(cd "$cwd" 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null) || exit 0
config="$root/.specplane/config.yaml"
[ -f "$config" ] || exit 0
branch=$(cd "$root" && git rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0
case "$branch" in plan/?*) id=${branch#plan/} ;; *) exit 0 ;; esac
dir=$(sed -n '/^plans:/,/^[^[:space:]#]/{s/^[[:space:]]*dir:[[:space:]]*//p;}' "$config" | head -n 1 | sed 's/[[:space:]]*#.*$//; s/^["'"'"']//; s/["'"'"'][[:space:]]*$//; s/[[:space:]]*$//')
[ -n "$dir" ] || dir=plans
pdir="$root/$dir/$id"
[ -d "$pdir/steps" ] && [ -f "$pdir/progress.yaml" ] || exit 0
status=$(sed -n 's/^status:[[:space:]]*//p' "$pdir/progress.yaml" | head -n 1)
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
    *) [ -z "$next" ] && next=$num ;;
  esac
done
[ "$total" -gt 0 ] || exit 0
if [ -n "$next" ]; then line=$(printf '◆ %s · step %02d/%s · %s' "$id" "$next" "$total" "${status:-unknown}")
else line=$(printf '◆ %s · %s/%s done · %s' "$id" "$done_n" "$total" "${status:-unknown}"); fi
printf '%s\n' "$line"
exit 0
