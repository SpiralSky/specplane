# HANDOFF — 2026-10-29-cli-plan-flows

## Step 01: Architecture spec edits for restack and flows

**Date**: 2026-10-29
**Outcome**: done

### What was done
- `architecture/reference-cli` Restack: added the three triggers (explicit `plan restack`, finish step 4, resume message only) and the not-stacked failure.
- Module structure: `restack` added to the `commands/plan.ts` list; `harness/` annotated as belonging to the harness plan.
- Error classes: `PlanStateError` examples extended with the stacking and restack texts.

### Decisions
- CHOICE: resume message text is "Base plan `<base-id>` has merged; run `specplane plan restack <id>`." and resume continues.
- CHOICE: restack of a non-stacked plan throws `PlanStateError` "Cannot restack: `<id>` is not stacked."

### Gaps found
- `feature/tooling` has no `plan restack` command; documented as an extension depending on step 02's proposal.

### Open issues
None.

### Notes for next step
No spec pins reference `reference-cli`; `spec pin --check` and `validate` pass.
