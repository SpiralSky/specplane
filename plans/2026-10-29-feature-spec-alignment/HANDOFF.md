# HANDOFF — 2026-10-29-feature-spec-alignment

## Step 01: Architecture spec edits for reference-cli and file-formats

**Date**: 2026-10-29
**Outcome**: done

### What changed

- `docs/specifications/architecture/file-formats.md`: §3.2 and §4.1 make the latest HANDOFF section per step authoritative (repeated sections for re-run `blocked` steps); new §4.2 `spec-gaps.md` format (entry heading `## G<n>: <case>`, six fields, kinds, statuses, unique never-reused numbers, `feature-spec-proposals.md` left unvalidated); §6.2 ADR rules with the `feature/decisions` texts (id/filename, missing or unknown `superseded_by`, `superseded_by` warning on a non-superseded ADR, cycles).
- `docs/specifications/architecture/reference-cli.md`: config spec root path checks and the `worktree_dir` message (worktree backend only); ADR checks and cycle reporting; `plan/gaps.ts` (`parseGaps`, validation messages); latest-section HANDOFF check; stack-mode `blocked` in `getIndexStatus` plus `blockedReason`; abandon from `done`/`abandoned` fails; `--no-fetch` on start and finish; finish flow lists open `spec-gaps.md` entries; restack output, errors, and `--dry-run` commit listing; `search --kind`.
- `plans/2026-10-29-feature-spec-alignment/spec-gaps.md`: created with G1.

### Deviations from the plan

Acceptance criterion 4 is not ticked: `specplane spec pin --check` exits 1, but only for `claude:architecture/claude-integration`'s stale pins on `claude:feature/claude-integration` and `feature/agent-integration`, which were stale on `main` before this plan started. No spec pins `file-formats` or `reference-cli`, and no skill contract marker names them, so this step had nothing to re-pin. Step 05 edits and re-pins `claude:architecture/claude-integration`. `specplane validate` passes (0 errors).

### Gaps found in specs

- G1 (assumption): no message text for a spec root path that is not a directory; used the Scenario 7 pattern. See `spec-gaps.md`.

### Open issues

None.

### What the next step must know

- Code changes now specified (steps 02–04): spec root path checks, `worktree_dir` message condition, ADR texts, `superseded_by` severity change to warning and cycle detection; stack-mode `blocked` in `plan/status.ts` and `blockedReason`; abandon guard; `--no-fetch` on `plan start`/`plan finish`; `search --kind` (rename from `--type`); `plan/gaps.ts`; latest-section HANDOFF check (current `handoffOutcomes` already returns outcomes per step in file order); finish-flow open-gaps listing; restack `--dry-run` commit lines.
- Behaviour change for restack: `restackPlan` currently aborts the rebase on conflict (`plan/flows.ts` ~line 619); `feature/tooling` and now `reference-cli` require leaving the checkout mid-rebase and listing the conflicting files. The finish flow still aborts.
- The stack-mode error text in code uses backticked IDs; the spec now says so.
