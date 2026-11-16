# Codex vs Claude Code: usage analysis for Specplane

Analysis date: 2026-11-08. Scope: Codex sessions 2026-11-01 to 2026-11-08 and Claude Code sessions 2026-11-03 to 2026-11-08 for this repository.

## Summary

Codex used about 78% of the weekly quota on the prolite plan (window ending at reset timestamp 1794063031). It did write code, but little of it was built, tested and committed in the session that wrote it. Claude Code turned a similar number of tokens into about 3 times as much landed code, tests and commits.

The main causes of the Codex burn, in order of weight:

1. **High call count over a large context.** 5,267 model calls, median context about 82k tokens, almost all of it cache reads (475M cached input vs 12M uncached and 1.8M output). Calls above 100k context account for 63% of cache reads. Context was never compacted (2 shrink events in the whole week).
2. **Subagent fan-out.** 38 subagent threads used about 145M tokens, about 38% of specplane tokens. The three `sol_fast` workers in the 11-03 20:26 run used 63M tokens, more than their 34M-token parent. Two of the three ended with code written but "no build or tests run yet; awaiting coordinated build".
3. **Meta-work instead of steps.** Repeated "how many are left", forecast, handoff-rewrite and throughput-analysis turns. The count changed between sessions (21, then 32, then 35), so it never read as progress.
4. **Review and repair loops plus self-bookkeeping.** In the overnight cloud run's ledger, 23 of 48 assignments carry review, repair or follow-up labels, and the run wrote about 82 result/review/audit files. Claude later deleted 36k lines of these as "no code or spec reads them" (commit `7bde247`).
5. **Sandbox friction.** `spawnSync git EPERM` stalled the test suite until it was run outside the sandbox. Git writes to plan worktrees needed approvals. In the 11-03 13:37 session, 86 of 99 minutes were inside tool calls.
6. **Other repos.** About 22% of the weekly tokens went to `personal-app` (89M) and `tableau-vm` (17M), not specplane.

Not the cause: fast tier (6 turns used `priority`), and subagent use as such (Claude used a larger share of tokens in subagents).

## Comparison table

| | Codex (specplane, 11-01 to 11-04) | Claude Code (specplane, 11-03 to 11-08) |
|---|---|---|
| Main / subagent sessions | 58 / 38 | 32 / 55 |
| Model calls | about 4,700 specplane (5,267 all repos) | 3,164 |
| Total tokens | 379M | about 336M |
| Tokens in subagents | about 38% (145M) | about 52% (175M) |
| Mean context per call | about 93k | about 105k |
| User instructions | 245 | 224 |
| Commits | 148 | 430 |
| Code / test lines added | 6.6k / 5.2k | 17.6k / 14.5k |
| Docs and records lines added | 58.8k | 5.8k |

Per 100M tokens: Claude about 128 commits, 5.2k code lines, 4.3k test lines; Codex about 39 commits, 1.7k code lines, 1.4k test lines, 15k docs lines. Per instruction: Claude about 1.9 commits and 79 code lines; Codex about 0.6 commits and 27 code lines.

Plan outcome at Claude's end state (`HANDOFF.md` status table): 14 of 17 steps `impl-complete` (most with "managed recording pending"), 3 partial or blocked on live-host evidence (D19, D25).

## What the sampled sessions show

Session files are `~/.codex/sessions/2026/11/<day>/rollout-<local-time>-<thread-id>.jsonl`. Filename times are UTC+8; event timestamps inside are UTC.

