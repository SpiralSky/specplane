# HANDOFF — 2026-10-29-cli-forge-ci-publish

## Step 01: Architecture edits for ci

**Date**: 2026-10-29
**Outcome**: done

### What changed

- `docs/specifications/architecture/ci.md`: Job 1 prose trigger now matches the YAML (push to any branch, PR to `main`); Job 2 trigger prose states the path filter; YAML filter is `**/PLAN.md` plus `.specplane/config.yaml`; commit step uses `git add -A` instead of `plans/PLANS.md`; Path filter section explains the config-independent approach; `.gitattributes` snippet uses slash-free `PLANS.md`.

### Deviations from the plan

None.

### Gaps found in specs

None.

### Open issues

None.

### What the next step must know

- CHOICE: workflows must use `**/PLAN.md` and `.specplane/config.yaml` as the generate path filter and `git add -A` after `specplane generate`; never hardcode `plans/`.
- No spec or skill marker pins `architecture/ci`; `specplane spec pin --check` and `validate` pass (0 errors).
