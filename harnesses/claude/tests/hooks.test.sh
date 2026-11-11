#!/bin/sh
# Tests for the Specplane Claude hook scripts (architecture/claude-integration §9). POSIX sh; no framework.
# A stub `specplane` is first on PATH; CLAUDE_PROJECT_DIR is a temporary project.
here=$(cd "$(dirname "$0")" && pwd)
hooks="$here/../templates/hooks"
command -v jq >/dev/null 2>&1 || { echo "jq is required"; exit 1; }
JQ=$(command -v jq)
tmp=$(mktemp -d) || exit 1
trap 'rm -rf "$tmp"' EXIT INT TERM
ORIG_PATH=$PATH

mkdir "$tmp/stubbin" "$tmp/proj" "$tmp/proj/.specplane" "$tmp/noconf" "$tmp/nospec" "$tmp/nojq"
: > "$tmp/proj/.specplane/config.yaml"
# stub specplane: exits with $STUB_EXIT, prints $STUB_OUT, records invocations in $STUB_LOG
cat > "$tmp/stubbin/specplane" <<'STUB'
#!/bin/sh
echo "$*" >> "${STUB_LOG:-/dev/null}"
[ -n "${STUB_OUT:-}" ] && echo "$STUB_OUT"
exit "${STUB_EXIT:-0}"
STUB
chmod +x "$tmp/stubbin/specplane"
# PATH without specplane, and PATH without jq
for t in jq grep sh cat printf sed head tail git dirname basename awk expr; do
  p=$(command -v "$t") || continue
  ln -s "$p" "$tmp/nospec/$t"
  [ "$t" = jq ] || ln -s "$p" "$tmp/nojq/$t"
done
ln -s "$tmp/stubbin/specplane" "$tmp/nojq/specplane"

pass=0; fail=0
report() { # name ok
  if [ "$2" = 1 ]; then pass=$((pass+1)); echo "ok   $1"; else fail=$((fail+1)); echo "FAIL $1"; fi
}
cj() { "$JQ" -n --arg c "$1" '{tool_input:{command:$c}}'; }

# run <hook> <expected-exit> <name> <json> [stub-exit]
run() {
  PATH="$tmp/stubbin:$ORIG_PATH" CLAUDE_PROJECT_DIR="$tmp/proj" STUB_EXIT="${5:-0}" sh "$hooks/$1" >/dev/null 2>&1 <<EOJ
$4
EOJ
  rc=$?
  if [ "$rc" = "$2" ]; then report "$3" 1; else report "$3 (got $rc, want $2)" 0; fi
}

# ---- CLI block ----
cb=specplane-cli-block.sh
run $cb 2 "cli-block: denies a direct call" "$(cj 'specplane validate')"
run $cb 2 "cli-block: denies an env prefix" "$(cj 'FOO=1 env -i specplane spec list')"
run $cb 2 "cli-block: denies npx" "$(cj 'npx specplane validate')"
run $cb 2 "cli-block: denies bunx with flags" "$(cj 'bunx --bun specplane validate')"
run $cb 2 "cli-block: denies sh -c" "$(cj "sh -c 'specplane validate'")"
run $cb 2 "cli-block: denies a path-qualified call" "$(cj '/usr/local/bin/specplane validate')"
run $cb 2 "cli-block: denies after && and in a subshell" "$(cj 'cd x && (specplane validate)')"
run $cb 2 "cli-block: denies a command substitution" "$(cj 'echo $(specplane validate)')"
run $cb 0 "cli-block: allows an unrelated command" "$(cj 'ls -la')"
run $cb 0 "cli-block: allows grep for the word" "$(cj 'grep -rn specplane docs')"
run $cb 0 "cli-block: allows echo of the word" "$(cj 'echo specplane')"
run $cb 0 "cli-block: allows node dist/cli.js (not the installed CLI name)" "$(cj 'node packages/cli/dist/cli.js validate')"
run $cb 0 "cli-block: allows backticked text in a single-quoted commit message" "$(cj "git commit -m 'route: serve \`specplane mcp\` over stdio'")"
run $cb 0 "cli-block: allows the word at a line start in a double-quoted message" "$(cj 'git commit -m "docs: update
specplane mcp notes; specplane validate output"')"
run $cb 0 "cli-block: allows a quoted heredoc body" "$(cj "git commit -F - <<'EOF'
docs: describe the route

