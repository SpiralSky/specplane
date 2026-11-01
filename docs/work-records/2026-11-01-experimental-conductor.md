# Experimental conductor development — 2026-11-01

The user explicitly authorized ignoring development-stage specification approval for parallel experimental development. Final merge remains human-only. This does not represent approval of these revisions, acceptance of ADR 0005, or completion of a plan. No actual plan or step status is changed.

## Approval provenance

Changed spec revisions are demoted from their recorded approved status to **review**, never promoted. The prior approved content remains in Git at the base blob below; this table identifies experimental content hashes before mechanical pin refresh.

| File | Prior blob | Experimental SHA-256 |
|---|---|---|
| `docs/specifications/architecture/agent-skills.md` | `c01fd208ef8c7b2cf1685e80f4e9b3e6fbaa65e2` | `5dc423ecce46c1561c2cb707fd65a676ddffafaf4889297c19df14a0584b13ca` |
| `docs/specifications/architecture/file-formats.md` | `e6fa7e5bb432fd7d9a9e2e5d1ed5e30b7d172bf0` | `2a9b3b5edd0cfb86cfe34fea62ed18e99dad472d90372e2ff2db3d85488f3a1d` |
| `docs/specifications/architecture/reference-cli.md` | `248d44bac80b5d47a27728d4ed86334df833d0a6` | `0831e79068a28aa64668b44cbbcd2a6e7413b9008f203c76ed62fc35137a5d56` |
| `docs/specifications/features/agent-integration.md` | `9e3a0cf9e109ac7b928a67b82d48ceef7593869b` | `b2590d2cf4128a2715e7eff1b13b53289014ffc4894962d022770b57212b9026` |
| `docs/specifications/features/configuration.md` | `ee4d5a6847fb448fdc9bd79903cafed531a66ada` | `385ddf78def7fe1c458b8ec476d89ca64780066b599c53108e640e8b62395e21` |
| `docs/specifications/features/plan-execution.md` | `47ba705632bb8d393a5270dcc46fe9e175bb5fa5` | `5df1eea1aee519c0305c0d7cfa41bbc8057b18a5ddc88c77e6ea22ab4a202f19` |
| `docs/specifications/features/spec-precedence.md` | `35c6bbb6340d046621a9d2b77ee657cd66ea5802` | `05ae80c34836b7293da8bde35e43d4c406cc21fbc56bfdb1e10b3645bb4e413b` |
| `harnesses/claude/specifications/architecture/claude-integration.md` | `f91ca7593ab2899d95aba5170419e1d88b2bfff3` | `3b8202f1fa0ac5e538466d214b6b2de5193d7b390452a45275fa844e5fd09608` |
| `harnesses/claude/specifications/features/claude-integration.md` | `e511a6f4c1aa898ea25c38072a16894d352b93c1` | `6c81a6ba6c5412f485974a01aa3c9ec2ce8dabbf11be2875200a0506d05a583d` |
| `docs/specifications/architecture/repository-layout.md` | `62eecb059ed56dc64440c7a9e3f270b7138fa185` | `6e937c1cbcec9ff932396168d36a4ac5f4b03eb60405e33d6ef8fb743b919b1c` |

Repository-layout is demoted only because its feature/configuration dependency is now under review; its body is unchanged.

## Implemented experimental behavior

- Config/session-mode validation, opt-in notifications, bounded concurrency/budget configuration.
- Harness-neutral session API, deterministic UUIDv5, strict capability/observation checks, collision refusal and resume.
- Atomic guarded per-plan locks, proven-dead PID reclamation, precondition/rerun gates, serial loop, bounded parallel plans.
- CLI `plan run`, `start --run`, and live attention; no approval/finish/merge/push calls in the conductor.
- Notification filters, durable attempt deduplication and recurrence; uncertain sends are not retried automatically.
- Explicit completed-step reruns require `--step --force --reason`; reason appears in append-only HANDOFF and commit trailers.

## Autonomous technical choices (not approvals)

1. Runtime state goes under Git's private common directory instead of dirtying worktrees. Stale recovery is serialized under an exclusive guard; unknown guard/lock states fail closed.
2. `max_budget_usd: null` means unset. Per-plan budget is conservatively divided over `max_steps`; attempted launches reserve their whole slice even if the outcome is uncertain. This is a cap reservation, not a cost measurement.
3. Defaults are one session and a 900-second observation timeout. A timeout/interrupt leaves the agent running and returns an inspection instruction, not an implicit retry.
4. No real Claude executable exists locally, so its flag set and observation protocol are guarded experimental interfaces, verified with fake runners only. No paid/model session was launched.
5. Spec revisions and the dependent repository-layout spec are review, never newly approved. Existing plan/step statuses and prior approvals remain in Git. ADR 0005 is proposed, not accepted.
6. A forced rerun names its target step to avoid ambiguity. It cannot bypass half-finished history, approvals, dirty/diverged state, or live locks/sessions.
7. The user-authorized experimental stack will branch from the development tip without merging. No dependency is falsely recorded as merged and global `wait_for_merge` policy remains unchanged.

## Verification in progress

Initial expanded full run exposed one human-output ordering assertion, fixed by appending attention count rather than inserting it mid-line. Dedicated fake loop/alert tests passed (18 cases). The expanded full run then reached specification pin checks, which correctly failed while amended files were uncommitted; mechanical pin refresh follows the implementation commit. Final verification results are recorded in a subsequent commit, not inferred here.

## Remaining verification limitations

Real Claude background launch/resume/JSON schema and monetary budget enforcement cannot be verified without a supported installed Claude CLI. All current session execution tests use fakes. Environment integration and migrated consumer representative tests are separate work; no end-to-end completion is claimed here.

## Verified conductor checkpoint

- Development implementation: `de7cbe8`; dependency pins: `a9d6fa6`, `a409999`.
- Full CLI suite after complete init defaults: **316 passed, 0 failed**.
- Hook tests: **73 passed, 0 failed**; template sync passes; all spec pins current.
- Validation: **0 errors, 25 warnings** (5 identifier heuristics, 19 overlay heuristics, 1 absent ignored local settings file). No warnings suppressed.
- `specplane generate` reports `Unchanged plans/PLANS.md`; plan statuses and step statuses remain exactly as inherited.
- Focused gate/session/loop/alert/step recording suite: **43 passed**. These are real filesystem/git and fake-harness tests, not live Claude/model evaluations.
- User-authorized experimental branch stacking is next. This checkpoint is verified implementation, not a plan-finalization or real Claude compatibility certification.

Post-check correction: harness notifications now emit a local stderr alert (injectable in tests), without invoking Claude or changing settings. This is a local notification, not an external delivery guarantee.