| Session (local time) | Thread id | Tokens | What happened |
|---|---|---|---|
| 11-02 22:02 | `01a19c91-db3b-7be2-840f-7f5f23f4fd3c` | 9.6M | "How many are left": answered 32 (35 if step 2 splits), then spent the session on two audit subagents, doc research, timing re-estimates, an overnight prompt, a privacy scan, a path-scrub plan and a snapshot branch. No plan step implemented. |
| 11-03 10:22 | `01a19f37-8571-7e12-a3c8-eab7ac0fbe78` | 12.1M | Started from a cloud-restart notice (overnight run paused at `ae326ef`). Stash triage, history rewrite of three remote branches, contract clarifications, baseline repairs (593/593 tests). Explicitly stopped before any step. |
| 11-03 13:37 | `01a19fea-00c1-7980-8520-844fdee790b5` | 2.4M | "Why so many remaining" (21 steps). Follow-ups produced approval audits, parallelism advice, forecast and handoff rewrites, tok/s analysis. No step started. |
| 11-03 14:07 | `01a1a005-3adb-7922-9aa2-a65571186aa1` | 17.3M | One of four near-simultaneous sessions with similar prompts (14:07 to 14:08). |
| 11-03 20:20 | `01a1a15a-ee12-72b1-b559-73dac4e6470a` | 34.1M | Parent of three `sol_fast` workers: 3 `spawn_agent`, 48 `send_message`, 13 `followup_task`. Largest session. |
| 11-03 20:26 | `01a1a15f-f28b-7432-9f09-63021ebd89e3` | 23.5M | Worker: creation adapters, final 15 focused tests passed. |
| 11-03 20:26 | `01a1a160-0942-7672-9335-047f3ae3baca` | 22.3M | Worker: historical verification, 9 new regression cases, "no build or tests run yet". |
| 11-03 20:26 | `01a1a160-2ef2-7d21-9f52-477b696cf669` | 17.4M | Worker: transaction and reconciliation, crash-boundary tests, "no builds or tests ran for this batch". |
| 11-04 10:43 | `01a1a470-c660-7a02-8322-9dbf79dae477` | 15.3M | Largest of four sessions started with the same prompt ("Read HANDOFF.md and continue"), about 31M combined. |

The workers' code appears to have landed through Claude commit `4050dd6` ("checkpoint review-branch recording and lifecycle work", 80 files, +9,116 lines) on 11-04. That link is inferred from matching file names and descriptions, not from a diff.

The overnight cloud run (branch `overnight/specplane-20261102T144630Z`, last pushed state `ae326ef`) produced real integrated work: 48 ledger assignments, integrated regression counts rising from 396 to 441 to 480 tests. It was interrupted by a cloud restart before finishing. Its token use is not in the local session logs; the unexplained jump from 21% to 29% on the weekly meter between 11-02 14:58 and 11-03 02:24 UTC is probably this run (inference).

## Recommended Codex setup changes

1. One plan step per session. The step must end built, tested and committed before the session stops.
2. Do not forecast, count steps or rewrite `HANDOFF.md` unless asked. Write the result into the plan's `HANDOFF.md` only after the step lands.
3. Workers must build and run their tests before reporting done. Cap each step at one implementer plus one reviewer with no repair loop. Use `fork_turns: "none"`.
4. Ban per-batch result, review and audit files in `AGENTS.md`.
5. Run tests where `git` can write to the worktrees, or run suites outside the sandbox directly.
6. Keep Codex off other repos in weeks where specplane needs the quota. Close a session once its context passes about 100k.

## Method and data sources

- **Codex tokens and sessions:** `~/.codex/sessions/**/*.jsonl` (`token_count` events: `last_token_usage`, `rate_limits`) and `~/.codex/state_5.sqlite` table `threads` (136 threads, 488.6M tokens total; 96 in specplane, 379M). Subagent threads are rows with `thread_source = 'subagent'`.
- **Weekly percent:** `rate_limits.primary.used_percent`, window 10080 minutes, plan `prolite`. Per-session percentage attribution is a rough regression; treat the exact shares with caution. Raw token totals and commit counts are measured directly.
- **Claude tokens:** `~/.claude/projects/-home-spiralsky-projects-ai-ml-specplane/*.jsonl` (32 main sessions) and `*/subagents/*.jsonl` (55 files), assistant `usage` fields, deduplicated by message and request id. Logs only start on 2026-11-03, so Claude's 121 earlier commits (10-29 to 11-02) have no token data and its true total is higher.
- **Commits and lines:** `git log --all --numstat`, attributed by the `Specplane-Agent: codex` trailer (148 commits) and `Co-Authored-By: Claude` (552 commits, 430 since 11-03). "Code" is `packages/` and `harnesses/` non-test files, "tests" is `*.test.*` and `tests/`, everything else is docs.

## Caveats

- Codex's first sessions (11-01, 11-02) were spec and plan writing, which is mostly docs by nature, and Claude built on that foundation.
- Lines and commits are crude measures of progress. Claude's small frequent commits inflate commit count.
- I cannot see Claude's plan quota percentage, so the comparison is token use, not quota use.
- A coarse classifier that labelled sessions as code-editing or analysis-only put 95% of cache reads in sessions that edited code at least once, so it did not support a clean "mostly meta" split. The meta-work finding rests on the sampled sessions above.
- About 8 points of the weekly meter are not visible in local logs (see overnight run above).
