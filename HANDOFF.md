# Session handoff

## Current state

Preparation is complete; stop before the next roadmap implementation step. The user will resume in a new session. This handoff supersedes the old cloud-input handoff, overnight coordinator prompt, historical recovery instructions and earlier worker/model arrangements.

The active branch is `overnight/specplane-20261102T144630Z`. Its reviewed overnight baseline was rewritten from `ae326ef` to `2175faf` solely to remove identifying local paths. Preparation changes are recorded in the commits following that baseline; use actual HEAD, not the old IDs, when starting work.

- Full CLI regression: **593 passed, 0 failed, 0 skipped**, with the user's normal Git settings. Build passed. Tests ran outside the sandbox after the earlier `spawnSync git EPERM` diagnosis.
- Hook tests: **74 passed, 0 failed**; installed/template synchronization passed.
- Repository validation: **0 errors, 89 existing warnings** after the approved specification commit; dependency pins are current.
- Personal-path guard: self-test and isolated-repository rejection/acceptance checks passed. It is included in CI.
- Source repairs only made fixture branches/newline handling explicit and synchronized the installed generation hook. No remaining roadmap step was implemented.

Details: `docs/work-records/2026-11-03-preimplementation-review.json`, `docs/work-records/2026-11-03-path-cleanup-result.json`, and `docs/work-records/2026-11-03-workflow-contract-clarifications.json`.

## Next session: one step, then handoff

Work directly in the session. **Do not spawn subagents or resume the coordinator/worker framework. Complete at most one original roadmap step, update the estimate and handoff, then stop even if another step is eligible.** If blocked or interrupted, hand off that same incomplete step; do not count it as complete or advance to another one.

Next assignment: **`2026-11-01-workflow-recording`, step 01, “Preparation and state binding.”** Read its step file and configured architecture references, especially the newly clarified initiation, compatibility and reviewed-test-mapping contracts. Implement the full selected step, including applicable non-plan workflows; do not label a plan-only subset complete. The later manual-lifecycle step owns trusted confirmation integration.

The overnight implementation used the user's ordinary-Git review-branch exception. That exception remains the recorded context; changing to direct sessions does not fabricate managed lifecycle completion. Source PLAN/step/HANDOFF statuses were deliberately preserved and do not describe the implementation already integrated into this review branch. Use a separate review-branch work record for the next assignment. If the user invokes managed plan execution instead, follow AGENTS.md's CLI routing and report its actual readiness/dependency gates; never hand-edit statuses or silently migrate old plan branches to bypass them.

Before implementation:

1. Check branch, HEAD, working tree and `.specplane/config.yaml`. Preserve unrelated `problems.md` if still uncommitted. Do not merge or push old local integration/plan branches: they retain pre-cleanup ancestry.
2. Read only the selected step and its needed context. The approved clarifications are applied in `architecture/reference-cli`; the shared-anchor limitation is also in `feature/tooling`. The JSON record contains the exact approved wording. Formal spec/plan approval states remain unchanged.
3. Record applicable gaps/assumptions in the selected plan's `spec-gaps.md` when doing managed execution; under the existing review-branch exception use the run-owned work record without changing CLI-owned progress files. Preserve the six-field gap format when creating a plan gap entry.
4. Freeze/report the step estimate from `docs/work-records/implementation-forecast.json`. Review and test the completed change directly in this session; use meaningful tests and exact changed-file review. Do not repeat a full suite without a new change or concern justifying it.
5. Record the reviewed result and actual evidence. Do not fabricate core-issued receipts, model/session provenance, live certification or lifecycle approvals. Commit only the selected reviewed files; ordinary review-branch commits must not claim a managed `step` outcome.
6. Update the forecast, implementation coverage, open findings and this root handoff, then stop. Do not call the next assignment automatically. Formal managed recording, when invoked and eligible, uses the CLI and its exact-set workflow.

## Estimate and model choice

**21 original steps remain across seven plans.** Provisional remaining active session effort: **7.5–16 hours**, plus **3–6 hours contingency**. Next step: **30–75 minutes**. These are bottom-up planning estimates, not measured model throughput or a deadline. Live host/API blockers add unknown waiting. The old 50–102-hour estimate is retired rather than presented as current.

At every handoff record completed versus remaining scope, observed elapsed time, known approval/wait time, active time or `unknown`, and revised low/high ranges with reasons. Remove completed scope from the forecast; do not subtract elapsed time as though it proved completion. Recalibrate after the first direct-session step.

Recommended next-session model: **GPT-6.1 Sol, medium reasoning** for workflow recording. This is a speed/capability compromise for state, lease and evidence logic. **GPT-6 Luna, high reasoning** is an option for later tightly scoped docs or mechanical changes with explicit criteria; existing specifications do not remove the judgment needed for concurrency and trusted-confirmation work. Escalate a difficult task's reasoning/model instead of weakening acceptance checks. No model or speed setting was changed in this session.

Official guidance checked 2026-11-03: https://learn.chatgpt.com/docs/models and https://learn.chatgpt.com/docs/model-selection . Availability varies by account/client; no measured speedup is claimed.

## Preserved implementation and remaining issues

Target lifecycle and plan index are implemented and reviewed. Completion assessment is implemented with the now-approved safe-refusal limitation for shared YAML anchors. Core foundation was completed earlier. Historical acceptance-matrix statuses remain evidence of that run, not newly manufactured verification.

Workflow recording (4 steps), manual lifecycle (3), product docs (3), packaging (3), Claude delivery (3), Codex delivery (3), and conformance (2) remain. Dependency order is recording → manual lifecycle → docs → packaging → host deliveries → conformance. Both host deliveries are sequential in direct sessions unless the user changes that arrangement. Live certification and publication remain separate.

`problems.md` preserves five implementation findings. Their owners are recorded in the preparation review: conductor selection → manual lifecycle step 3; dangling-symlink containment → packaging step 2; coexistence → packaging step 3; complete Codex procedure → Codex delivery step 2; generated policy guidance drift → docs/packaging guidance work. Do not implement these as an untracked batch before the selected step.

Later workflow/manual prototypes reported by the old cloud session are not available in this clone or fetched remote branches. Do not assume their repairs were integrated or use stale cloud paths as active checkouts.

## History-cleanup boundary

The three explicitly approved remote ref replacements were published atomically with expected-tip leases and verified from a fresh clone. `main` and the other remote development branch were unchanged. Commit emails and commit messages were preserved. Historical reports retain their original commit IDs; a private old-to-new mapping records the rewrite, without inventing new review evidence.

Private recovery material is in `~/.local/share/specplane/history-backups/2026-11-03/`, with owner-only access. It includes original history and identifying content: never publish it. Existing local plan worktrees and the old integration branch remain historical copies, not valid sources to merge back into cleaned history. Migrate any unique future-needed work by reviewed patches on a clean base. Do not delete retained worktrees or private backups incidentally.

Other clones, forks and GitHub cached objects are outside the verified branch-history scope. No support request was sent. This limitation does not prevent work on the cleaned branch. Do not claim that every external copy has been erased.
