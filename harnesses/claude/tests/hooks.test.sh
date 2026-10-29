#!/bin/sh
# Tests for the Specplane Claude hook scripts. POSIX sh; no framework.
here=$(cd "$(dirname "$0")" && pwd)
hooks="$here/../templates/hooks"
command -v jq >/dev/null 2>&1 || { echo "jq is required"; exit 1; }
JQ=$(command -v jq)
tmp=$(mktemp -d) || exit 1
trap 'rm -rf "$tmp"' EXIT INT TERM
ORIG_PATH=$PATH

mkdir "$tmp/stubbin" "$tmp/proj" "$tmp/proj/.specplane" "$tmp/noconf" "$tmp/nospec"
: > "$tmp/proj/.specplane/config.yaml"
# stub specplane: exits with $STUB_EXIT; records invocations in $STUB_LOG
cat > "$tmp/stubbin/specplane" <<'STUB'
#!/bin/sh
echo "$*" >> "${STUB_LOG:-/dev/null}"
exit "${STUB_EXIT:-0}"
STUB
chmod +x "$tmp/stubbin/specplane"
# PATH without specplane
for t in jq grep sh cat printf sed head git dirname; do
  p=$(command -v "$t") && ln -s "$p" "$tmp/nospec/$t"
done

pass=0; fail=0
report() { # name ok
  if [ "$2" = 1 ]; then pass=$((pass+1)); echo "ok   $1"; else fail=$((fail+1)); echo "FAIL $1"; fi
}

# run_case <name> <expected-exit> <json> <stub-exit>
run_case() {
  PATH="$tmp/stubbin:$ORIG_PATH" CLAUDE_PROJECT_DIR="$tmp/proj" STUB_EXIT="$4" \
    sh "$hooks/specplane-pre-commit.sh" >/dev/null 2>&1 <<EOJ
$3
EOJ
  rc=$?
  if [ "$rc" = "$2" ]; then report "$1" 1; else report "$1 (got $rc, want $2)" 0; fi
}
xfail_case() {
  PATH="$tmp/stubbin:$ORIG_PATH" CLAUDE_PROJECT_DIR="$tmp/proj" STUB_EXIT="$4" \
    sh "$hooks/specplane-pre-commit.sh" >/dev/null 2>&1 <<EOJ
$3
EOJ
  rc=$?
  if [ "$rc" = "$2" ]; then echo "XPASS $1 (spec gap fixed; promote to run_case)"; else echo "xfail $1 (known spec gap, got $rc, want $2)"; fi
}
cj() { "$JQ" -n --arg c "$1" '{tool_input:{command:$c}}'; }

# blocked
run_case "block: git commit -m x" 2 "$(cj 'git commit -m x')" 1
run_case "block: cd a && git commit -am x" 2 "$(cj 'cd a && git commit -am x')" 1
run_case "block: git -C dir commit" 2 "$(cj 'git -C dir commit')" 1
run_case "block: git -c user.name=x commit" 2 "$(cj 'git -c user.name=x commit')" 1
run_case "block: git --no-pager commit" 2 "$(cj 'git --no-pager commit')" 1
run_case "block: two-line, second git commit" 2 "$(cj 'echo hi
git commit -m x')" 1
# KNOWN SPEC GAP: the spec'd regex requires whitespace or end of line after `commit`, so `(git commit)`
# is not blocked (the closing paren follows). Recorded in HANDOFF.md; reported as xfail, not a failure.
xfail_case "block: (git commit)" 2 "$(cj '(git commit)')" 1
# allowed, stub fails
run_case "allow: git commit-tree abc" 0 "$(cj 'git commit-tree abc')" 1
run_case "allow: echo commit" 0 "$(cj 'echo commit')" 1
run_case "allow: git log --grep commit" 0 "$(cj 'git log --grep commit')" 1
run_case "allow: git status" 0 "$(cj 'git status')" 1
# allowed otherwise
run_case "allow: stub exits 0" 0 "$(cj 'git commit -m x')" 0
PATH="$tmp/nospec" CLAUDE_PROJECT_DIR="$tmp/proj" "$tmp/nospec/sh" "$hooks/specplane-pre-commit.sh" >/dev/null 2>&1 <<EOJ
$(cj 'git commit -m x')
EOJ
[ $? = 0 ] && report "allow: specplane absent" 1 || report "allow: specplane absent" 0
PATH="$tmp/stubbin:$ORIG_PATH" CLAUDE_PROJECT_DIR="$tmp/noconf" STUB_EXIT=1 sh "$hooks/specplane-pre-commit.sh" >/dev/null 2>&1 <<EOJ
$(cj 'git commit -m x')
EOJ
[ $? = 0 ] && report "allow: no config.yaml" 1 || report "allow: no config.yaml" 0

