#!/bin/sh
# Verify the dogfood install in this repository matches harnesses/claude/templates/.
# Every template file (skills, hooks, rules/specplane.md) must be byte-identical to its .claude/ copy.
# settings.json is compared as normalized JSON (jq -S .): the template must be a SUBSET of
# .claude/settings.json, so the dogfood copy may add extra keys of its own but must contain
# everything the template defines.
# Exits 1 and lists differences or missing files; exits 0 when everything is in sync.
root=$(git rev-parse --show-toplevel) || exit 1
tpl="$root/harnesses/claude/templates"
fail=0
list="${TMPDIR:-/tmp}/check-sync.$$"

check() { # $1 template file, $2 installed file
  if [ ! -f "$2" ]; then
    echo "MISSING: ${2#"$root"/} (template ${1#"$root"/})"
    fail=1
  elif ! cmp -s "$1" "$2"; then
    echo "DIFFERS: ${2#"$root"/} (template ${1#"$root"/})"
    fail=1
  fi
}

find "$tpl" -type f | sort > "$list"
while read -r f; do
  rel=${f#"$tpl"/}
  [ "$rel" = settings.json ] && continue
  check "$f" "$root/.claude/$rel"
done < "$list"
rm -f "$list"

inst="$root/.claude/settings.json"
if [ ! -f "$inst" ]; then
  echo "MISSING: .claude/settings.json"; fail=1
elif ! command -v jq >/dev/null 2>&1; then
  echo "SKIPPED: .claude/settings.json comparison needs jq"; fail=1
else
  # contains(): every key/value/array element in the template appears in the installed copy.
  if ! jq -S -n --slurpfile t "$tpl/settings.json" --slurpfile i "$inst" '($i[0] | contains($t[0]))' | grep -q true; then
    echo "DIFFERS: .claude/settings.json does not contain the template settings.json"; fail=1
  fi
fi

[ "$fail" -eq 0 ] && echo "check-sync: OK"
exit "$fail"
