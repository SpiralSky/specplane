#!/bin/sh
# Runs the test suite with TMPDIR pointed at a per-run directory that is removed on exit.
# Tests and the CLI processes they spawn create temp repositories through os.tmpdir(), so
# everything they leave behind is confined to that directory instead of accumulating in /tmp.
#
# Usage: sh scripts/test.sh [test paths...]   (default: ./dist)
#
# Runner (SPECPLANE_TEST_RUNNER):
#   auto (default)  Bun under a whole-run watchdog. Bun intermittently stalls at the end of a
#                   parallel run (a worker spins inside the Bun binary and never reports), so
#                   when the watchdog fires the whole run is repeated under Node's test runner.
#                   A Bun run that finishes, pass or fail, is reported as is.
#   bun             Bun only, still under the watchdog; a stall exits 124.
#   node            Node's built-in test runner only (slower, never stalled so far).
# SPECPLANE_TEST_BUN_DEADLINE: seconds before a Bun run counts as stalled (default 180;
# a normal run takes about 45 s).
# Exits with the status of the run that is reported.

base="${TMPDIR:-/tmp}"
run_dir=$(mktemp -d "$base/specplane-test-run.XXXXXX") || exit 1
trap 'rm -rf "$run_dir"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [ "$#" -eq 0 ]; then
  set -- ./dist
fi

runner="${SPECPLANE_TEST_RUNNER:-auto}"
deadline="${SPECPLANE_TEST_BUN_DEADLINE:-180}"
case "$runner" in
  auto|bun|node) ;;
  *) echo "scripts/test.sh: unknown SPECPLANE_TEST_RUNNER '$runner' (auto, bun or node)" >&2; exit 2 ;;
esac

# coreutils timeout signals the whole process group, so Bun's test workers die with it.
watchdog=""
if command -v timeout >/dev/null 2>&1; then watchdog="timeout --kill-after=10 $deadline"
elif command -v gtimeout >/dev/null 2>&1; then watchdog="gtimeout --kill-after=10 $deadline"
fi

fresh_tmp() {
  rm -rf "$run_dir/tmp"
  mkdir "$run_dir/tmp" || exit 1
  export TMPDIR="$run_dir/tmp"
}

run_bun() {
  fresh_tmp
  # shellcheck disable=SC2086 # $watchdog is a command prefix
  env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT $watchdog bun test --parallel=20 --timeout=30000 "$@"
}

run_node() {
  fresh_tmp
  # Node takes globs, not directories: a directory argument means every test file under it.
  # Its --test-timeout also bounds each whole file, so it is longer than Bun's per-test one.
  first=1
  for arg in "$@"; do
    if [ "$first" -eq 1 ]; then set --; first=0; fi
    if [ -d "$arg" ]; then set -- "$@" "${arg%/}/**/*.test.js"; else set -- "$@" "$arg"; fi
  done
  env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT node --test --test-concurrency=20 --test-timeout=120000 "$@"
}

if [ "$runner" = node ]; then
  run_node "$@"
  exit $?
fi

run_bun "$@"
status=$?
if [ "$runner" = auto ] && [ -n "$watchdog" ] && { [ "$status" -eq 124 ] || [ "$status" -eq 137 ]; }; then
  echo "" >&2
  echo "scripts/test.sh: Bun did not finish within ${deadline}s (known end-of-run stall); rerunning the suite under Node." >&2
  run_node "$@"
  status=$?
fi
exit "$status"
