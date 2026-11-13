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
  (cd "$sc_repo" && PATH="$tmp/nospec" CLAUDE_PROJECT_DIR="$sc_repo" CLAUDE_ENV_FILE="$1" sh "$hooks/specplane-session-context.sh" 2>/dev/null <<EOJ
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

# essentials: delivered at session start (and after compaction, which runs this hook again) from `specplane docs essentials`
sce() { # json -> additionalContext, with a stub specplane that prints the essentials
  (cd "$sc_repo" && PATH="$tmp/stubbin:$tmp/nospec" STUB_OUT="ESSENTIALS TEXT" STUB_LOG="$tmp/log-ess" CLAUDE_PROJECT_DIR="$sc_repo" sh "$hooks/specplane-session-context.sh" 2>/dev/null <<EOJ
$1
EOJ
) | "$JQ" -r '.hookSpecificOutput.additionalContext // empty'
}
rm -f "$tmp/log-ess"
out=$(sce '{"session_id":"e1"}')
[ "$out" = "ESSENTIALS TEXT" ] && grep -Fxq 'docs essentials' "$tmp/log-ess" && report "session: essentials delivered off a plan branch" 1 || report "session: essentials delivered off a plan branch ($out)" 0
(cd "$sc_repo" && git checkout -q plan/x) >/dev/null 2>&1
out=$(sce '{"session_id":"e2"}')
case "$out" in "ESSENTIALS TEXT"*"Next step: 02 Second thing."*) report "session: essentials then plan context" 1 ;; *) report "session: essentials then plan context ($out)" 0 ;; esac
out=$(printf '{"session_id":"e3"}' | PATH="$tmp/stubbin:$tmp/nospec" STUB_OUT=x STUB_EXIT=1 CLAUDE_PROJECT_DIR="$tmp/noconf" sh "$hooks/specplane-session-context.sh" 2>/dev/null)
[ -z "$out" ] && report "session: no essentials without the config" 1 || report "session: no essentials without the config" 0

