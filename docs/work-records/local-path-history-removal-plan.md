# Plan: remove machine-specific local paths from published Git history

Status: proposed maintenance checklist; execution not started.

This file records the requested remediation work. It is not a managed Specplane
implementation plan, does not grant lifecycle approval, and does not authorize a
history rewrite, force-push, branch deletion or repository visibility change.

## Objective

Replace identifying, machine-specific absolute paths in published repository
content with portable references, including affected historical versions.
Preserve code behavior, useful diagnostic context and unrelated local work.
Prevent future work records from publishing machine-specific paths.

## Known findings and scope

The audit of the push ending at `3a5b997` found identifying local paths in:

- `docs/work-records/2026-11-01-conductor-disposition-review.json`
- `docs/work-records/2026-11-01-implementation-proposal-review.json`
- `docs/work-records/2026-11-02-core-foundation-bootstrap.json`

An architecture document also matched a generic home-path pattern; distinguish
portable examples from real identifying paths before deciding what to replace.
The initial scan covered 221 new file blobs in the 31-commit push, not the entire
repository history. Expand the inventory before determining rewrite scope.

Do not repeat the original identifying paths in this plan, public reports,
replacement examples, commit messages or test fixtures. Keep the exact-match
inventory and replacement map outside tracked content in a protected location.

Personal email addresses in commit metadata were a separate finding, already
present in earlier history. Removing email addresses, internal development notes
or any other category of information is outside this plan unless separately
requested. No credential rotation is implied by the path-only finding.

## 1. Inventory and coordinate

- [ ] Fetch and enumerate relevant remote branches, tags and other accessible
  published references; record exact remote tips without changing them.
- [ ] Inspect all reachable historical file versions, filenames, commit/tag
  messages and relevant metadata for identifying machine paths. Do not limit
  the search to current files or the initial pushed range.
- [ ] Classify matches as identifying paths, portable examples or intentional
  runtime/test paths. Specify replacements for identifying content only.
- [ ] Identify active local/cloud workers, open pull requests, clones and
  worktrees that could reintroduce old history. Arrange a maintenance window
  before executing the rewrite; do not interrupt ongoing work without authority.
- [ ] Prepare a concrete list of affected refs and proposed replacements for
  human review. Do not silently broaden scope to email or other information.

## 2. Preserve recoverable state

- [ ] Save a verified backup of original refs and objects outside the repository
  and outside any public artifact location. This backup retains the original
  information and must remain private.
- [ ] Separately preserve uncommitted changes, untracked work records and the
  target-lifecycle worktree's partial implementation with hashes and base refs.
- [ ] Preserve the old conductor branch/worktree and other existing checkouts;
  do not delete them as a side effect of cleanup.
- [ ] Perform the rewrite rehearsal in an isolated clone. Never begin with the
  dirty working checkout or assume a Git bundle includes uncommitted files.

## 3. Rehearse redaction and reconcile references

- [ ] Replace repository file locations with repository-relative paths. Identify
  checkouts by plan ID and branch; use `<workspace>` or `<worktree>` placeholders
  where an absolute-path diagnostic example is necessary.
- [ ] Use a reviewed Git history-rewriting tool in the isolated clone to apply
  the approved replacements across every affected published ref.
- [ ] Preserve an old-to-new commit mapping privately. Inspect embedded commit
  references, spec dependency pins, contribution origins/corrections and
  execution bindings affected by rewritten objects. Preserve historical truth;
  do not manufacture review evidence or silently replace immutable provenance.
- [ ] Determine the supported reconciliation for each affected reference before
  publication. If any cannot be preserved or truthfully reconciled, report the
  exact limitation and obtain a decision rather than bypassing it.
- [ ] Verify that only approved path redactions and necessary, separately
  justified reference reconciliation changed content. Validate JSON/Markdown,
  repository consistency and relevant tests when executable content is affected.
- [ ] Scan all rewritten reachable history again for the approved identifying
  patterns, including intermediate commits and tags, not merely the final tree.

## 4. Approve and publish the reviewed rewrite

- [ ] Present the replacement summary, ref list, expected remote tips, rewritten
  tips, validation results, provenance implications and rollback procedure.
- [ ] Obtain explicit authorization for the exact history rewrite and required
  non-fast-forward remote updates. This checklist is not that authorization.
- [ ] Recheck remote tips immediately before publication. If another writer has
  advanced a ref, stop that update and reconcile; do not overwrite newer work.
- [ ] Update only the approved refs with lease protection appropriate to the
  reviewed state. Do not use an indiscriminate mirror push or delete unrelated
  refs. Report partial publication accurately and preserve recovery evidence.
- [ ] Verify the published refs and scan a fresh clone of the rewritten history.

## 5. Reconcile retained copies and prevent recurrence

- [ ] Coordinate clone/worktree migration so old commits are not merged or
  pushed back. Reapply preserved local work against the rewritten bases with
  reviewed patches; avoid restoring the original ancestry unintentionally.
- [ ] Identify pull-request refs, cached views, forks and external clones that
  may retain originals. Check the hosting provider's current cleanup procedure
  and report what can and cannot be removed. A branch rewrite alone is not a
  guarantee that every external copy has disappeared.
- [ ] Keep machine-specific runtime state in untracked local storage. Use
  portable paths in shared handoffs and work records.
- [ ] Add a narrowly scoped check for identifying home-directory paths in
  documentation/work-record changes, with explicit treatment of generic
  examples. Confirm it detects a synthetic identifying path without introducing
  the real path into a tracked fixture.
- [ ] Record final verification, remaining exposure and backup retention policy.
  Do not destroy private backups or retained worktrees without explicit approval.

## Completion criteria

- Approved identifying paths are absent from all rewritten published history
  within the agreed ref scope, verified from a fresh clone.
- Repository behavior and required reference/provenance integrity are preserved,
  or every unresolved limitation has been explicitly accepted and documented.
- Unrelated work is preserved and active checkouts have a migration procedure.
- Remaining copies outside the rewritten refs are disclosed accurately.
- Shared documentation uses portable references and a recurrence check exists.

Until these criteria are met, report the work as pending or partially remediated;
do not equate deleting paths from the latest files with removing them from history.
