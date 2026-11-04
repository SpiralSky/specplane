# Session contract (read once, follow exactly)

You are one complete, isolated working session in /home/user/projects/ai-ml/specplane on branch
`overnight/specplane-20261102T144630Z`. Nobody else is writing to this checkout while you run. Follow CLAUDE.md,
AGENTS.md and `.claude/rules/specplane.md`. Do not spawn subagents.

## Goal: finish ONE acceptance step

Finish the step named in your prompt (or, if none is named, the next eligible step in the root HANDOFF.md
"Remaining acceptance inventory", in dependency order). Read the step file, its PLAN.md, the plan HANDOFF.md and
`spec-gaps.md` if present. Read the parts of the governing specs that apply. Then implement and test until each
acceptance criterion either:
- is **met**: implemented and covered by named passing tests, or by an explicit evidence check, or
- is **blocked**: it needs a human decision, an approval, host evidence you can't produce here, or a spec change.

Do not spend the session on unrelated hardening, test infrastructure or documentation.

## Managed workflow is deferred by user decision (do not try to fix it)

The plans are now `ready`, but managed recording is deferred until target-lifecycle and recovery are finished.
The user chose this on 2026-11-04. Old plan state needs recovery, and `plan abandon 2026-10-30-plan-conductor`
is still pending: it must run from a checkout of the integration branch, and that's for the final
reconciliation. Don't run plan start/step-done/retarget/abandon. So **"step complete" means
implementation-complete on this review branch**: every criterion is met, the work is committed, and the root
HANDOFF records the step as "implementation-complete; managed recording pending". Do not edit plan `status:`,
step checkboxes or managed progress files. Never approve, push, rewrite history or touch other branches/worktrees.

## Decisions

When a criterion needs a decision that belongs to the user (contract/spec changes, ADR commit kinds, new
protocol fields, approvals, branch reconciliation), do not invent an answer. Record the decision in the root
HANDOFF under "Open decisions" with an ID (D1, D2, …; keep existing IDs), 2–3 options, and your recommendation.
Then continue with the remaining criteria. If what's left is blocked only by decisions, stop.

## Testing (Bun only)

Build with `npm run build` in `packages/cli`. Run the focused tests with
`bun test --parallel=20 --timeout=30000 ./dist/<files>`, and the full suite once at the end with
`timeout 120 bun test --parallel=20 --timeout=30000 ./dist`. Prefix every bun test command with
`env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT` (with those set, Bun's output breaks `harness/codex.test`). Never use Node test runs or `--concurrent`.
Report stalls/timeouts exactly; don't skip them. Filter output (`| tail -n 30`) to save context.

## Token economy

Grep first, then read narrow line ranges. Don't read whole large files (`plan/flows.ts` is about 90 KB) or the
whole of `docs/work-records/LOG.md`. Keep tool output short.

## Close-out (required)

1. Commit in small conventional commits (`feat(<plan-slug>): …`), staging specific paths. Never stage
   `problems.md` or `AGENTS.override.md`. Plain conventional commits only; end each message with
   `Specplane-Agent: claude-code/claude-sonnet-5-5` and then
   `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
2. Rewrite the root HANDOFF.md in the **compact format** below, at most about 120 lines. Move process history
   out of it; history goes in one new LOG.md entry of 5 lines or fewer. Commit both.
3. Your final message is the report to the coordinator. Keep it to 200 words or fewer: step, each criterion
   met/blocked (with test names), commits, test results (exact counts), and new open decisions (ID plus one line).

## Compact HANDOFF format

```
# Session handoff
Updated <UTC>. Branch/HEAD. Read AGENTS.md and .specplane/config.yaml first.
## Current state            (5–10 bullets: what's committed, what works, known breakage)
## Open decisions           (D#: question — options — recommendation — what it blocks)
## Steps                    (table of 17: plan / step / impl-complete | partial | blocked | not started / note)
## Next session             (exact next step and the first concrete task)
## How to continue (orchestration) and ## Final reconciliation  (keep these verbatim unless facts changed)
## Rules that matter        (Bun-only testing commands; authority limits; no Node; preserve problems.md)
```