# ---- bypass guard (roles-and-permissions R58) ----
bg=specplane-bypass-guard.sh
# Exercise the actual core query, including CLI registration, without an installed CLI dependency.
guard_cli="$(cd "$here/../../.." && pwd)/packages/cli/dist/cli.js"
[ -f "$guard_cli" ] || { echo "Build packages/cli before running hook tests"; exit 1; }
mkdir "$tmp/guardbin"
cat > "$tmp/guardbin/specplane" <<'GUARD'
#!/bin/sh
printf '%s\n' "$*" >> "${GUARD_LOG:-/dev/null}"
exec node "$GUARD_CLI" "$@"
GUARD
chmod +x "$tmp/guardbin/specplane"
mkdir -p "$tmp/bp/.specplane" "$tmp/bpoff/.specplane" "$tmp/bpflow/.specplane"
: > "$tmp/bp/.specplane/config.yaml"
printf 'bypass_guards:\n  headless_block: off\n  marker_protect: false\n  store_protect: off\n  hook_protect: off\n' > "$tmp/bpoff/.specplane/config.yaml"
printf 'bypass_guards: {headless_block: off}\nother: 1\n' > "$tmp/bpflow/.specplane/config.yaml"
bj() { "$JQ" -n --arg c "$1" '{tool_name:"Bash",tool_input:{command:$c}}'; }
fj() { "$JQ" -n --arg t "$1" --arg f "$2" '{tool_name:$t,tool_input:{file_path:$f}}'; }
bgrun() { # project expected name json
  PATH="$tmp/guardbin:$ORIG_PATH" GUARD_CLI="$guard_cli" CLAUDE_PROJECT_DIR="$tmp/$1" sh "$hooks/$bg" >/dev/null 2>&1 <<EOJ
$4
EOJ
  rc=$?
  if [ "$rc" = "$2" ]; then report "$3" 1; else report "$3 (got $rc, want $2)" 0; fi
}
bgrun bp 2 "bypass: denies claude -p" "$(bj 'claude -p "hello"')"
bgrun bp 2 "bypass: denies claude --print with flags and a path" "$(bj 'FOO=1 /usr/bin/claude --model x --print hi')"
bgrun bp 2 "bypass: denies claude -p after &&" "$(bj 'cd x && claude -p hi')"
bgrun bp 2 "bypass: denies claude -p inside sh -c" "$(bj "sh -c 'claude -p hi'")"
bgrun bp 2 "bypass: denies npx claude -p" "$(bj 'npx claude -p hi')"
bgrun bp 2 "bypass: denies codex exec" "$(bj 'codex exec "do it"')"
bgrun bp 0 "bypass: allows an interactive claude" "$(bj 'claude --version')"
bgrun bp 0 "bypass: allows text that only mentions claude -p" "$(bj 'git commit -m "no claude -p here"')"
bgrun bp 0 "bypass: allows ordinary commands" "$(bj 'ls -la && npm test')"
bgrun bp 2 "bypass: denies unsetting the marker" "$(bj 'unset SPECPLANE_ACTOR; ls')"
bgrun bp 2 "bypass: denies overriding the marker" "$(bj 'SPECPLANE_ACTOR=human ls')"
bgrun bp 2 "bypass: denies env -i" "$(bj 'env -i PATH=/usr/bin ls')"
bgrun bp 2 "bypass: denies env -u of the marker" "$(bj 'env -u SPECPLANE_ACTOR ls')"
bgrun bp 0 "bypass: allows reading the marker" "$(bj 'echo $SPECPLANE_ACTOR')"
bgrun bp 2 "bypass: denies a shell write to role.json" "$(bj 'echo {} > .git/specplane/role.json')"
bgrun bp 2 "bypass: denies a path to os-users.json" "$(bj 'rm /repo/.git/specplane/os-users.json')"
bgrun bp 2 "bypass: denies git notes add on the specplane ref" "$(bj 'git notes --ref specplane add -m x HEAD')"
bgrun bp 2 "bypass: denies update-ref on the notes ref" "$(bj 'git update-ref refs/notes/specplane HEAD')"
bgrun bp 0 "bypass: allows git notes show on the specplane ref" "$(bj 'git notes --ref specplane show HEAD')"
bgrun bp 0 "bypass: allows git notes on another ref" "$(bj 'git notes add -m x HEAD')"
bgrun bp 2 "bypass: denies a shell write to a Specplane hook" "$(bj 'cp x .claude/hooks/specplane-cli-block.sh')"
bgrun bp 2 "bypass: denies a shell write to the Claude settings" "$(bj "sed -i 's/a/b/' .claude/settings.json")"
bgrun bp 2 "bypass: denies Write to role.json" "$(fj Write /repo/.git/specplane/role.json)"
bgrun bp 2 "bypass: denies Edit of trusted-rules.json" "$(fj Edit /repo/.git/specplane/trusted-rules.json)"
bgrun bp 2 "bypass: denies Write to a Specplane hook" "$(fj Write /repo/.claude/hooks/specplane-bypass-guard.sh)"
bgrun bp 2 "bypass: denies MultiEdit of the Claude settings" "$(fj MultiEdit /repo/.claude/settings.json)"
bgrun bp 0 "bypass: allows Write to a spec" "$(fj Write /repo/docs/specifications/features/x.md)"
bgrun bp 0 "bypass: allows a tool it does not know" "$(fj Read /repo/.git/specplane/role.json)"
bgrun bpoff 0 "bypass: headless_block off allows claude -p" "$(bj 'claude -p hi')"
bgrun bpoff 0 "bypass: marker_protect off allows env -i" "$(bj 'env -i ls')"
bgrun bpoff 0 "bypass: store_protect off allows a store path" "$(bj 'cat .git/specplane/role.json')"
bgrun bpoff 0 "bypass: hook_protect off allows a hook write" "$(fj Write /repo/.claude/hooks/specplane-cli-block.sh)"
bgrun bpflow 0 "bypass: flow-style off allows claude -p" "$(bj 'claude -p hi')"
bgrun bpflow 2 "bypass: flow-style leaves the other measures on" "$(bj 'unset SPECPLANE_ACTOR')"
bgrun noconf 0 "bypass: no-op without the config" "$(bj 'claude -p hi')"
out=$(printf '%s' "$(bj 'claude -p hi')" | PATH="$tmp/nojq" CLAUDE_PROJECT_DIR="$tmp/bp" "$tmp/nojq/sh" "$hooks/$bg" 2>/dev/null); rc=$?
[ "$rc" = 2 ] && report "bypass: fails closed without jq" 1 || report "bypass: fails closed without jq" 0

