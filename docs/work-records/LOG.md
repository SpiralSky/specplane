# Work log

Append-only. Add new entries at the end; never edit or delete earlier ones. Correct a mistake with a new entry that references the old one. About five lines per entry: UTC date/time, commits, scope, checks run with exact results (or "not run"), open issues.

## 2026-11-03 — record cleanup

- Commits: this entry's commit, on top of `d88d709`.
- Scope: removed 119 per-batch work records, `implementation-forecast.json` and the overnight run folder; none were used by code or specs. Kept the three records linked from `README.md`, `docs/design/harness-orchestration.md` and the archived core-foundation plan. Earlier records remain in git history before this commit.
- Checks: full suite on `d88d709` 686 passed, 0 failed, 0 skipped, 164 s wall at concurrency 4. CLI `--help` load ~536 ms vs ~79 ms bare Node, mostly import-time Ajv schema compilation. No code changed in this commit.
- Next: lazy schema compilation (see root `HANDOFF.md`).

## 2026-11-03T09:20:05Z — lazy schema compilation

- Commits: this entry's `perf(cli): compile JSON schemas lazily` commit, on top of `7bde247`; upstream-only `63cd572` and `cff7c78` inspected but not integrated.
- Scope: defer and cache core/recording validators, preserve Ajv options and formats, hoist inline schemas, and remove indirect eager completion validation. No test expectations changed; no managed plan state changed.
- Timing: CLI `--help` five-run milliseconds before [517.835, 529.426, 532.638, 543.072, 531.207], mean 530.835; after [184.671, 188.953, 176.631, 176.161, 174.130], mean 180.109 (66.1% lower). Final full-suite wall 100.960 s versus recorded 164 s baseline (38.4% lower), concurrency 4.
- Checks: build and diff whitespace check passed; final focused suite 83 passed, 0 failed/skipped; final full suite 686 passed, 0 failed/skipped. Import instrumentation confirmed zero eager compilations, cached reuse, error reset and option isolation. Initial sandbox focused run failed 4/9 files; outside sandbox 72/72 passed. An intermediate full suite passed 686/686 in 102.109 s; rerun followed further code changes. Repository validation not run.
- Open: upstream integration preference pending; contribution capture, non-plan recording and cross-process recovery remain pending. Preserved unrelated untracked `problems.md`.
