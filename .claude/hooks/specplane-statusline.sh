#!/bin/sh
# Claude Code statusLine command: one-line Specplane plan/step summary, empty outside a plan checkout.
# Register in .claude/settings.json:
#   "statusLine": { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/specplane-statusline.sh" }
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
[ -d "$pdir/steps" ] || exit 0
total=0; next=; last=
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
  last=$row
  [ -z "$next" ] && [ "$(printf '%s' "$row" | cut -d'|' -f2)" != done ] && next=$row
done
[ "$total" -gt 0 ] || exit 0
[ -n "$next" ] || next=$last
num=$(printf '%s' "$next" | cut -d'|' -f1)
st=$(printf '%s' "$next" | cut -d'|' -f2)
title=$(printf '%s' "$next" | cut -d'|' -f3- | cut -c1-30)
line=$(printf '◆ %s · step %02d/%s %s · %s' "$id" "$num" "$total" "$title" "$st")
[ "$st" = blocked ] && line="$line ⚠ blocked"
printf '%s\n' "$line"
exit 0