# ---- strict mode (roles-and-permissions R55.1) ----
mkdir -p "$tmp/st/.specplane" "$tmp/stoff/.specplane" "$tmp/stpart/.specplane" "$tmp/stpath/.specplane" "$tmp/stflow/.specplane"
printf 'strict_mode:\n  enabled: on\n' > "$tmp/st/.specplane/config.yaml"
printf 'strict_mode:\n  enabled: off\n' > "$tmp/stoff/.specplane/config.yaml"
printf 'strict_mode:\n  enabled: on\n  edit_block: off\n  git_commit_guard: false\n  os_permissions: off\n' > "$tmp/stpart/.specplane/config.yaml"
printf 'paths:\n  features: "specs/f"  # mine\nsubprojects:\n  - {name: sub, path: lib/sub}\nstrict_mode:\n  enabled: on\n' > "$tmp/stpath/.specplane/config.yaml"
printf 'strict_mode: {enabled: on, edit_block: off}\n' > "$tmp/stflow/.specplane/config.yaml"
bgrun st 2 "strict: denies Write to a feature spec" "$(fj Write "$tmp/st/docs/specifications/features/x.md")"
bgrun st 2 "strict: denies Edit of a requirements file (relative path)" "$(fj Edit docs/requirements/product-requirements.md)"
bgrun st 2 "strict: denies MultiEdit of an architecture spec" "$(fj MultiEdit "$tmp/st/docs/specifications/architecture/a.md")"
bgrun st 2 "strict: denies Write to a decision record" "$(fj Write "$tmp/st/.specplane/decisions/D1.md")"
bgrun st 2 "strict: denies Write to a role file" "$(fj Write .specplane/roles/roles/r.yaml)"
bgrun st 0 "strict: allows Write to source code" "$(fj Write "$tmp/st/src/index.ts")"
bgrun st 0 "strict: allows Write to a plan file" "$(fj Write "$tmp/st/plans/p/plan.md")"
bgrun st 2 "strict: denies a redirect into a spec" "$(bj 'echo x > docs/specifications/features/a.md')"
bgrun st 2 "strict: denies an appending redirect with a quoted path" "$(bj 'cat y >> "docs/requirements/r.md"')"
bgrun st 2 "strict: denies sed -i on a spec" "$(bj "sed -i 's/a/b/' docs/specifications/architecture/a.md")"
bgrun st 2 "strict: denies tee to a spec" "$(bj 'echo x | tee docs/specifications/features/a.md')"
bgrun st 2 "strict: denies rm of a spec" "$(bj 'rm docs/specifications/features/a.md')"
bgrun st 2 "strict: denies mv into a spec folder" "$(bj 'mv /tmp/a.md docs/specifications/features/a.md')"
bgrun st 2 "strict: denies cp onto a spec" "$(bj 'cp /tmp/a.md docs/specifications/features/a.md')"
bgrun st 2 "strict: denies git checkout of a spec" "$(bj 'git checkout HEAD~1 -- docs/specifications/features/a.md')"
bgrun st 0 "strict: allows reading a spec" "$(bj 'cat docs/specifications/features/a.md | head')"
bgrun st 0 "strict: allows copying a spec out" "$(bj 'cp docs/specifications/features/a.md /tmp/a.md')"
bgrun st 0 "strict: allows grep over specs" "$(bj 'grep -rn R1 docs/specifications > /tmp/out')"
bgrun st 0 "strict: allows a commit message that mentions a spec" "$(bj 'git commit -m "a -> b in docs/specifications/features/a.md"')"
bgrun st 2 "strict: denies git commit --no-verify" "$(bj 'git commit --no-verify -m x')"
bgrun st 2 "strict: denies git commit -n" "$(bj 'git commit -n -m x')"
bgrun st 2 "strict: denies git commit -nm" "$(bj 'git commit -nm x')"
bgrun st 0 "strict: allows an ordinary git commit" "$(bj 'git commit -m "no --no-verify here"')"
bgrun st 0 "strict: allows git commit --amend" "$(bj 'git commit --amend --no-edit')"
bgrun st 2 "strict: denies setting core.hooksPath" "$(bj 'git config core.hooksPath /tmp/h')"
bgrun st 2 "strict: denies a shell write to the git hooks" "$(bj 'rm .git/hooks/pre-commit')"
bgrun st 2 "strict: denies Write to the git hooks" "$(fj Write "$tmp/st/.git/hooks/pre-commit")"
bgrun st 2 "strict: denies chmod of a hook" "$(bj 'chmod u+w .claude/hooks/specplane-cli-block.sh')"
bgrun st 2 "strict: denies chmod of the Claude settings" "$(bj 'chmod 644 .claude/settings.json')"
bgrun st 2 "strict: denies chattr on the store" "$(bj 'chattr -i .git/specplane/role.json')"
bgrun st 0 "strict: allows chmod of other files" "$(bj 'chmod +x scripts/run.sh')"
bgrun stoff 0 "strict: off allows a spec write" "$(fj Write docs/specifications/features/x.md)"
bgrun stoff 0 "strict: off allows git commit --no-verify" "$(bj 'git commit --no-verify -m x')"
bgrun bp 0 "strict: absent allows a spec write" "$(fj Write docs/specifications/features/x.md)"
bgrun stpart 0 "strict: edit_block off allows a spec write" "$(fj Write docs/specifications/features/x.md)"
bgrun stpart 0 "strict: git_commit_guard off allows --no-verify" "$(bj 'git commit --no-verify -m x')"
bgrun stpart 0 "strict: os_permissions off allows chmod of the pre-commit hook" "$(bj 'chmod 600 .git/hooks/pre-commit')"
bgrun st 2 "strict: denies chmod of the pre-commit hook" "$(bj 'chmod 666 .git/hooks/pre-commit')"
bgrun stpath 2 "strict: a configured features folder is blocked" "$(fj Write specs/f/a.md)"
bgrun stpath 0 "strict: the default features folder is free when moved" "$(fj Write docs/specifications/features/a.md)"
bgrun stpath 2 "strict: a subproject folder is blocked" "$(fj Write lib/sub/requirements/r.md)"
bgrun stflow 0 "strict: flow style edit_block off allows a spec write" "$(fj Write docs/specifications/features/x.md)"
bgrun stflow 2 "strict: flow style leaves the other measures on" "$(bj 'git commit --no-verify -m x')"

