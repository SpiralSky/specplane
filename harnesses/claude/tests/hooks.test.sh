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
run_case "block: (git commit)" 2 "$(cj '(git commit)')" 1
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
  && git config commit.gpgsign false && echo a > a.txt && git add -A && git commit -q -m 'feat(x): y' -m 'Specplane-Workflow: step
Specplane-Plan: x'
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
  cd "$repo" && echo h > plans/x/HANDOFF.md && git add -A && git commit -q -m 'feat(x): z' -m 'Specplane-Workflow: step
Specplane-Plan: x'
) >/dev/null 2>&1
hc "handoff: silent when HANDOFF.md included" "" "$(cj 'git commit -m x')"
(
  cd "$repo" && echo b > b.txt && git add -A && git commit -q -m 'ordinary change'
) >/dev/null 2>&1
hc "handoff: silent for non-step commit" "" "$(cj 'git commit -m x')"


# ---- policy guard ----
# PATH lacking jq
mkdir -p "$tmp/nojq"
for t in sh cat printf sed head awk grep cut git dirname; do
  p=$(command -v "$t") && ln -s "$p" "$tmp/nojq/$t"
done
pg_proj() { # dir role-line(empty = key absent)
  mkdir -p "$1/.specplane"
  { printf 'specs:\n  feature:\n    authorship: user\n'
    [ -n "$2" ] && printf '    llm_role: %s   # comment\n' "$2"
    printf '  architecture:\n    authorship: either\n'
    [ -n "$3" ] && printf '    llm_role: %s\n' "$3"
    printf 'plans:\n  dir: plans\n'; } > "$1/.specplane/config.yaml"
}
pgj() { # tool file content
  if [ -n "$3" ]; then "$JQ" -n --arg t "$1" --arg f "$2" --arg c "$3" '{tool_name:$t,tool_input:{file_path:$f,content:$c}}'
  else "$JQ" -n --arg t "$1" --arg f "$2" '{tool_name:$t,tool_input:{file_path:$f}}'; fi
}
# pg <name> <proj> <json> <expected: deny|ask|none>
pg() {
  out=$(PATH="$ORIG_PATH" CLAUDE_PROJECT_DIR="$2" sh "$hooks/specplane-policy-guard.sh" 2>/dev/null <<EOJ
$3
EOJ
)
  rc=$?
  dec=$(printf '%s' "$out" | "$JQ" -r '.hookSpecificOutput.permissionDecision // empty' 2>/dev/null)
  [ -z "$out" ] && dec=none
  if [ "$rc" = 0 ] && [ "$dec" = "$4" ]; then report "$1" 1; else report "$1 (rc=$rc got=$dec want=$4)" 0; fi
}
for role in none assist draft absent; do
  case $role in
    none) fp=none; ap=none; ef=deny; ea=deny ;;
    assist) fp=assist; ap=assist; ef=ask; ea=ask ;;
    draft) fp=draft; ap=draft; ef=none; ea=none ;;
    absent) fp=; ap=; ef=ask; ea=none ;;
  esac
  d="$tmp/pg-$role"; pg_proj "$d" "$fp" "$ap"; mkdir -p "$d/specs"
  printf -- '---\nid: feature/x\n---\nbody\n' > "$d/specs/f1.md"
  printf -- '---\nid: claude:feature/x\n---\nbody\n' > "$d/specs/f2.md"
  printf -- '---\nid: architecture/x\n---\nbody\n' > "$d/specs/a1.md"
  pg "guard[$role]: Write content feature/x" "$d" "$(pgj Write specs/new.md "$(printf -- '---\nid: feature/x\n---\nb')")" $ef
  pg "guard[$role]: Write content architecture/x" "$d" "$(pgj Write specs/new.md "$(printf -- '---\nid: architecture/x\n---\nb')")" $ea
  pg "guard[$role]: Edit file feature/x" "$d" "$(pgj Edit specs/f1.md '')" $ef
  pg "guard[$role]: Edit file claude:feature/x" "$d" "$(pgj Edit "$d/specs/f2.md" '')" $ef
  pg "guard[$role]: Edit file architecture/x" "$d" "$(pgj Edit specs/a1.md '')" $ea
