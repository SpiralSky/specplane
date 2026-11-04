#!/bin/sh
# Runs the Bun test suite with TMPDIR pointed at a per-run directory that is removed on exit.
# Tests and the CLI processes they spawn create temp repositories through os.tmpdir(), so
# everything they leave behind is confined to that directory instead of accumulating in /tmp.
# Usage: sh scripts/test.sh [bun test paths...]   (default: ./dist)
# Exits with bun's exit status.

base="${TMPDIR:-/tmp}"
run_dir=$(mktemp -d "$base/specplane-bun-run.XXXXXX") || exit 1
trap 'rm -rf "$run_dir"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [ "$#" -eq 0 ]; then
  set -- ./dist
fi

export TMPDIR="$run_dir"
env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT bun test --parallel=20 --timeout=30000 "$@"
status=$?
exit "$status"