# YAML forms are resolved by the same core parser as other settings.
mkdir -p "$tmp/styaml/.specplane" "$tmp/stquoted/.specplane" "$tmp/stbad/.specplane"
cat > "$tmp/styaml/.specplane/config.yaml" <<'YAML'
"paths": {"requirements": "specs/req", features: specs/features, architecture: 'specs/arch'} # custom folders
subprojects: [{name: child, path: "modules/child specs"}]
"strict_mode": {"enabled": "on"} # quoted keys and values
YAML
for entry in 'specs/req/r.md' 'specs/features/f.md' 'specs/arch/a.md' 'modules/child specs/requirements/r.md' 'modules/child specs/features/f.md' 'modules/child specs/architecture/a.md'; do
  bgrun styaml 2 "strict: flow configuration protects $entry" "$(fj Write "$tmp/styaml/$entry")"
done
bgrun styaml 0 "strict: flow configuration frees the old default folder" "$(fj Write docs/specifications/features/f.md)"
bgrun styaml 2 "strict: flow configuration blocks shell writes" "$(bj 'echo x > specs/features/f.md')"
cat > "$tmp/stquoted/.specplane/config.yaml" <<'YAML'
paths:
  requirements: "specs/req # records" # the hash is part of the path
  features: 'specs/team''s features' # YAML escaped apostrophe
  architecture: "specs/quoted \"arch\"" # YAML escaped quotes
subprojects:
  - name: child
    path: 'modules/child # one'
strict_mode:
  enabled: "on" # quoted switch
  git_commit_guard: 'off'
bypass_guards: {headless_block: "off", marker_protect: 'off', store_protect: "off", hook_protect: 'off'}
YAML
for entry in 'specs/req # records/r.md' "specs/team's features/f.md" 'specs/quoted "arch"/a.md' 'modules/child # one/features/f.md'; do
  bgrun stquoted 2 "strict: quoted configuration protects $entry" "$(fj Edit "$entry")"
