#!/bin/sh
# PreToolUse hook (matchers: Bash, Write, Edit, MultiEdit, NotebookEdit): guardrails against permission bypass
# (roles-and-permissions R58, architecture/claude-integration §4, reference-cli §7.8). Five measures, each on unless
# `bypass_guards.<measure>: off` in .specplane/config.yaml:
#   headless_block  denies a command that starts a headless LLM session (claude -p, claude --print, codex exec)
#   marker_protect  denies a command that clears or overrides the LLM marker (SPECPLANE_ACTOR) or the environment
#   store_protect   denies direct writes to the local store (role.json, os-users.json, trusted-rules.json) and the
#                   approvals notes ref, by shell or by a file tool
#   hook_protect    denies direct writes to the installed hooks and .claude settings, by shell or by a file tool
# Strict mode (R55.1, `strict_mode.enabled: on` in .specplane/config.yaml, off by default; each measure on unless
# `strict_mode.<measure>: off`) adds three, handled here too:
#   edit_block        denies file-tool and shell writes to the specification folders (paths.requirements, paths.features,
#                     paths.architecture, subprojects), .specplane/decisions and .specplane/roles
#   git_commit_guard  denies git commit --no-verify, core.hooksPath and writes to .git/hooks (the pre-commit check itself
#                     is installed by Specplane)
#   os_permissions    denies chmod, chown, chgrp, chattr and setfacl on the hooks, the Claude settings, .git/hooks and the store
# (llm_marker is the core's; marker_export is the session-start hook's.) Best effort, like the CLI block: text that is
# not run is ignored with the same pass as specplane-cli-block.sh. Exits 0 whenever it cannot do its job.
conf="${CLAUDE_PROJECT_DIR:-.}/.specplane/config.yaml"
[ -f "$conf" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0
input=$(cat) || exit 0
tool=$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null) || exit 0

# on <measure>: true unless the configuration states the measure as off, false or no (block or flow form).
on() {
  v=$(sed -n '/^bypass_guards:/,/^[^[:space:]#]/p' "$conf" 2>/dev/null | grep -E "(^|[[:space:]{,])$1:" | head -n 1 | sed "s/.*$1:[[:space:]]*//; s/[^A-Za-z].*//")
  case "$v" in off|Off|OFF|false|False|FALSE|no|No|NO) return 1 ;; esac
  return 0
}
deny() { printf '%s\n' "$1" >&2; exit 2; }
STORE_MSG="Specplane's local store and approvals are not for direct edits. Use the Specplane harness actions, or ask the user (bypass_guards.store_protect)."
HOOK_MSG="Specplane's installed hooks and the Claude settings are not for direct edits by an LLM. Ask the user (bypass_guards.hook_protect)."

# strict <measure>: true when strict mode is on and the measure is not stated as off (block or flow form).
sval() { sed -n '/^strict_mode:/,/^[^[:space:]#]/p' "$conf" 2>/dev/null | grep -E "(^|[[:space:]{,])$1:" | head -n 1 | sed "s/.*$1:[[:space:]]*//; s/[^A-Za-z].*//"; }
strict() {
  case "$(sval enabled)" in on|On|ON|true|True|TRUE|yes|Yes) ;; *) return 1 ;; esac
  case "$(sval "$1")" in off|Off|OFF|false|False|FALSE|no|No) return 1 ;; esac
  return 0
}
# The specification folders, one per line: configured paths (default when unset) and the subproject folders.
cfgpath() {
  v=$(sed -n '/^paths:/,/^[^[:space:]#]/p' "$conf" 2>/dev/null | grep -E "^[[:space:]]+$1:" | head -n 1 | sed "s/^[^:]*:[[:space:]]*//; s/[[:space:]]*#.*//; s/[\"']//g; s/[[:space:]]*\$//; s#/\$##")
  printf '%s\n' "${v:-$2}"
}
specdirs() {
  cfgpath requirements docs/requirements
  cfgpath features docs/specifications/features
  cfgpath architecture docs/specifications/architecture
  printf '%s\n' .specplane/decisions .specplane/roles
  sed -n '/^subprojects:/,/^[^[:space:]#-]/p' "$conf" 2>/dev/null | grep -E 'path:' | sed "s/.*path:[[:space:]]*//; s/[\"'}, ].*//" | while IFS= read -r sp; do
    [ -n "$sp" ] && printf '%s\n' "$sp/requirements" "$sp/features" "$sp/architecture"
  done
}
EDIT_MSG="Specifications, decision records and roles are changed through Specplane actions, not by editing their files directly. Use the harness actions, or ask the user (strict_mode.edit_block)."
GIT_MSG="Strict mode keeps the commit check and the git hooks in force: do not skip or edit them. Ask the user (strict_mode.git_commit_guard)."
OS_MSG="Strict mode keeps Specplane's hooks, settings and store read-only: do not change their permissions. Ask the user (strict_mode.os_permissions)."

