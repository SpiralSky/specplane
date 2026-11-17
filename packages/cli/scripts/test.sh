#!/bin/sh
# Runs the test suite with TMPDIR pointed at a per-run directory that is removed on exit.
# Tests and the CLI processes they spawn create temp repositories through os.tmpdir(), so
# everything they leave behind is confined to that directory instead of accumulating in /tmp.
#
# Usage: sh scripts/test.sh [test paths...]   (default: ./dist)
#
# Runner (SPECPLANE_TEST_RUNNER):
#   auto (default)  Bun under a whole-run watchdog. Bun before 1.4.4 intermittently loses the exit
#                   of a child started with spawnSync: the child stays a zombie and the test worker
#                   spins, so the run never ends (oven-sh/bun#34069, #47257; fixed by PR #44581).
#                   Measured 2026-11-13 under CPU load: 1.3.14 stalled in 1 of 4 runs, 1.4.4 in 0 of 15.
#                   When the watchdog fires the whole run is repeated under Node's test runner.
#                   A Bun run that finishes, pass or fail, is reported as is. With no Bun on PATH, the
#                   run uses Node's test runner.
#   bun             Bun only, still under the watchdog; a stall exits 124.
#   node            Node's built-in test runner only (slower, never stalled so far).
# SPECPLANE_TEST_BUN_DEADLINE: seconds before a Bun run counts as stalled (default 180;
# a normal run takes about 45 s).
# SPECPLANE_TEST_BUN: the Bun binary to use. Default: the first `bun` on PATH that is 1.4.4 or
# newer, else the first `bun` on PATH with a warning that it can stall.
# Exits with the status of the run that is reported.

# Tests opt into harness identity themselves; the caller's session must not turn
# ordinary CLI subprocesses into LLM calls. Apply this to both runners and fallback.
unset SPECPLANE_ACTOR SPECPLANE_PROVIDER SPECPLANE_AGENT SPECPLANE_SESSION \
  SPECPLANE_AGENT_TYPE SPECPLANE_SUBAGENT SPECPLANE_MODEL SPECPLANE_DELEGATED_BY \
  SPECPLANE_ADAPTER SPECPLANE_CHECKOUT SPECPLANE_MEASURABLE_RESOURCES \
  CLAUDECODE CLAUDE_CODE_ENTRYPOINT

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

# True when Bun version $1 (major.minor.patch) is 1.4.4 or newer, the first release measured free of the stall.
bun_fixed() {
  IFS=. read -r major minor patch <<VERSION
${1%%[-+]*}
VERSION
  case "$major$minor$patch" in ''|*[!0-9]*) return 1 ;; esac
  [ "$major" -gt 1 ] || { [ "$major" -eq 1 ] && { [ "$minor" -gt 4 ] || { [ "$minor" -eq 4 ] && [ "$patch" -ge 4 ]; }; }; }
}

bun_bin="${SPECPLANE_TEST_BUN:-}"
if [ -z "$bun_bin" ] && [ "$runner" != node ]; then
  old_ifs=$IFS; IFS=:
  for dir in $PATH; do
    candidate="${dir:-.}/bun"
    [ -x "$candidate" ] || continue
    [ -n "$bun_bin" ] || bun_bin=$candidate
    if bun_fixed "$("$candidate" --version 2>/dev/null)"; then bun_bin=$candidate; break; fi
  done
  IFS=$old_ifs
  if [ -z "$bun_bin" ]; then
    # No Bun on PATH (a CI runner, a fresh machine): auto uses Node's test runner; an explicit `bun` is an error.
    if [ "$runner" = auto ]; then
      runner=node
    else
      echo "scripts/test.sh: SPECPLANE_TEST_RUNNER=bun but no bun was found on PATH (set SPECPLANE_TEST_BUN)." >&2
      exit 2
    fi
  fi
fi
if [ "$runner" != node ] && ! bun_fixed "$("$bun_bin" --version 2>/dev/null)"; then
  echo "scripts/test.sh: $bun_bin is older than Bun 1.4.4 and can stall a parallel run (oven-sh/bun#34069); upgrade Bun or set SPECPLANE_TEST_BUN." >&2
fi

fresh_tmp() {
  rm -rf "$run_dir/tmp"
  mkdir "$run_dir/tmp" || exit 1
  export TMPDIR="$run_dir/tmp"
}

run_bun() {
  fresh_tmp
  # shellcheck disable=SC2086 # $watchdog is a command prefix
  $watchdog "$bun_bin" test --parallel=20 --timeout=30000 "$@"
}

run_node() {
  fresh_tmp
  # Node takes globs, not directories: a directory argument means every test file under it.
  # Its --test-timeout bounds each whole file, so it is longer than Bun's per-test one. 120 s was too short on
  # a 2-core CI runner (v0.1.3 publish: two files that take ~36 s alone timed out under 20-way concurrency).
  first=1
  for arg in "$@"; do
    if [ "$first" -eq 1 ]; then set --; first=0; fi
    if [ -d "$arg" ]; then set -- "$@" "${arg%/}/**/*.test.js"; else set -- "$@" "$arg"; fi
  done
  node --test --test-concurrency=20 --test-timeout="${SPECPLANE_TEST_NODE_TIMEOUT:-420000}" "$@"
}

if [ "$runner" = node ]; then
  run_node "$@"
  exit $?
fi

run_bun "$@"
status=$?
if [ "$runner" = auto ] && [ -n "$watchdog" ] && { [ "$status" -eq 124 ] || [ "$status" -eq 137 ]; }; then
  echo "" >&2
  echo "scripts/test.sh: Bun did not finish within ${deadline}s (known stall in Bun before 1.4.4); rerunning the suite under Node." >&2
  run_node "$@"
  status=$?
fi
exit "$status"