done
bgrun stquoted 2 "strict: quoted path blocks a shell redirect" "$(bj 'echo x > "specs/req # records/r.md"')"
bgrun stquoted 0 "strict: quoted off disables git guard" "$(bj 'git commit --no-verify -m x')"
bgrun stquoted 0 "bypass: quoted off disables headless guard" "$(bj 'claude -p hi')"
bgrun stquoted 0 "bypass: quoted off disables marker guard" "$(bj 'unset SPECPLANE_ACTOR')"
bgrun stquoted 0 "bypass: quoted off disables store guard" "$(fj Edit .git/specplane/role.json)"
bgrun stquoted 0 "bypass: quoted off disables hook guard" "$(fj Write .claude/settings.json)"
printf 'strict_mode: {enabled: on}\npaths: {features: [broken}\n' > "$tmp/stbad/.specplane/config.yaml"
bgrun stbad 2 "strict: malformed YAML fails closed for file writes" "$(fj Write specs/features/f.md)"
bgrun stbad 2 "strict: malformed YAML fails closed for shell calls" "$(bj 'echo x > specs/features/f.md')"
bgrun stbad 0 "strict: failed config still allows Read tools" "$(fj Read specs/features/f.md)"
for mode in missing failed malformed empty; do
  guard_path="$tmp/stubbin:$ORIG_PATH"; guard_exit=0; guard_out='{}'
  case "$mode" in
    missing) guard_path="$tmp/nospec" ;;
    failed) guard_exit=1 ;;
    malformed) guard_out='not json' ;;
    empty) guard_out='' ;;
  esac
  for payload in "$(fj Write specs/features/f.md)" "$(bj 'echo x > specs/features/f.md')"; do
    printf '%s' "$payload" | PATH="$guard_path" STUB_EXIT="$guard_exit" STUB_OUT="$guard_out" CLAUDE_PROJECT_DIR="$tmp/styaml" sh "$hooks/$bg" >/dev/null 2>&1
    rc=$?
    [ "$rc" = 2 ] && report "strict: $mode core query fails closed" 1 || report "strict: $mode core query fails closed (got $rc)" 0
  done
done
printf '%s' "$(fj Write specs/features/f.md)" | PATH="$tmp/guardbin:$ORIG_PATH" GUARD_CLI="$guard_cli" GUARD_LOG="$tmp/guard-log" CLAUDE_PROJECT_DIR="$tmp/styaml" sh "$hooks/$bg" >/dev/null 2>&1
[ "$(wc -l < "$tmp/guard-log" | tr -d ' ')" = 1 ] && report "strict: core settings queried once per hook invocation" 1 || report "strict: core settings queried once per hook invocation" 0

# marker export (session start)
printf 'plans:\n  dir: plans\n' > "$tmp/bp/.specplane/config.yaml"
mx() { # env-file config-text
  printf '%s' "$2" > "$tmp/bp/.specplane/config.yaml"
  printf '{"session_id":"m1","model":"opus"}' | PATH="$tmp/nospec" CLAUDE_PROJECT_DIR="$tmp/bp" CLAUDE_ENV_FILE="$1" sh "$hooks/specplane-session-context.sh" >/dev/null 2>&1
}
mx "$tmp/envm1" 'plans:
  dir: plans
'
grep -Fxq 'export SPECPLANE_ACTOR=llm' "$tmp/envm1" && grep -Fxq 'export SPECPLANE_PROVIDER=anthropic' "$tmp/envm1" && grep -Fxq 'export SPECPLANE_MODEL=opus' "$tmp/envm1" \
  && report "marker: session start exports the LLM marker and identity" 1 || report "marker: session start exports the LLM marker and identity" 0
mx "$tmp/envm2" 'bypass_guards:
  marker_export: off
'
grep -q SPECPLANE_ACTOR "$tmp/envm2" && report "marker: marker_export off exports no marker" 0 || report "marker: marker_export off exports no marker" 1
grep -Fxq 'export SPECPLANE_AGENT=claude-code/opus' "$tmp/envm2" && report "marker: identity export is kept when the marker is off" 1 || report "marker: identity export is kept when the marker is off" 0

echo "passed: $pass, failed: $fail"
[ "$fail" = 0 ]
