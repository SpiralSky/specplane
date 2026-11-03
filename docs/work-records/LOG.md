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

## 2026-11-03T09:24:13Z — test concurrency benchmark

- Commit tested: `b3dc060`; no implementation or test changes.
- Scope: user-requested full-suite benchmark at `--test-concurrency=20` on this device (i9-14900HX, 24 physical cores, Node reports 32 available logical CPUs).
- Checks: `node --test --test-concurrency=20 'dist/**/*.test.js'` outside the sandbox: 686 passed, 0 failed, 0 skipped; 87.776 s wall versus 100.960 s at concurrency 4 (13.184 s / 13.1% lower). Used the existing current build; no rebuild or repository validation run.
- Limits: single-run comparison, not proof of optimal concurrency or repeated-run stability. Default test command unchanged; unrelated `problems.md` preserved.

## 2026-11-03T09:30:47Z — finish/lifecycle and Bun investigation

- Commit tested: `b3dc060`; no production or test source changes.
- Checks: Bun 1.3.14 ran the existing compiled finish/lifecycle tests sequentially: 83 passed, 0 failed, 70.63 s; summed test durations finish 45.629 s, lifecycle 24.824 s. Not directly comparable to earlier Node full-suite runs under contention. Full suite under Bun not run.
- Profile: selected Node squash-restack test passed (one test, 5.849 s); eight CLI invocations consumed 5.641 s, direct Git calls about 0.070 s. A second deep-profile run passed; its two live-list commands issued 640 and 570 subprocess calls, including 177 and 161 branch-format checks. Profiling scripts/results were kept only in /tmp.
- Findings: split long files to distribute work; reduce repeated immutable/ref-syntax reads within operations without caching mutable state across confirmation; consider direct setup APIs. Bun is promising but process.execPath also switches CLI children to Bun, and Node-TAP-specific tests require separate compatibility review. No runtime/default changes made.

## 2026-11-03T10:31:23Z — integration-test optimization

- Commits: this entry's performance commit on top of `b3dc060`; upstream contribution commits remain unintegrated.
- Scope: split finish/lifecycle into seven files with per-file fixture ownership; use real start API for setup; keep all 83 original test bodies byte-for-byte; add operation-scoped successful branch-syntax caching to plan listing and one regression covering fresh refs, per-plan restrictions and scope cleanup. No mutable ref/object cache or mock replacement of integration scenarios. Extracted fixture modules excluded from package artifacts. Removed obsolete generated finish/lifecycle test outputs locally after the source moves.
- Checks: build and diff check passed; focused Bun run initially 128 passed / 1 new wrapper failure, repaired regression then passed. Initial complete Bun probe: 654 passed / 33 failed across ten Node-sensitive files. Complete Node compatibility run: 687 passed, 0 failed/skipped, 61.744 s at concurrency 20 versus 87.776 s before (29.7% lower). Original test-body preservation checked against HEAD through the TypeScript parser.
- Local runtime verification: Bun 1.3.14 handles 533 tests in 59 files; Node handles 154 tests in ten files. Sequential groups passed in 76.26 s; the final local launcher runs 12 Bun plus 8 Node workers concurrently and passed all 687 in 50.86 s. Machine-only Codex instructions and launcher are excluded through Git's local exclude file; committed runtime/default test command and lockfile are unchanged. No full-suite repeat after final validation; repository validation not run.
- Limits: single-run performance comparisons. Bun-only execution is not full Node compatibility; retain Node checks for TAP, subprocess environment and exact index behavior. Immutable-object caching was deferred to avoid changing provenance/freshness semantics. Unrelated `problems.md` preserved.

## 2026-11-03T10:52:11Z — trusted contribution patch integration

- Commits: this checkpoint on `4c15fc6`, importing only code from `63cd572`; `cff7c78` updated a deleted record and was not copied. Remote ancestry remains divergent; no push or merge performed.
- Scope: preparation-bound review capture and private journal inspection; refusal of omitted pending events; lazy query validator; added regression for capture after proposal validation. Preserved append-only cleanup, worker evidence/leases and unrelated `problems.md`; no managed lifecycle state changed.
- Checks: build and whitespace check passed; Bun capture 8 passed/0 failed. Sandboxed Node recording file failed without individual diagnostics; outside sandbox 13 passed/1 new fixture failure, repaired regression 1 passed. Final complete Node suite 697 passed/0 failed/0 skipped, 43.160 s at concurrency 20. Repository validation and full mixed-runtime run not run.
- Limits: pending review capture is not atomic contribution recording or live-host certification. Non-plan recording, body capture, history inspection and cross-process recovery remain pending. Review identified parent-directory replacement races in pathname-based capture reads/writes; static-link tests do not establish concurrent containment.
- Local permissions: verified direct `node --test` matches existing allow rule; redirected shell wrapper matches none. Use direct commands/tool output capture; no permissions or rules changed.

## 2026-11-03T11:08:00Z — descriptor-anchored contribution I/O

- Commits: this checkpoint on `88710de`; ordinary review-branch work, no managed lifecycle completion or push.
- Scope: shared Linux procfs descriptor traversal for contribution evidence and journal creation/read/write/list; exclusive synced records; nonblocking regular-file reads. Added nine helper tests and one public-capture parent-replacement regression; preserved unrelated `problems.md`.
- Checks: build and diff check passed; initial focused Bun capture 8 passed/0 failed, later two-file adversarial Bun run stalled/interrupted (not passed). Focused Node 16 passed before two final helper tests. Sandboxed full Node run stalled/interrupted; final full Node outside sandbox 707 passed/0 failed/0 skipped, 45.779 s at concurrency 20. Repository validation and full mixed-runtime run not run.
- Limits: protects against pathname redirection, not a hostile process moving opened inodes outside the tree, mutating bytes or mounts. Linux procfs requirement is an explicit portability gap. Other recording/execution/packaging paths and atomic contribution recording/recovery remain pending; no live-host certification claimed. Local-only runner routes both affected test files to Node after the Bun stall.
