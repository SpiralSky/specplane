# CLI step 2 notes: human approval and metadata commands

Written 2026-11-09. Scope: `spec approve`, `spec reopen`, `spec meta get|set`, `spec override status|approver|test`, `role show|switch`, the minimal permission engine they need, and audit entries. Not done: requests (`reference-cli` §8), plans, `spec list/show` rewrite, `warnings`, `coverage`, `test run`, `audit` reader, `config`, `permissions` listing, harness-side approval.

## Code

`spec/human.ts` (all operations, takes an `Authorized` token path through `perm/permissions.ts`), `spec/fm-edit.ts` (textual edit of top-level frontmatter keys, keeps comments and other keys byte for byte), `spec/results.ts` (current failed results, R61.1), `perm/permissions.ts` (catalog IDs, the four presets, `mode`, `guard`, role switch file), `audit/log.ts`, `repo/store.ts`, `commands/spec-human.ts`, registration in `cli.ts`. Tests: `spec/human.test.ts` (22). Mutating commands run under the existing checkout writer lease.

Removed: CLI `spec pin` (base pins are not in the new format) and the old `spec approve`/`reopen` registration; `commands/spec-approve.test.ts` and the "spec pin --check" integration test. The old `commands/spec-approve.ts` stays only because `core/confirmed-operations.ts` (old harness path) still imports it. `commands/coordination.test.ts` fixture moved to the new spec format.

## Assumptions and deviations

- **Requests.** Under `request-user` (LLM role in the default presets) the guard refuses with a message that requests are not available yet and audits `refused`; no request is created. The CLI itself always runs as a human, so this only shows in unit tests.
- **Who approved.** Only git `user.name` (`git config`). No fallback to env or OS name. An LLM actor can never approve from the CLI, even with `allow`, because no human identity exists (the LLM `by` form with `delegated-by` is not written by the CLI).
- **Approval of an effectively approved spec** does nothing, including a hand-format approval without `fingerprint`/`cited`. `file-formats` §2.3 says the next approval records them; `cli R16` says re-approving does nothing. To record them, reopen first. Not resolved here.
- **Review reason on reopen** is `edited`: the grammar (`file-formats` §2.5) has no "reopened".
- **`override status awaiting-review`** has no approval block to carry the override mark, so it is only recorded in the audit log (`override.status` entry with old and new).
- **Title, `covers`, `references` in the fingerprint** (`file-formats` §4.2) conflict with `cli R17` ("a change to metadata alone does not make a specification Awaiting Review"). `meta set title|covers|references` follows the architecture: the stored status stays, the effective status becomes `awaiting-review (edited)`, and the command prints a note when that happens. Authors and the approval date and commit do not change it. Spec problem to settle.
- **Granular pieces.** `implements` has no granular permission in `file-formats` §7.1; it needs `meta.write`. `meta set` accepts `title`, `authors`, `references`, `covers`, `approval.date`, `approval.commit`. Authors syntax: `human:<name>` or `llm:<model>`, optional `|<contribution>`, comma separated.
- **Overrides.** `override status approved` writes a normal approval (real `fingerprint`, `cited`, content `commit`) plus `override: {by, date}`, and needs committed content. `override approver` takes `human:<name>` or `llm:<model>@<human>`. `override test <id> <test> passed|failed|clear` writes a result with `against: {}`, the HEAD commit and fingerprint and the override mark; `clear` removes all results of that test.
- **Test results.** Latest current result per test decides; a result is current when its `fingerprint` (and each `against` entry) matches now.
- **Permissions in audit.** For granular writes the audit `permission` is the one that decided (`meta.write.<piece>` first). Reads (`meta get`) are guarded by `meta.read`, not `info.retrieve`. Only the guard decision and the result are audited; the command runner entry for every command (reads included) and audit retention are not done.
- **Commits.** `docs(specs): approve <ids>` (or `approve <n> specs` when long) with workflow `approve`; reopen, meta and override use workflow `spec`. `--no-commit` stages. A file with other uncommitted changes is written but not committed (§13.4); approve refuses such a file instead.
- **Group confirmation** without a terminal and without `--yes` refuses (as assumed in §5.3). The lease is held while the prompt waits.
- **Exit codes.** 0 success, 1 refused or failed; usage errors from commander use its own code. Codes 3 and 4 of §13.3 are not implemented.
- Active preset is read from `permissions.preset` in `.specplane/config.yaml`; unknown or missing gives preset 1.
- `spec meta set` validates `approval.commit` as an existing 40-hex commit and cites by syntax only (validation reports unresolved cites).
