# Session handoff

## Continuation checkpoint

Continue on review branch `overnight/specplane-20261102T144630Z`, using actual HEAD. Divergence inspected: upstream-only `63cd572` adds trusted review contribution capture and `cff7c78` records its checkpoint; local `7bde247` replaces old work records with the append-only log. Those upstream commits remain unintegrated. Coordinate integration while preserving the log cleanup rather than resetting or overwriting local work. Preserve the unrelated untracked `problems.md`.

Latest recorded implementation: prepared workflows persist private generation-bound host-worker evidence before exposing the request. Checkout, plan and repository lease acquisition and previews refuse dead-owner reclamation while that evidence exists. Ordinary release requires proof of host stop; trusted stopped-preparation boundaries release the full lease set and marker after acknowledgment. Cancellation/inspection use preparation-owned state, preserve partial edits and report unfinished publication after recording.

Latest performance checkpoint on top of `b3dc060`: finish/lifecycle coverage is split into seven independently owned test files; fixture setup calls the existing start API; plan listing caches successful branch-name syntax checks only for that operation. Mutable refs, objects and checkout state are not cached. All 83 original finish/lifecycle test bodies are unchanged; one cache-safety regression test was added. Build passed and Node compatibility suite passed all 687 tests in 61.744 s at concurrency 20, versus 87.776 s before. The local mixed-runtime run passed 533 tests on Bun and 154 on Node in 50.86 s. Runtime policy remains Node >=22. Repository validation was not rerun. Progress is logged in `docs/work-records/LOG.md`. Older per-batch records remain recoverable from history before `7bde247`.

Cross-process reconstruction/recovery, non-plan recording and trusted contribution capture remain pending. Dead parent PIDs never prove host workers stopped. Existing preparations without the new evidence marker are not retroactively protected. Reuse private preparation state, retained leases and core-issued receipts; do not reconstruct verified execution from caller JSON or infer native host/session identities.

## Next step: coordinate upstream contribution capture, then resume recording

The lazy JSON-schema compilation performance fix is complete. Validators compile on first use and cache results while preserving default versus `allErrors: true` options and the existing formatted-schema helper. `workflow-execution.ts` and the indirect eager call in `completion-writer.ts` were included. No tests or expectations changed.

Before the next recording batch, reconcile the upstream-only contribution-capture implementation (`63cd572`, with checkpoint `cff7c78`) with the local append-only log cleanup. The user was asked whether to integrate these commits; no answer was received at this checkpoint. Do not restore removed per-batch records or forecasts. The upstream contribution-capture module contains another eager Ajv validator; convert it to the new helper if integrated. Inspect its actual acceptance coverage before assigning follow-up work.

Then continue the pending workflow-recording coverage below: non-plan recording, atomic trusted-contribution recording, and cross-process recovery. This performance checkpoint records no managed step completion or lifecycle approval.

## Testing policy

Do not run the full suite by default. The latest Node run took about one minute on this machine, and most changes do not need it.

- **While developing:** build, then run only the test files for the changed modules, for example `npm run build && node --test dist/core/workflow-recording.test.js` from `packages/cli`. Use `--test-name-pattern` to narrow further.
- **Full suite (`npm test`), at most once per change set:** before committing a change to shared code (`core/`, `cli.ts`, `schemas.ts`, shared test fixtures), and before pushing or merging. Rerun it only after a further code change or a failure.
- **Never run the full suite** for docs-only, handoff-only, spec-only or record-only changes, or merely to re-confirm a result that has not changed.
- Record exactly which checks ran and their results in the log entry. Write "not run" rather than implying a full run.

## Parallel implementation policy

The user wants substantial parallelism across all remaining implementation, chosen to reduce total completion time without creating avoidable conflicts. This authorizes main-agent coordination and parallel subagents; it does not authorize starting implementation during a handoff-only edit, changing lifecycle approvals, or bypassing dependency gates.

Use the available concurrency limit (currently main plus three workers). Fill useful independent slots, but do not split work just to fill slots. The main agent owns shared interfaces, integration, review and progress records, and works on useful unclaimed tasks while workers run.

