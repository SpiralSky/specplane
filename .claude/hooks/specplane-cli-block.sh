#!/bin/sh
# PreToolUse hook (matcher: Bash): keep the model off the Specplane CLI (architecture/claude-integration §4,
# reference-cli §12.7). Denies a shell command that runs `specplane` directly, with an env/command/sudo prefix, with a
# path, through `sh -c`, `npx`, `bunx` or a subshell. Best effort: the same forms the core's `isSpecplaneCommand`
# recognises, as a pattern, so it works without the CLI installed. Text that is not run is ignored first: bodies of
# heredocs with a quoted delimiter, single-quoted strings (except the argument of `-c`), the literal parts of
# double-quoted strings (command substitutions inside them stay) and comments. Exits 0 whenever it cannot do its job.
[ -f "${CLAUDE_PROJECT_DIR:-.}/.specplane/config.yaml" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0
cmd=$(jq -r '.tool_input.command // empty' 2>/dev/null) || exit 0
[ -n "$cmd" ] || exit 0
command -v awk >/dev/null 2>&1 || exit 0
cmd=$(printf '%s\n' "$cmd" | awk '
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
bin="([^[:space:];&|()\"'\`]*/)?specplane(@[^[:space:]\"']*)?(\\.m?c?js)?"
end="([[:space:];&|)\"'\`]|\$)"
if printf '%s\n' "$cmd" | grep -Eq "${head}${prefix}${runner}${bin}${end}"; then
  echo "The Specplane CLI is for people. Use the Specplane harness actions (the Specplane MCP tools) instead, or ask the user to run the command." >&2
  exit 2
fi
exit 0
