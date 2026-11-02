# Target lifecycle step 3 — result for review

Commit: d061fa5aefdb87bfe8635267aca515ab86680b4e (overnight/target-3)
Base: c3c2ac3e15f2f2abb5fcb968ac778a7f42ac9a46
Time: approximately 15:34–15:43 UTC, 2026-11-02. Working tree clean after commit.

## Criterion mapping

- List/show context and discovery: `target-report.test.ts` covers nondefault target, starting and comparison provenance, pending checkout edit, preserved show content, local and remote-only branches absent from invoking checkout, and divergent branch rejection. `activity.test.ts` covers live remote fetch/no-fetch. `plan.test.ts` covers list/show interfaces. Live fetch updates all origin heads once.
- Missing/offline and manual done: `target-report.test.ts` covers missing and divergent targets, legacy provenance and a done branch whose target remains ready. Reports expose refs, fetch result and reasons; shallow or unproven done history is unverifiable.
- Target-aware PR and integration evidence: `forge.test.ts` checks recorded PR base and exact merged head/base; `target-report.test.ts` checks that matching merge commit is present on target and rejects mismatched head or missing merge commit. Tests use stubbed gh, no live service.

## Verification

- Offline `npm ci --offline --cache /workspace/.npm-cache --no-audit --no-fund`: passed.
- `npm run build` and `node --test dist/plan/target-report.test.js dist/plan/activity.test.js dist/commands/plan.test.js dist/git/forge.test.js`: 35 passed, 0 failed. Local Git subprocess tests run with escalation and timeouts in the new fixture. Intermediate runs exposed and fixed absent branch-record handling.
- No unchanged full suite, live host, model call, publication, tag or push.

## Limits and follow-up

Squash/rebase integration is established only when a trusted forge returns the exact head and target and the merge commit is in locally available target history; otherwise it is unverifiable. Forge failure and no matching result are not proof of non-integration. Existing `planNext` and `mergedStackBase` paths still use older resolution and may provide ancillary attention notices based on default context. Fetch failure notice and successful ancestry integration do not have new dedicated focused tests, although existing activity tests cover fetching and the new suite covers integration evidence. Reports are not mutation authorization. No formal plan, HANDOFF, spec body, lifecycle status, or writer operation was changed; no core execution receipt was claimed.

## Review repair, 15:43–15:53 UTC

Additional commit: 06a68b9dafae9e35097c62088c72c64dade24f22 (parent d061fa5aefdb87bfe8635267aca515ab86680b4e); working tree clean.

- Committed target records supply stored status and target dependencies; committed config is loaded at branch/target revisions and conflicting path interpretation is rejected. Target identity and full schema are validated before status or integration evidence is used. `target-report.test.ts` covers dirty invoking records, different target dependency state, malformed and mismatched target records, and changed config paths.
- Show and activity use the same reconciled branch commit as the report; unstarted activity uses the reconciled target. Tests cover local-behind-remote branch and target, including steps and text.
- Both branch records are structurally validated, including declaration and target-change chain, before fallback context can be exposed; divergent snapshots fail explicitly. Unavailable historical object IDs remain inspectable with unverifiable integration. Tests cover malformed bindings, declarations, missing objects and divergence.
- Pending target compares working content against its own local branch record, with tests for clean and dirty checkouts behind remote. Human list includes pending target, fetch state and unverifiable reasons.
- Target-aware restack notice uses the selected target; attention for bound execution snapshots is explicitly unavailable until `planNext` resolves these snapshots correctly, avoiding misleading default-target advice. This is a deliberate read-side limitation, not a lifecycle write.

Final verification: `npm run build` followed by `node --test dist/plan/target-report.test.js dist/plan/activity.test.js dist/plan/context.test.js dist/commands/plan.test.js dist/git/forge.test.js`: 50 passed, 0 failed. Git tests were bounded and run with escalation; forge calls were stubbed. No full unchanged suite or live services were run.

## Follow-up review repair, 15:53–15:57 UTC

Additional commit: 22687bc08380b0e52503588c9b4216c483e8203c (parent 06a68b9dafae9e35097c62088c72c64dade24f22); tree clean.

- `planReport` preserves validated committed intended target and comparison when unstarted target refs are missing/divergent, with unverifiable reason; when a target record is available its comparison baseline supersedes the invoking hint. The new regression cases exercise missing/divergent refs and stale comparison hints.
- `planShow` resolves configured target records before requiring an invoking plan folder and presents an effective status derived from target dependencies and a target-specific PR lookup. Tests cover target-only plan content, ready status, and a stubbed matching PR yielding review.
- Build plus `node --test dist/plan/target-report.test.js dist/commands/plan.test.js dist/plan/activity.test.js dist/plan/context.test.js dist/git/forge.test.js`: 54 passed, 0 failed. Local Git tests were run with escalation and forge calls were stubbed. No live services or later lifecycle writers were used.
