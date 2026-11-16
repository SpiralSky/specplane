---
plan: 2026-11-16-llm-preset-creation
step: 5
title: Verify the whole change
---
## Goal

Run every check and fix what fails. Commands: `npx tsc --noEmit -p .` in `packages/cli` before every build, then `npm run build` and `npm test`; `sh harnesses/claude/tests/hooks.test.sh`; `sh harnesses/claude/tests/check-sync.sh`; `validate`.

## Acceptance criteria

- All checks pass; `validate` reports no errors.
- The specs named in the plan still match the code; any difference is fixed in the code or recorded as a gap.

## Tasks

1. Run the commands above and fix failures.
2. Check each acceptance criterion of PLAN.md against the code and tests.
3. Record gaps in the step handoff.
