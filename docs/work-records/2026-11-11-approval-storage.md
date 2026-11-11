# Approval and status records out of spec files (2026-11-11)

User decisions (2026-11-11):
- Approval status and other Specplane-computed state move **out of the spec files**. The user accepted that records kept beside commits need explicit syncing and can be lost on hosts that drop them.
- **Requirement files are always approved.** They never need approval, never carry a status, and never make a citing spec `unapproved-dependency`. A change to a cited requirement part still makes the citing spec outdated (`R11.2`).
- For now this repository is developed without running Specplane's own workflows (no `specplane spec approve`, no managed plans) on itself.

Requirements page cites: `R11` (status bound to committed content, records the commit it was set on, survives rebase and squash merge), `R11.1`, `R11.2`, `R11.3`, `R40` (metadata calculated and attached to git commits), `R16`, `R17`, `R17.2`, `R36.2`, `R61`.

## Design (technical choices made by the agent)

1. **Store.** Records live in git notes under the ref `refs/notes/specplane`. A record is attached to the commit it was set on: for an approval, the last commit that changed the spec's content (today's `approval.commit`). A note holds a YAML list of records, so several specs approved on one commit share a note; writers append and never rewrite earlier records. Record kinds: `approval`, `reopen`, `override`, `test-result`, `implementation`. Every record has `spec` (spec ID), `kind`, `by` (author item), `date`, `fingerprint` (spec-v3 or plan-v1 of the content it applies to), and kind-specific fields (`cited` map for approvals, `note`, override mark, test fields from today's `§11`).
2. **Lookup by content, not by commit.** The effective status of a spec at HEAD is computed from the committed content fingerprint and the whole notes ref, not only notes on reachable commits. A record applies when its `spec` and `fingerprint` match the spec's current committed fingerprint. Among applicable records the newest (by `date`, then note order) decides: `approval` or `override` → approved (subject to the `cited` checks of today's `§4.5` step 3); `reopen` → awaiting-review. Because lookup is by fingerprint, approval survives rebase and squash merge whenever the notes ref is present, and each branch's state follows its committed content (`R40`).
3. **Spec files keep author-written metadata only.** Frontmatter keeps `id`, `title`, `authors`, `covers`, `implements`, `references` and unknown keys. `status`, `approval`, `review-reason`, `results`, `implementation` are removed from the format; if present they are a validation warning (legacy) and ignored. The `spec-v3` fingerprint keeps excluding the five removed keys so legacy files hash the same after migration.
4. **Requirements.** A requirement file is effectively approved at all times. It needs no frontmatter. `§4.5` step 4 (`unapproved-dependency`) skips requirement files; step 3 (cited-part outdated) still applies to requirement parts.
5. **Plans.** Plan approval uses the same store with `plan-v1`. To close review item 6, `plan-v1` covers PLAN.md plus every step file; `progress.yaml`, HANDOFF.md and `spec-gaps.md` stay outside it.
6. **Sync.** `specplane init` adds `+refs/notes/specplane:refs/notes/specplane` to the fetch refspec and documents `git push <remote> refs/notes/specplane`. Notes merge uses `git notes merge -s cat_sort_uniq`, which is safe because records are append-only. Validation warns when the local notes ref is behind the remote one or the remote has none while local records exist.
7. **Writes.** Approve, reopen, override, test results and implementation status write a notes commit only; they never create a commit on the branch and never touch the spec file. The audit log entry is unchanged.
8. **Migration.** One-time: `specplane migrate status` (or a script for this repo) converts every existing frontmatter `approval` block into an `approval` record on its `approval.commit` (falling back to HEAD with the recorded fingerprint) and deletes the five keys from the files in one commit.

## Specs to change
- `architecture/file-formats`: `§1.2`, `§2` (fields, status computed, approval block, overrides, review reason), `§4.4`, `§4.5`, `§5.2`, `§11` (results and implementation move to the store); new section for the notes store and record format.
- `architecture/reference-cli`: approve/reopen/override/meta/test/implementation commands write records; validate checks; init sync config.
- `architecture/repository-layout`: mention the notes ref.
- `features/specifications`: `R11`/`R11.1` wording "metadata attached to commits", requirements always approved; `features/cli` R16/R17 where they say the record is in the file; `features/verification` where results are "in the spec's metadata"; `features/plans` R29 plan fingerprint scope.
- Harness specs only where they describe the frontmatter approval block.

The requirements page itself is not edited.
