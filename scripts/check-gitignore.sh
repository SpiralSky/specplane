#!/bin/sh
# Filename-only regression: creates no credentials, cache, or build artifacts.
set -eu
cd "$(dirname "$0")/.."
assert_ignored() {
  git check-ignore --no-index -q -- "$1" || { echo "Expected ignored: $1" >&2; exit 1; }
}
assert_trackable() {
  if git check-ignore --no-index -q -- "$1"; then
    echo "Required reviewable path is ignored: $1" >&2; exit 1
  fi
}
assert_ignored '.env'
assert_ignored '.env.local'
assert_ignored 'packages/example/.env.production'
assert_ignored 'node_modules/example/index.js'
assert_ignored '.cache/example'
assert_ignored 'coverage/index.html'
assert_ignored '.nyc_output/example.json'
assert_ignored 'packages/cli/dist/index.js'
assert_ignored '.claude/settings.local.json'
assert_trackable '.env.example'
assert_trackable '.env.sample'
assert_trackable '.env.template'
assert_trackable 'packages/example/.env.example'
assert_trackable '.specplane/config.yaml'
assert_trackable 'AGENTS.md'
assert_trackable 'packages/cli/src/agents/standing.test.ts'
git ls-files --error-unmatch -- '.specplane/config.yaml' >/dev/null
git ls-files --error-unmatch -- 'AGENTS.md' >/dev/null
git ls-files --error-unmatch -- 'packages/cli/src/agents/standing.test.ts' >/dev/null
# Ignoring a file does not untrack it; flag any existing tracked/ignored overlap.
overlap=$(git ls-files -ci --exclude-standard)
if [ -n "$overlap" ]; then
  printf 'Tracked paths now ignored (inspect; do not auto-delete):\n%s\n' "$overlap" >&2
  exit 1
fi
echo 'Ignore hygiene checks passed; required versioned assets remain trackable.'