# generate hook
fj() { "$JQ" -n --arg f "$1" '{tool_input:{file_path:$f}}'; }
gen() { # name path expect-calls
  : > "$tmp/gen.log"
  PATH="$tmp/stubbin:$ORIG_PATH" CLAUDE_PROJECT_DIR="$tmp/proj" STUB_LOG="$tmp/gen.log" STUB_EXIT=1 \
    sh "$hooks/specplane-generate.sh" >/dev/null 2>&1 <<EOJ
$(fj "$2")
EOJ
  rc=$?
  n=$(wc -l < "$tmp/gen.log" | tr -d ' ')
  if [ "$rc" = 0 ] && [ "$n" = "$3" ]; then report "$1" 1; else report "$1 (rc=$rc calls=$n)" 0; fi
}
gen "generate: PLAN.md runs stub" "/r/plans/x/PLAN.md" 1
gen "generate: other file does not" "/r/plans/x/HANDOFF.md" 0
gen "generate: PLAN.md.bak does not" "/r/plans/x/PLAN.md.bak" 0
PATH="$tmp/nospec" CLAUDE_PROJECT_DIR="$tmp/proj" "$tmp/nospec/sh" "$hooks/specplane-generate.sh" >/dev/null 2>&1 <<EOJ
$(fj /r/PLAN.md)
EOJ
[ $? = 0 ] && report "generate: specplane absent exits 0" 1 || report "generate: specplane absent exits 0" 0

# handoff check, in a temp git repo
repo="$tmp/repo"; mkdir -p "$repo/.specplane" "$repo/plans/x"
printf 'plans:\n  dir: plans\n' > "$repo/.specplane/config.yaml"
(
  cd "$repo" && git init -q . && git config user.name t && git config user.email t@example.com \
  && git config commit.gpgsign false && echo a > a.txt && git add -A && git commit -q -m 'plan/x step 01: y'
) >/dev/null 2>&1
hc() { # name expected-substring(empty=silent) json [projdir]
  out=$(cd "$repo" && PATH="$ORIG_PATH" CLAUDE_PROJECT_DIR="${4:-$repo}" sh "$hooks/specplane-handoff-check.sh" 2>/dev/null <<EOJ
$3
EOJ
)
  rc=$?
  if [ "$rc" != 0 ]; then report "$1 (rc=$rc)" 0; return; fi
  if [ -z "$2" ]; then
    [ -z "$out" ] && report "$1" 1 || report "$1 (output: $out)" 0
  else
    [ "$out" = "$2" ] && report "$1" 1 || report "$1 (output: $out)" 0
  fi
}
hc "handoff: warns without HANDOFF.md" "Warning: step commit did not update plans/x/HANDOFF.md." "$(cj 'git commit -m x')"
hc "handoff: silent for non-commit" "" "$(cj 'git status')"
hc "handoff: silent without config" "" "$(cj 'git commit -m x')" "$tmp/noconf"
(
  cd "$repo" && echo h > plans/x/HANDOFF.md && git add -A && git commit -q -m 'plan/x step 02: z'
) >/dev/null 2>&1
hc "handoff: silent when HANDOFF.md included" "" "$(cj 'git commit -m x')"
(
  cd "$repo" && echo b > b.txt && git add -A && git commit -q -m 'ordinary change'
) >/dev/null 2>&1
hc "handoff: silent for non-step subject" "" "$(cj 'git commit -m x')"

echo "passed: $pass, failed: $fail"
[ "$fail" = 0 ]
