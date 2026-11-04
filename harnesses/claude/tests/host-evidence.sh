#!/bin/sh
# Check a Claude Code mod-API declarations file against the recorded host-surface
# fixture (harnesses/claude/host-evidence/<version>/capabilities.json). Offline: no
# session is started and no model is called.
#
# Usage: host-evidence.sh <claude-code.d.ts> [fixture-version]
#   The declarations file is written by the engine when the plugin-authoring skill
#   loads, or beside a loaded mod as .claude-plugin/types/claude-code/index.d.ts.
#   fixture-version defaults to the version on the file's first line.
#
# Checks: version and sha256 against the fixture (a mismatch is reported, not fatal),
# every recorded declaration still present verbatim, the probe mod type-checking under
# strict tsc, and `claude plugin validate` / `claude plugin test` on the probe when
# `claude` is on PATH and matches the version. Exits 1 on any drift or failure.
root=$(git rev-parse --show-toplevel) || exit 1
dts=$1
[ -f "$dts" ] || { echo "usage: $0 <claude-code.d.ts> [fixture-version]" >&2; exit 2; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 2; }

declared=$(head -n 1 "$dts" | sed -n 's|^// Written by Claude Code \([0-9][0-9.]*\)\.$|\1|p')
version=${2:-$declared}
[ -n "$version" ] || { echo "cannot read a version from the first line of $dts" >&2; exit 2; }
dir="$root/harnesses/claude/host-evidence/$version"
fixture="$dir/capabilities.json"
[ -f "$fixture" ] || { echo "NO FIXTURE: $version (have: $(ls "$root/harnesses/claude/host-evidence" | tr '\n' ' '))"; exit 1; }
fail=0

[ "$declared" = "$version" ] || echo "NOTE: declarations are $declared, fixture is $version"
sum=$(sha256sum "$dts" | cut -d' ' -f1)
[ "$sum" = "$(jq -r .declarations.sha256 "$fixture")" ] || echo "NOTE: sha256 differs from the fixture ($sum)"

jq -r '.capabilities[] | .id as $id | .declarations[] | "\($id)\t\(.)"' "$fixture" > "${TMPDIR:-/tmp}/host-evidence.$$"
while IFS="$(printf '\t')" read -r id decl; do
  if ! grep -q -F -- "$decl" "$dts"; then
    echo "DRIFT: $id: missing declaration: $decl"
    fail=1
  fi
done < "${TMPDIR:-/tmp}/host-evidence.$$"
rm -f "${TMPDIR:-/tmp}/host-evidence.$$"

tsc="$root/packages/cli/node_modules/.bin/tsc"
[ -x "$tsc" ] || tsc=$(command -v tsc)
if [ -n "$tsc" ]; then
  work=$(mktemp -d) || exit 1
  cat > "$work/tsconfig.json" <<EOF
{ "compilerOptions": { "target": "es2023", "lib": ["es2023"], "types": [], "module": "esnext",
    "moduleResolution": "bundler", "strict": true, "noUncheckedIndexedAccess": true, "noEmit": true,
    "skipLibCheck": true, "jsx": "react", "jsxFactory": "h", "jsxFragmentFactory": "Fragment" },
  "files": ["$(realpath "$dts")"],
  "include": ["$dir/probe/hooks", "$dir/probe/*.test.ts"] }
EOF
  if ! "$tsc" -p "$work/tsconfig.json"; then echo "FAIL: probe does not type-check against $dts"; fail=1; fi
  rm -rf "$work"
else
  echo "SKIPPED: tsc not found (run npm install in packages/cli)"
fi

if command -v claude >/dev/null; then
  running=$(claude --version 2>/dev/null | cut -d' ' -f1)
  if [ "$running" = "$declared" ]; then
    claude plugin validate "$dir/probe" >/dev/null 2>&1 || { echo "FAIL: claude plugin validate"; fail=1; }
    claude plugin test "$dir/probe" >/dev/null 2>&1 || { echo "FAIL: claude plugin test (rerun it in $dir/probe to see why)"; fail=1; }
  else
    echo "SKIPPED: validate/test: installed claude is $running, declarations are $declared"
  fi
else
  echo "SKIPPED: validate/test: claude not on PATH"
fi

[ "$fail" = 0 ] && echo "OK: Claude Code $declared matches host-evidence/$version"
exit "$fail"