Before each batch:

1. Inspect current code and the selected contracts; identify prerequisites, shared files and integration order. Reuse existing implementations before creating replacements.
2. Make a small assignment table in the dispatch messages (not a separate record file): task, prerequisite/interface revision, owner, allowed files, acceptance checks and integration order. Give each mutable file one owner, including tests, fixtures, generated output, manifests and lockfiles.
3. Dispatch work whose inputs are stable and whose edits are independent. If two tasks need the same interface or file, have one owner establish that change first, or combine the tasks. Workers propose out-of-scope changes to the coordinator rather than editing another owner's files.
4. Use isolated clean checkouts when shared build output or broader edits make a shared checkout unsafe. Start from cleaned, current history. Isolation prevents working-tree races, not semantic conflicts; keep ownership and dependency checks either way.
5. Integrate in prerequisite order, review the actual combined diff, and run acceptance checks against real dependencies. Mocks can support development but cannot establish dependent-step completion. Pause/repartition a stream when interface churn or repeated conflicts outweigh its benefit.

Delegate bounded coherent tasks with enough work to justify coordination. Reuse workers for repairs. Workers return changed files, checks and results, unresolved issues, and required integration changes in one report. Do not create repeated handoff/reviewer chains for tiny edits or repeatedly poll for status.

### Subagent selection

Use the **`sol_fast` subagent role** for implementation and review workers: GPT-6.1 Sol with Fast processing, preferably `medium` reasoning. Fast is authorized; Ultrafast is not. Keep the main agent's model and standard service tier unchanged.

The local role is configured in `~/.codex/agents/sol_fast.toml` with `model = "gpt-6.1-sol"` and `service_tier = "fast"`; the user config registers `agents.sol_fast` and retains Astra with `service_tier = "default"` globally. This is a local setting, not a repository-provided role or proof of an active worker's tier.

Select `sol_fast` explicitly when the spawning tool supports roles. If the tool only supports model/effort overrides, use `fork_turns: "none"`, `model: "gpt-6.1-sol"`, and `reasoning_effort: "medium"`, and supply complete scope, contracts, ownership and acceptance criteria. Verify that the runtime actually supplies Fast/`priority`; a model override alone does not select a service tier. If Fast cannot be selected or verified, report that limitation rather than claiming the role is active, silently using another model/tier, or enabling Fast globally. Do not assume a config edit changes an already-running session.

## Remaining work and scheduling

The previous inventory identified 17 original acceptance steps across seven plans; recheck coverage before assigning work. This is not a fresh live plan-status result or a time estimate.

| Stream | Remaining coverage / scheduling boundary |
| --- | --- |
| Workflow recording (1 partial step) | Complete step 04: non-plan recording, trusted contribution capture and cross-process recovery. Coordinate changes to private state, leases and host-stop evidence under one interface owner. |
| Manual lifecycle (2 partial steps) | Existing confirmation and single-target approval adapters are implemented. Continue exact overlay-pin previews, multi-target behavior, finalized assist text, abandonment and finish/rebase/merge decisions, retaining separate confirmation gates. Depends on recording contracts. |
| Product docs (3 steps) | Implement remaining shared guidance against settled behavior. Draft independent topics in parallel; finalize after relevant lifecycle contracts stabilize. |
| Packaging (3 partial steps) | Existing containment/customization repairs are partial. Continue inventory/ownership digests, serialization, recovery journals and atomic activation. Coordinate shared install paths and generated assets; concurrent parent-directory replacement remains unresolved. |
| Claude delivery (3 steps) / Codex delivery (3 steps) | Run these as independent host streams once their shared core and packaging interfaces stabilize. Keep shared contract changes with the coordinator. |
| Conformance (2 steps) | Prepare independent tests against stable contracts early; final acceptance requires integrated implementations. Live certification and publication are separate. |

Acceptance dependency order remains recording → manual lifecycle → docs → packaging → host deliveries → conformance. Overlap independent implementation within that order where stable contracts permit; do not equate scheduling overlap with formal readiness.

