#!/bin/sh
# Verify the dogfood install in this repository matches harnesses/claude/templates/.
# Exits 1 and lists differences or missing files; exits 0 when everything is in sync.
root=$(git rev-parse --show-toplevel) || exit 1
tpl="$root/harnesses/claude/templates"
fail=0

check() { # $1 template file, $2 installed file
  if [ ! -f "$2" ]; then
    echo "MISSING: ${2#"$root"/} (template ${1#"$root"/})"
    fail=1
  elif ! cmp -s "$1" "$2"; then
    echo "DIFFERS: ${2#"$root"/} (template ${1#"$root"/})"
    fail=1
  fi
}

find "$tpl" -type f | sort | while read -r f; do echo "$f"; done > "${TMPDIR:-/tmp}/check-sync.$$"
while read -r f; do
  rel=${f#"$tpl"/}
  case "$rel" in
    settings.json) continue ;;
    *) dest="$root/.claude/$rel" ;;
  esac
  check "$f" "$dest"
done < "${TMPDIR:-/tmp}/check-sync.$$"
rm -f "${TMPDIR:-/tmp}/check-sync.$$"

if [ ! -f "$root/.claude/settings.json" ]; then
  echo "MISSING: .claude/settings.json"; fail=1
elif ! grep -q 'specplane-pre-commit.sh' "$root/.claude/settings.json"; then
  echo "DIFFERS: .claude/settings.json lacks specplane-pre-commit.sh"; fail=1
fi

[ "$fail" -eq 0 ] && echo "check-sync: OK"
exit "$fail"