# Files named by a file tool.
case "$tool" in
  Write|Edit|MultiEdit|NotebookEdit)
    file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' 2>/dev/null) || exit 0
    [ -n "$file" ] || exit 0
    if on store_protect && printf '%s\n' "$file" | grep -Eq '(^|/)\.git/(specplane/|refs/notes/)|(^|/)specplane/(role|os-users|trusted-rules)\.json$'; then deny "$STORE_MSG"; fi
    if on hook_protect && printf '%s\n' "$file" | grep -Eq '(^|/)\.claude/(hooks/specplane-[^/]*|settings(\.local)?\.json)$'; then deny "$HOOK_MSG"; fi
    if strict git_commit_guard && printf '%s\n' "$file" | grep -Eq '(^|/)\.git/hooks/'; then deny "$GIT_MSG"; fi
    if strict edit_block; then
      rel=${file#"${CLAUDE_PROJECT_DIR:-$PWD}"/}; rel=${rel#./}
      for d in $(specdirs); do
        case "$rel" in "$d"/*) deny "$EDIT_MSG" ;; esac
      done
    fi
    exit 0 ;;
  Bash) ;;
  *) exit 0 ;;
esac

cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null) || exit 0
[ -n "$cmd" ] || exit 0
command -v awk >/dev/null 2>&1 || exit 0
text=$(printf '%s\n' "$cmd" | awk '
BEGIN { q = sprintf("%c", 39); skip = 0; out = "" }
{
  if (skip) {
    t = $0
    if (dash) sub(/^\t+/, "", t)
    if (t == tag) skip = 0
    next
  }
  out = out $0 "\n"
  if (match($0, "<<-?[ \t]*(" q "[A-Za-z_0-9]+" q "|\"[A-Za-z_0-9]+\")")) {
    h = substr($0, RSTART, RLENGTH)
    dash = (h ~ /^<<-/)
    sub(/^<<-?[ \t]*/, "", h); gsub(q, "", h); gsub(/"/, "", h)
    tag = h; skip = 1
  }
}
END {
  n = length(out); res = ""; i = 1; state = ""; keep = 0
  while (i <= n) {
    c = substr(out, i, 1)
    if (state == "s") {
      if (c == q) { state = ""; res = res c } else res = res (keep ? c : " ")
      i++; continue
    }
    if (state == "d") {
      if (c == "\\") { res = res (keep ? substr(out, i, 2) : "  "); i += 2; continue }
      if (c == "\"") { state = ""; res = res c; i++; continue }
      if (!keep && c == "$" && substr(out, i + 1, 1) == "(") {
        depth = 0; j = i + 1
        while (j <= n) { d = substr(out, j, 1); if (d == "(") depth++; else if (d == ")" && --depth == 0) break; j++ }
        res = res substr(out, i, j - i + 1); i = j + 1; continue
      }
      if (!keep && c == "`") {
        j = i + 1
        while (j <= n && substr(out, j, 1) != "`") j++
        res = res substr(out, i, j - i + 1); i = j + 1; continue
      }
      res = res (keep ? c : (c == "\n" ? "\n" : " ")); i++; continue
    }
    if (c == "\\") { res = res substr(out, i, 2); i += 2; continue }
    if (c == q || c == "\"") {
      keep = (substr(res, length(res) > 40 ? length(res) - 40 : 1) ~ /[ \t]-[A-Za-z]*c[ \t]+$/)
      state = (c == q ? "s" : "d"); res = res c; i++; continue
    }
    if (c == "#" && (res == "" || substr(res, length(res), 1) ~ /[ \t\n;&|(]/)) {
      while (i <= n && substr(out, i, 1) != "\n") i++
      continue
    }
    res = res c; i++
  }
  printf "%s", res
}') || exit 0
q="[\"']"
head="(^|[;&|(\`{]|\\\$\\(|[[:space:]]-[A-Za-z]*c[[:space:]]+$q)[[:space:]]*"
prefix="(([A-Za-z_][A-Za-z_0-9]*=[^[:space:]]*|([^[:space:]]*/)?env|command|exec|sudo|doas|nohup|time|xargs|-[^[:space:]]+)[[:space:]]+)*"
runner="((npx|bunx|pnpx|npm[[:space:]]+exec|pnpm[[:space:]]+(dlx|exec)|yarn[[:space:]]+dlx|bun[[:space:]]+x)([[:space:]]+-[^[:space:]]+)*[[:space:]]+)?"
path="([^[:space:];&|()\"'\`]*/)?"
rest="([[:space:]]+[^;&|]*)?"
end="([[:space:];&|)\"'\`]|\$)"

if on headless_block; then
  if printf '%s\n' "$text" | grep -Eq "${head}${prefix}${runner}${path}claude${rest}[[:space:]](-[A-Za-z]*p[A-Za-z]*|--print)${end}" \
    || printf '%s\n' "$text" | grep -Eq "${head}${prefix}${runner}${path}codex${rest}[[:space:]](exec|e)${end}"; then
    deny "A headless LLM session (claude -p, claude --print, codex exec) would run outside Specplane's role checks. Ask the user to start it (bypass_guards.headless_block)."
  fi
fi

if on marker_protect; then
  if printf '%s\n' "$text" | grep -Eq 'SPECPLANE_(ACTOR|PROVIDER|AGENT_TYPE|SUBAGENT|MODEL|DELEGATED_BY|SESSION)[[:space:]]*\+?=' \
    || printf '%s\n' "$text" | grep -Eq '(^|[;&|(`{[:space:]])unset[[:space:]][^;&|]*SPECPLANE_' \
    || printf '%s\n' "$text" | grep -Eq '(^|[;&|(`{[:space:]])(-[A-Za-z]*u[[:space:]=]*SPECPLANE_|--unset[[:space:]=]+SPECPLANE_)' \
    || printf '%s\n' "$text" | grep -Eq "${head}${prefix}${path}env([[:space:]]+[^;&|]*)?[[:space:]](-[A-Za-z]*i[A-Za-z]*|--ignore-environment|-[A-Za-z]*u[A-Za-z]*|--unset)${end}"; then
    deny "A command that clears or overrides Specplane's session marker or the environment would hide that an LLM runs it. Ask the user (bypass_guards.marker_protect)."
  fi
fi

if on store_protect; then
  if printf '%s\n' "$cmd" | grep -Eq '(^|[^A-Za-z0-9_.-])\.git/(specplane/|refs/notes/)|(^|/)specplane/(role|os-users|trusted-rules)\.json' \
    || printf '%s\n' "$cmd" | grep -Eq '(update-ref|symbolic-ref|fast-import|hash-object)[^;&|]*refs/notes/specplane' \
    || printf '%s\n' "$cmd" | grep -Eq 'git([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*[[:space:]]+notes([[:space:]]+--ref[= ]+(refs/notes/)?specplane)[[:space:]]+(add|append|copy|edit|merge|remove|prune)' \
    || printf '%s\n' "$cmd" | grep -Eq 'git([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*[[:space:]]+notes[[:space:]]+(add|append|copy|edit|merge|remove|prune)([[:space:]]+[^;&|]*)?[[:space:]]--ref[= ]+(refs/notes/)?specplane'; then
    deny "$STORE_MSG"
  fi
fi

if on hook_protect; then
  if printf '%s\n' "$cmd" | grep -Eq '(^|[^A-Za-z0-9_.-])\.claude/(hooks/specplane-|settings(\.local)?\.json)'; then
    deny "$HOOK_MSG"
  fi
fi

if strict edit_block; then
  dirs=$(specdirs | sed 's/[.[\*^$()+?{|]/\\&/g' | paste -sd'|' -)
  if [ -n "$dirs" ]; then
    d="($dirs)/"
    q2="[\"']?"
    if printf '%s\n' "$cmd" | grep -Eq ">>?[[:space:]]*$q2(\./)?$d" \
      || printf '%s\n' "$cmd" | grep -Eq "(^|[[:space:];&|(\`])(tee|mv|rm|truncate|patch|install|ed)[[:space:]][^;&|]*$q2(\./)?$d" \
      || printf '%s\n' "$cmd" | grep -Eq "(^|[[:space:];&|(\`])(sed|perl)([[:space:]][^;&|]*)?[[:space:]]-[A-Za-z]*i[^;&|]*$q2(\./)?$d" \
      || printf '%s\n' "$cmd" | grep -Eq "(^|[[:space:];&|(\`])dd[[:space:]][^;&|]*of=$q2(\./)?$d" \
      || printf '%s\n' "$cmd" | grep -Eq "(^|[[:space:];&|(\`])cp[[:space:]][^;&|]*[[:space:]]$q2(\./)?$d[^[:space:];&|]*$q2[[:space:]]*($|[;&|])" \
      || printf '%s\n' "$cmd" | grep -Eq "(^|[[:space:];&|(\`])git[[:space:]]([^;&|]*[[:space:]])?(checkout|restore|apply|rm|mv|stash)[[:space:]][^;&|]*$q2(\./)?$d"; then
      deny "$EDIT_MSG"
    fi
  fi
fi

if strict git_commit_guard; then
  if printf '%s\n' "$text" | grep -Eq "${head}${prefix}${runner}${path}git${rest}[[:space:]]commit${rest}[[:space:]](--no-verify|-[A-Za-z]*n[A-Za-z]*)${end}" \
    || printf '%s\n' "$text" | grep -Eq 'core\.hooksPath|(^|[^A-Za-z0-9_.-])\.git/hooks(/|[[:space:];&|]|$)'; then
    deny "$GIT_MSG"
  fi
fi

if strict os_permissions; then
  if printf '%s\n' "$cmd" | grep -Eq '(^|[[:space:];&|(`])(chmod|chown|chgrp|chattr|setfacl)[[:space:]][^;&|]*(\.claude/(hooks/specplane-|settings\.json)|\.git/(hooks|specplane)|specplane/(role|os-users|trusted-rules)\.json)'; then
    deny "$OS_MSG"
  fi
fi
exit 0