\`specplane mcp\` is started by the adapter.
specplane validate
EOF")"
run $cb 0 "cli-block: allows a quoted heredoc with a dash and tabs" "$(cj "cat <<-'EOF' > notes.md
	specplane validate
	EOF")"
run $cb 0 "cli-block: allows a comment" "$(cj 'ls # specplane validate')"
run $cb 2 "cli-block: still denies after a quoted heredoc ends" "$(cj "cat <<'EOF'
text
EOF
specplane validate")"
run $cb 2 "cli-block: denies a command on the heredoc line" "$(cj "cat <<'EOF' | specplane validate
text
EOF")"
run $cb 2 "cli-block: denies a substitution inside double quotes" "$(cj 'echo "x $(specplane validate)"')"
run $cb 2 "cli-block: denies sh -c with a double-quoted argument" "$(cj 'sh -c "cd x; specplane validate"')"
run $cb 2 "cli-block: denies a substitution in an unquoted heredoc" "$(cj "cat <<EOF
\$(specplane validate)
EOF")"
PATH="$tmp/nojq" CLAUDE_PROJECT_DIR="$tmp/proj" "$tmp/nojq/sh" "$hooks/$cb" >/dev/null 2>&1 <<EOJ
$(cj 'specplane validate')
EOJ
[ $? = 0 ] && report "cli-block: exits 0 without jq" 1 || report "cli-block: exits 0 without jq" 0
PATH="$tmp/stubbin:$ORIG_PATH" CLAUDE_PROJECT_DIR="$tmp/noconf" sh "$hooks/$cb" >/dev/null 2>&1 <<EOJ
$(cj 'specplane validate')
EOJ
[ $? = 0 ] && report "cli-block: exits 0 without the config" 1 || report "cli-block: exits 0 without the config" 0
msg=$(PATH="$tmp/stubbin:$ORIG_PATH" CLAUDE_PROJECT_DIR="$tmp/proj" sh "$hooks/$cb" 2>&1 >/dev/null <<EOJ
$(cj 'specplane validate')
EOJ
)
case "$msg" in *"harness actions"*) report "cli-block: the message names the harness actions" 1 ;; *) report "cli-block: the message names the harness actions" 0 ;; esac

# ---- pre-commit ----
pc=specplane-pre-commit.sh
run $pc 2 "pre-commit: blocks git commit when validation fails" "$(cj 'git commit -m x')" 1
run $pc 2 "pre-commit: blocks git -C d commit" "$(cj 'git -C d commit -m x')" 1
run $pc 2 "pre-commit: blocks git -c k=v commit" "$(cj 'git -c user.name=a commit -m x')" 1
run $pc 2 "pre-commit: blocks cd x && git commit" "$(cj 'cd x && git commit -am x')" 1
run $pc 2 "pre-commit: blocks a subshell commit" "$(cj '(git commit -m x)')" 1
run $pc 0 "pre-commit: allows a commit when validation passes" "$(cj 'git commit -m x')" 0
run $pc 0 "pre-commit: allows git commit-tree" "$(cj 'git commit-tree abc')" 1
run $pc 0 "pre-commit: allows echo commit" "$(cj 'echo commit')" 1
run $pc 0 "pre-commit: allows other git commands" "$(cj 'git status')" 1
PATH="$tmp/nospec" CLAUDE_PROJECT_DIR="$tmp/proj" "$tmp/nospec/sh" "$hooks/$pc" >/dev/null 2>&1 <<EOJ
$(cj 'git commit -m x')
EOJ
[ $? = 0 ] && report "pre-commit: exits 0 when specplane is missing" 1 || report "pre-commit: exits 0 when specplane is missing" 0
PATH="$tmp/stubbin:$ORIG_PATH" CLAUDE_PROJECT_DIR="$tmp/noconf" STUB_EXIT=1 sh "$hooks/$pc" >/dev/null 2>&1 <<EOJ
$(cj 'git commit -m x')
EOJ
[ $? = 0 ] && report "pre-commit: exits 0 without the config" 1 || report "pre-commit: exits 0 without the config" 0

# ---- compaction ----
: > "$tmp/log"
PATH="$tmp/stubbin:$ORIG_PATH" CLAUDE_PROJECT_DIR="$tmp/proj" STUB_LOG="$tmp/log" sh "$hooks/specplane-compact.sh" >/dev/null 2>&1 <<EOJ
{"session_id":"sess-9","source":"compact"}
EOJ
[ $? = 0 ] && grep -Fxq 'harness compact sess-9' "$tmp/log" && report "compact: reports the epoch change for the session" 1 || report "compact: reports the epoch change for the session" 0
: > "$tmp/log"
PATH="$tmp/nospec" CLAUDE_PROJECT_DIR="$tmp/proj" "$tmp/nospec/sh" "$hooks/specplane-compact.sh" >/dev/null 2>&1 <<EOJ
{"session_id":"sess-9"}
EOJ
[ $? = 0 ] && report "compact: exits 0 when specplane is missing" 1 || report "compact: exits 0 when specplane is missing" 0
PATH="$tmp/stubbin:$ORIG_PATH" CLAUDE_PROJECT_DIR="$tmp/noconf" STUB_LOG="$tmp/log" sh "$hooks/specplane-compact.sh" >/dev/null 2>&1 <<EOJ
{"session_id":"sess-9"}
EOJ
[ $? = 0 ] && [ ! -s "$tmp/log" ] && report "compact: no-op without the config" 1 || report "compact: no-op without the config" 0

# ---- session context and status line ----
sc_repo="$tmp/screpo"; mkdir -p "$sc_repo/.specplane" "$sc_repo/plans/x/steps"
printf 'plans:\n  dir: plans\n' > "$sc_repo/.specplane/config.yaml"
printf -- '---\ntitle: First thing\n---\n' > "$sc_repo/plans/x/steps/01-a.md"
printf -- '---\ntitle: Second thing\n---\n' > "$sc_repo/plans/x/steps/02-b.md"
printf 'status: in-progress\nbranch: plan/x\ndone: [1]\n' > "$sc_repo/plans/x/progress.yaml"
(cd "$sc_repo" && git init -q . && git config user.name t && git config user.email t@example.com \
  && git config commit.gpgsign false && git add -A && git commit -q -m init && git checkout -q -b plan/x) >/dev/null 2>&1
sc() { # env-file json -> prints additionalContext
  (cd "$sc_repo" && PATH="$ORIG_PATH" CLAUDE_PROJECT_DIR="$sc_repo" CLAUDE_ENV_FILE="$1" sh "$hooks/specplane-session-context.sh" 2>/dev/null <<EOJ
$2
EOJ
) | "$JQ" -r '.hookSpecificOutput.additionalContext // empty'
}
out=$(sc "$tmp/env1" '{"session_id":"s1","model":"opus"}')
case "$out" in *"Steps done: 1/2"*"Next step: 02 Second thing."*"work on that step only"*) report "session: names step 02 and 1/2" 1 ;; *) report "session: names step 02 and 1/2 ($out)" 0 ;; esac
grep -Fxq 'export SPECPLANE_AGENT=claude-code/opus' "$tmp/env1" && grep -Fxq 'export SPECPLANE_SESSION=s1' "$tmp/env1" \
  && report "session: env exports with model" 1 || report "session: env exports with model" 0
sc "$tmp/env2" '{"session_id":"s2"}' >/dev/null
grep -Fxq 'export SPECPLANE_AGENT=claude-code' "$tmp/env2" && report "session: agent default claude-code" 1 || report "session: agent default claude-code" 0
printf 'status: stopped\nstop:\n  kind: soft\n  reason: waiting for request R7\ndone:\n  - 1\n' > "$sc_repo/plans/x/progress.yaml"
out=$(sc "$tmp/env6" '{"session_id":"s6"}')
case "$out" in *"Steps done: 1/2"*"stopped (waiting for request R7)"*) report "session: block-style done list and stop reason" 1 ;; *) report "session: block-style done list and stop reason ($out)" 0 ;; esac
printf 'status: in-progress\ndone: [1, 2]\n' > "$sc_repo/plans/x/progress.yaml"
out=$(sc "$tmp/env3" '{"session_id":"s3"}')
case "$out" in *"plan-finish"*) report "session: all done mentions plan-finish" 1 ;; *) report "session: all done mentions plan-finish" 0 ;; esac
sl() { printf '{"workspace":{"current_dir":"%s"}}' "$sc_repo" | PATH="$ORIG_PATH" CLAUDE_PROJECT_DIR="$sc_repo" sh "$hooks/specplane-statusline.sh" 2>/dev/null; }
printf 'status: in-progress\ndone: [1]\n' > "$sc_repo/plans/x/progress.yaml"
[ "$(sl)" = "◆ x · step 02/2 · in-progress" ] && report "statusline: plan checkout line" 1 || report "statusline: plan checkout line ($(sl))" 0
(cd "$sc_repo" && git checkout -q -b other) >/dev/null 2>&1
[ -z "$(sl)" ] && report "statusline: empty off plan branch" 1 || report "statusline: empty off plan branch" 0
out=$(sc "$tmp/env4" '{"session_id":"s4"}')
[ -z "$out" ] && report "session: silent off plan branch" 1 || report "session: silent off plan branch" 0
out=$(printf '{"session_id":"s"}' | PATH="$ORIG_PATH" CLAUDE_PROJECT_DIR="$tmp/noconf" CLAUDE_ENV_FILE="$tmp/env5" sh "$hooks/specplane-session-context.sh" 2>/dev/null)
[ -z "$out" ] && [ ! -f "$tmp/env5" ] && report "session: no-op without config" 1 || report "session: no-op without config" 0
out=$(printf '{}' | PATH="$tmp/nojq" CLAUDE_PROJECT_DIR="$sc_repo" "$tmp/nojq/sh" "$hooks/specplane-session-context.sh" 2>/dev/null)
[ -z "$out" ] && report "session: exits quietly without jq" 1 || report "session: exits quietly without jq" 0

echo "passed: $pass, failed: $fail"
[ "$fail" = 0 ]
