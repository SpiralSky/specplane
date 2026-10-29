---
plan: 2026-10-29-claude-instructions-and-enforcement
step: 2
title: Policy guard, session context, status line, and hook tests
status: pending
use_subagent: true
context:
  - spec: claude:architecture/claude-integration#Hooks
  - spec: claude:architecture/claude-integration#Testing
  - spec: architecture/file-formats#8. Commit messages
  - file: harnesses/claude/templates/hooks/
  - file: harnesses/claude/templates/settings.json
  - file: harnesses/claude/tests/hooks.test.sh
---

## Goal

Add the three new hook scripts, switch the handoff check to trailers, replace the settings fragment, and extend the hook tests.

## Acceptance criteria

- [ ] `specplane-policy-guard.sh`, `specplane-session-context.sh`, and `specplane-statusline.sh` implement § Policy guard, § Session context, and § Status line; POSIX `sh`, mode 0755, exit 0 whenever they cannot do their job.
- [ ] `specplane-handoff-check.sh` detects step commits by the `Specplane-Workflow: step` trailer and takes the plan ID from `Specplane-Plan`.
- [ ] `templates/settings.json` equals the registration JSON in § Hooks (2-space indent, trailing newline).
- [ ] `sh harnesses/claude/tests/hooks.test.sh` exits 0 under `sh` (and `dash` if installed) and covers every hook case in § Testing.
- [ ] One manual headless check is recorded in HANDOFF.md: `claude -p` asked to edit a feature spec under `llm_role: assist` does not apply the edit.
- [ ] Dogfood copies updated; `check-sync.sh` exits 0.

## Tasks

1. Write the policy guard (frontmatter `id:` from content or file; `awk` config read; PreToolUse JSON output with `jq -n`).
2. Write the session context hook (branch detection, step summary, `CLAUDE_ENV_FILE` exports).
3. Write the status line script.
4. Update the handoff check and the settings fragment.
5. Extend `hooks.test.sh`; run it; copy to `.claude/`; run `check-sync.sh`.
6. Run the headless check and record the result.

## Guidance

- Build hook JSON with `jq -n --arg`, never by string concatenation.
- If the hook input lacks `model`, `SPECPLANE_AGENT` is `claude-code`.
