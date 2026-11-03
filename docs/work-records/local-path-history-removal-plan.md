# Remove machine-specific local paths from published Git history

Status: **approved branch-history cleanup published and verified on 2026-11-03**. No claim is made that every external clone, fork or hosting cache has been erased.

This is the maintenance record, not a managed Specplane implementation plan. The user approved the exact three remote replacements before publication. No plan/spec lifecycle states were changed.

## Scope and result

The expanded inventory inspected five advertised origin branches: 304 commits and 1,564 distinct historical file blobs. Identifying home paths occurred in three blobs, in:

- `docs/work-records/2026-11-01-conductor-disposition-review.json`
- `docs/work-records/2026-11-01-implementation-proposal-review.json`
- `docs/work-records/2026-11-02-core-foundation-bootstrap.json`

Those paths now use portable workspace/worktree placeholders. The generic home-path example in `architecture/repository-layout` was retained. Commit emails are normal attribution and were explicitly excluded from cleanup by the user; the Gmail address was found only in commit metadata, not tracked file contents in the inspected history. Generic cloud paths, legitimate test paths and useful review evidence were not indiscriminately deleted.

The initial bounded credential/private-network pattern scan found no matches. This is not an exhaustive secret audit. Exact identifying paths and the replacement map are stored only in the private backup, never in this record or tracked fixtures.

| Remote branch | Previous tip | Approved rewritten tip |
| --- | --- | --- |
| `dot/codex-integration-20261101` | `3a5b997` | `958973c` |
| `overnight/specplane-20261102T144630Z` | `ae326ef` | `2175faf` |
| `snapshot/specplane-overnight-inputs-20261102` | `e12fd62` | `024562c` |

`main` and `dot/complete-framework-20261031` were unchanged. Preparation commits may subsequently advance the overnight branch normally; the table records the exact approved rewrite transaction.

## Verification and preservation

- Original refs/history were saved in a verified complete Git bundle. Uncommitted files were backed up separately. Backups are outside the repository, owner-readable only, at `~/.local/share/specplane/history-backups/2026-11-03/`.
- Rehearsal used an isolated mirror and `git filter-repo`, preserving commit messages and emails. Every one of the 126 changed commit trees was compared against its original: only the approved literal path substitutions occurred, and affected JSON parsed successfully.
- Embedded old commit references were inventoried in 73 current files. These are retained as historical evidence, with the private commit map identifying their rewritten equivalents. No immutable provenance was silently re-authored; current dependency-pin checks passed. The scan found no changed-ID references in current specification files; the plan-side match was the archived core HANDOFF.
- An open-PR search returned no open pull requests. Ref leases protect against concurrent advancement; no claim is made about unknown external workers or clones.
- The three replacements were pushed atomically with explicit expected-tip leases. No other refs were deleted or updated.
- A fresh remote mirror verified all five advertised tips and scanned all 3,779 reachable objects for the approved identifying patterns: no matches remained.
- The active checkout moved to the rewritten overnight baseline. All 13 preparation file hashes matched after migration. Its temporary stash was dropped only after verification.
- Existing plan worktrees and the old local integration branch were retained. They contain old ancestry and must not be merged or pushed back into cleaned history. Reapply any genuinely unique work as reviewed patches on a clean base.

Full machine-readable verification: `2026-11-03-path-cleanup-result.json` in this directory. Original IDs inside historical reports refer to pre-rewrite history, not to newly verified executions at rewritten IDs.

## Recurrence prevention

`scripts/check-personal-paths.py` scans tracked documentation for identifying Unix/macOS/Windows home paths without echoing the private path. It permits explicit generic example usernames and portable placeholders. CI invokes it. Self-tests and an isolated Git-repository check verified rejection of a synthetic identifying path and acceptance of generic examples and emails. No real identifying path was added to the fixture.

Runtime state belongs in local private storage. Shared handoffs use repository-relative paths or portable placeholders. Commit email metadata remains permitted; unnecessary personal email in documentation should be reviewed separately.

## Remaining external-copy limits

The remote branch history and active checkout are clean within the verified scope. Old local retained branches, private backups, other clones, forks, cached commit views and inaccessible pull-request references may still retain original objects. Do not delete private recovery material or retained worktrees incidentally.

GitHub's [sensitive-data removal guidance](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository) distinguishes ref rewriting from removal of cached views and other copies. GitHub may decline non-sensitive-data cleanup. No support request was sent. Coordinating other clones or requesting cache removal remains optional follow-up requiring the relevant owner/provider; it does not block implementation on the cleaned review branch.

No further force-push is authorized by this record. Any new rewrite needs its own concrete review and authorization.
