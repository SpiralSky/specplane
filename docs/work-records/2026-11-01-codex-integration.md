# Codex / Dot integration development record

## Branch relationship and authority

`dot/codex-integration-20261101` is an isolated worktree at `repos/specplane-codex`, based directly on development tip `710bbd1b209dc5dc9aff45fbee7e236a8963cd36`. This is the user-authorized experimental unmerged stack; no dependency is marked merged, no global policy is changed, and no plan/spec/ADR is promoted. The new architecture spec is draft.

## Implemented

- Explicit Codex/Dot CLI workflow skill and managed AGENTS.md integration.
- Explicit neutral init mode that suppresses Claude auto-detection.
- Preservation of existing custom skill, unrelated AGENTS.md content, Codex/Claude settings, and permissions.
- Codex template packaging and idempotency.
- Clear refusal for unsupported Codex background sessions, including automatic selection when the Codex skill is installed; no fallback to Claude flags or safety bypasses.
- A documented manual experimental workflow under explicit user authorization, with real CLI validation, isolated git worktree, implementation, tests, and development commit while draft plan/spec records remain unchanged.

## Verification and limits

Local `codex --version` reported `codex-cli 0.166.0-alpha.1`. Read-only help confirmed exec/resume capabilities, but it also reported inability to create PATH aliases on a read-only filesystem. No Codex/model session was launched, no restricted session storage was read, and no environment configuration was changed. Native Dot MCP integration is not established by this harness.

Initial full suite passed 321/321 tests. Additional path-containment and packed-Codex delivery checks are being run before the final verification checkpoint. Real model/background success remains unverified; representative tests use the current execution environment plus ordinary git/Node, not a pretend model run.

## Verified integration checkpoint

- Full suite: **322 passed, 0 failed**, including the installed tarball, both harnesses, path containment, and the representative experimental implementation/test/commit workflow.
- Validation: **0 errors**; current warnings are inherited heuristics/reference warnings plus the new skill contract marker pending mechanical pin insertion.
- All specification dependency pins current; Claude template sync passes.
- The representative test verifies ordinary draft plan gating separately from actual manual experimental execution. The draft PLAN.md and feature spec remain byte-identical; the baseline checkout commit is unchanged while only the experimental worktree gets code/tests/decision log and a commit.
- No normal plan completion status was promoted and no model execution, permission/configuration change, merge, or remote publication occurred.

Final mechanical contract pin inserted and full suite rerun: **322/322 passed**. Final validation: **0 errors / 25 warnings** (same inherited heuristics/reference warnings as the development checkpoint). Dependency pins current, Claude template sync and **73/73 hook tests** pass, and generation reports unchanged PLANS.md. No real model run or monetary measurement is implied by these results.

### Consumer contract verification correction
The migration consumer exposed an upstream skill-contract ID absent from its own spec roots. The package now carries only the Codex contract snapshot (not installed into consumer specifications). Validation uses it only for a registered harness's own installed skill and only when the local ID is absent, verifying the exact Git blob hash and heading. Local contracts and ambiguous IDs are never bypassed. Tests reject altered pins/missing headings and preserve local precedence. No validation warnings are suppressed wholesale; unrelated Claude freshness warnings remain visible. This is an autonomous experimental consistency correction, not approval.

Post-correction verification: 324/324 CLI tests, 73/73 hook cases, sync OK; validate 0 errors/25 existing warnings; generation unchanged. The integration stack remains based on development 710bbd1; the identical local-notify correction subsequently committed as development 13660b4 is applied independently here, without merging branches. No plan/status/approval changes and no live model calls.