done
d="$tmp/pg-assist"
printf -- '---\nid: plan/x\n---\n' > "$d/plan.md"
printf -- '---\nid: decision/0001\n---\n' > "$d/adr.md"
printf 'no frontmatter\n' > "$d/plain.md"
pg "guard: plan file ignored" "$d" "$(pgj Edit plan.md '')" none
pg "guard: ADR ignored" "$d" "$(pgj Edit adr.md '')" none
pg "guard: no frontmatter ignored" "$d" "$(pgj Edit plain.md '')" none
pg "guard: missing file ignored" "$d" "$(pgj Edit nope.md '')" none
pg "guard: non-edit tool ignored" "$d" "$(pgj Bash specs/f1.md '')" none
pg "guard: missing config" "$tmp/noconf" "$(pgj Edit specs/f1.md '')" none
out=$(PATH="$tmp/nojq" CLAUDE_PROJECT_DIR="$tmp/pg-none" "$tmp/nojq/sh" "$hooks/specplane-policy-guard.sh" 2>/dev/null <<EOJ
{"tool_name":"Edit","tool_input":{"file_path":"specs/f1.md"}}
EOJ
)
[ $? = 0 ] && [ -z "$out" ] && report "guard: missing jq" 1 || report "guard: missing jq" 0
out=$(PATH="$ORIG_PATH" CLAUDE_PROJECT_DIR="$tmp/pg-none" sh "$hooks/specplane-policy-guard.sh" 2>/dev/null <<EOJ
$(pgj Edit specs/f1.md '')
EOJ
)
case "$out" in *"Policy (specs.feature.llm_role: none) forbids editing feature specs. Tell the user instead."*) report "guard: deny reason text" 1 ;; *) report "guard: deny reason text" 0 ;; esac

# ---- session context and status line ----
sc_repo="$tmp/screpo"; mkdir -p "$sc_repo/.specplane" "$sc_repo/plans/x/steps"
printf 'plans:\n  dir: plans\n' > "$sc_repo/.specplane/config.yaml"
printf -- '---\nplan: x\nstep: 1\ntitle: First thing\nstatus: done\n---\n' > "$sc_repo/plans/x/steps/01-a.md"
printf -- '---\nplan: x\nstep: 2\ntitle: Second thing\nstatus: pending\n---\n' > "$sc_repo/plans/x/steps/02-b.md"
(cd "$sc_repo" && git init -q . && git config user.name t && git config user.email t@example.com \
  && git config commit.gpgsign false && git add -A && git commit -q -m init && git checkout -q -b plan/x) >/dev/null 2>&1
sc() { # extra-env-file json -> prints additionalContext
  (cd "$sc_repo" && PATH="$ORIG_PATH" CLAUDE_PROJECT_DIR="$sc_repo" CLAUDE_ENV_FILE="$1" sh "$hooks/specplane-session-context.sh" 2>/dev/null <<EOJ
$2
EOJ
) | "$JQ" -r '.hookSpecificOutput.additionalContext // empty'
}
out=$(sc "$tmp/env1" '{"session_id":"s1","model":"opus"}')
case "$out" in *"Steps done: 1/2"*"Next step: 02 Second thing (pending)"*) report "session: names step 02 and 1/2" 1 ;; *) report "session: names step 02 and 1/2 ($out)" 0 ;; esac
grep -Fxq 'export SPECPLANE_AGENT=claude-code/opus' "$tmp/env1" && grep -Fxq 'export SPECPLANE_SESSION=s1' "$tmp/env1" \
  && report "session: env exports with model" 1 || report "session: env exports with model" 0
out=$(sc "$tmp/env2" '{"session_id":"s2"}')
grep -Fxq 'export SPECPLANE_AGENT=claude-code' "$tmp/env2" && report "session: agent default claude-code" 1 || report "session: agent default claude-code" 0
sed -i 's/^status: pending/status: done/' "$sc_repo/plans/x/steps/02-b.md"
out=$(sc "$tmp/env3" '{"session_id":"s3"}')
case "$out" in *"/plan-finish"*) report "session: all done mentions /plan-finish" 1 ;; *) report "session: all done mentions /plan-finish" 0 ;; esac
sl() { printf '{"workspace":{"current_dir":"%s"}}' "$sc_repo" | PATH="$ORIG_PATH" CLAUDE_PROJECT_DIR="$sc_repo" sh "$hooks/specplane-statusline.sh" 2>/dev/null; }
sed -i 's/^status: done/status: pending/' "$sc_repo/plans/x/steps/02-b.md"
[ "$(sl)" = "◆ x · step 02/2 Second thing · pending" ] && report "statusline: plan checkout line" 1 || report "statusline: plan checkout line ($(sl))" 0
sed -i 's/^status: pending/status: blocked/' "$sc_repo/plans/x/steps/02-b.md"
[ "$(sl)" = "◆ x · step 02/2 Second thing · blocked ⚠ blocked" ] && report "statusline: blocked marker" 1 || report "statusline: blocked marker ($(sl))" 0
(cd "$sc_repo" && git checkout -q -b other) >/dev/null 2>&1
[ -z "$(sl)" ] && report "statusline: empty off plan branch" 1 || report "statusline: empty off plan branch" 0
out=$(sc "$tmp/env4" '{"session_id":"s4"}')
[ -z "$out" ] && report "session: silent off plan branch" 1 || report "session: silent off plan branch" 0
out=$(printf '{"session_id":"s"}' | PATH="$ORIG_PATH" CLAUDE_PROJECT_DIR="$tmp/noconf" CLAUDE_ENV_FILE="$tmp/env5" sh "$hooks/specplane-session-context.sh" 2>/dev/null)
[ -z "$out" ] && [ ! -f "$tmp/env5" ] && report "session: no-op without config" 1 || report "session: no-op without config" 0

echo "passed: $pass, failed: $fail"
[ "$fail" = 0 ]
