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

## Step 02: Feature-spec proposals for tooling and plan-steps

**Date**: 2026-10-29
**Outcome**: done

### What changed

- `plans/2026-10-29-cli-plan-flows/feature-spec-proposals.md`: new; three proposals with quoted current text, proposed text, and reason: (1) `plan restack <id>` for `feature/tooling` with `--dry-run`, exit codes and errors; (2) `feature/plan-steps` HANDOFF behaviour when a `blocked` step is re-run (append a new section, latest wins, aligned with `architecture/file-formats` §4.1); (3) neutral replacements for the `src/...` examples that trip the leak guard (6 warnings).

### Deviations from the plan

None.

### Gaps found in specs

- `feature/plan-steps` does not say whether a re-run blocked step gets a second HANDOFF section; `architecture/file-formats` §4.1 does. Proposal 2 closes it.

### Open issues

- `feature-spec-proposals.md` needs user review; no feature spec was modified.

### What the next step must know

- The proposals file is `plans/2026-10-29-cli-plan-flows/feature-spec-proposals.md`: needs user review before any feature spec edit.
- CHOICE: neutral example paths are slash-free names (`CONTRIBUTING.md`, `STYLE.md`), because the guard flags any path containing a slash, not only `src/`.
- CHOICE: proposed `plan restack` errors: plan not found, "Cannot restack: `<id>` is not stacked.", and conflicts exit 1; `--dry-run` included per tooling general conventions.
