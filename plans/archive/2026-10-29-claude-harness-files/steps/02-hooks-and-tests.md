---
plan: 2026-10-29-claude-harness-files
step: 2
title: Hook scripts, settings fragment, and hook tests
status: done
use_subagent: true
context:
  - spec: claude:architecture/claude-integration#Hooks
  - spec: claude:architecture/claude-integration#Testing
  - spec: claude:architecture/claude-integration#Template source
  - spec: architecture/file-formats#HANDOFF.md
---

## Goal

Write the three hook scripts and the settings registration fragment under `harnesses/claude/templates/`, and `harnesses/claude/tests/hooks.test.sh` covering them.

## Acceptance criteria

- [x] `templates/hooks/specplane-pre-commit.sh` matches the script in § Pre-commit validation exactly.
- [x] `templates/hooks/specplane-handoff-check.sh` and `templates/hooks/specplane-generate.sh` implement the § Optional hooks table, each with a header comment containing its registration snippet; both always exit 0 and are no-ops without `.specplane/config.yaml`.
- [x] All three scripts are POSIX `sh` (no bashisms) and have mode 0755 in git (`git update-index --chmod=+x` if needed).
- [x] `templates/settings.json` equals the registration JSON in § Pre-commit validation (2-space indent, trailing newline).
- [x] `sh harnesses/claude/tests/hooks.test.sh` exits 0 and covers every case in § Testing for the hook scripts; it creates all temp state under `mktemp -d` and cleans up.
- [x] The tests are run once with `sh` and pass; if `dash` is installed, they also pass under `dash`.

## Tasks

1. Write the pre-commit script and settings fragment from the spec.
2. Write the two optional scripts.
3. Write `hooks.test.sh`: a `run_case <name> <expected-exit> <json> <stub-exit>` helper; stub `specplane` in a temp bin dir prepended to `PATH`; build JSON with `jq -n --arg c "<cmd>" '{tool_input:{command:$c}}'` (or `file_path` for the generate hook); print `ok`/`FAIL` per case and a summary; exit 1 if any failed.
4. Run the tests and fix failures. If a spec'd case cannot pass with the spec'd script, do not change the regex silently: record it as a gap in HANDOFF.md.

## Guidance

- For "`specplane` absent" cases, set `PATH` to a temp dir containing only symlinks to `jq`, `grep`, `sh`, `cat`, `printf` (as needed) — not the stub.
- The handoff-check case needs a temp git repo with a commit whose subject is `plan/x step 01: y`; set `user.name`/`user.email` locally in that repo.