Target lifecycle, plan index and core foundation were implemented earlier. Completion assessment includes the approved safe-refusal limitation for shared YAML anchors. Preparation/state binding, execution receipts, manual exact-set recording and the confirmation primitive already exist; extend them rather than building parallel machinery.

`problems.md` retains five findings and their assignment context: conductor selection → manual lifecycle step 3; dangling-symlink containment → packaging step 2; coexistence → packaging step 3; complete Codex procedure → Codex delivery step 2; generated policy guidance drift → docs/packaging. Dangling-link regressions pass, but transactional/concurrent-replacement acceptance is still pending. Preserve findings until their full acceptance evidence exists.

## Recording, verification and execution boundaries

This root handoff describes ordinary review-branch implementation under the recorded user exception. Formal source PLAN/step/HANDOFF states remain unchanged and do not measure that implementation. Record batch scope, gaps, assumptions and evidence in the append-only log `docs/work-records/LOG.md` (see below); never fabricate managed step completion from review-branch work.

For managed execution, follow `AGENTS.md`: resolve paths from `.specplane/config.yaml`, use the designated `plan/<id>` checkout and CLI routing, execute one step at a time per plan, and record through the CLI. Record managed gaps in that plan's `spec-gaps.md` with its six-field format. Do not hand-edit CLI-owned progress, bypass readiness gates, approve specs/plans/ADRs, or automatically finish/merge. Architecture wins over feature detail; stop on contradictory specs.

At each coherent integration checkpoint:

- Append one entry to `docs/work-records/LOG.md` (create it if missing). The log is append-only: add new entries at the end, never edit or delete earlier ones, and correct a mistake with a new entry that references the old one. Keep each entry to about five lines: UTC date/time, commit IDs, scope completed, checks run with their exact results (or "not run"), and open issues or gaps. Do not create per-batch result files, forecasts, coverage or timing records; the log entry is the record. The three other files in `docs/work-records/` are kept only because other docs link to them. Do not promise a completion deadline.
- Follow the testing policy above: focused checks during development, the full suite at most once per change set. Keep one owner/process per test job, retain its session ID, and coordinate builds to avoid shared-output races.
- Review the combined changed-file set and preserve uncertain/missing acceptance evidence. Commit only selected reviewed files; ordinary review-branch commits must not claim a managed `step` outcome. Do not invent core receipts, provenance or live certification.
- Update this handoff with the latest state and next useful assignments; replace superseded summaries instead of appending repeated history. Continue eligible authorized implementation after checkpoints when implementation is the active task.

Known environment limits: Git-spawning tests previously failed/stalled in the sandbox and passed after scoped escalation. On errors such as `spawnSync git EPERM`, request the required escalation rather than retrying unchanged or weakening permissions globally. Git metadata writes and sibling worktrees may also require escalation. Use completion notifications and bounded waits (at most 60 seconds per blocking call); a timeout is not a reason to restart a worker or duplicate its suite.

`specplane` was absent from PATH; use `node packages/cli/dist/cli.js` when built/current, rebuilding after relevant source changes. The last live-list attempt reported `Conflicting plan or specification path interpretation at 092a6f8db9b27d44a1b7fb391f1d35d818436da6.` Treat this historical-ref discovery issue as unresolved; stored status is not a fresh live result.

## Clean-history boundary

The reviewed overnight baseline was rewritten from `ae326ef` to `2175faf` to remove identifying local paths; use actual current HEAD. Old local integration/plan branches and retained worktrees contain pre-cleanup ancestry: do not merge or push them into cleaned history. Migrate unique needed changes only as reviewed patches on a clean base. Old cloud prototypes were not available in this clone or fetched refs; do not assume they are integrated.

Private recovery material at `~/.local/share/specplane/history-backups/2026-11-03/` contains original identifying content. Never publish it or delete retained backups/worktrees incidentally. Historical reports retain original IDs. The verified cleanup covered three approved remote ref replacements, not every external clone, fork or cached object.
