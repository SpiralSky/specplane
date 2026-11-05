# Final reconciliation checklist (prepare-only, 2026-11-05)

Nothing here has been run except the read-only checks marked "ran". Every mutating command needs the user's go-ahead.
Command names and flags were checked against `specplane <cmd> --help` (built `packages/cli/dist/cli.js`, HEAD `ada0ab1` plus S5 edits) and
`docs/specifications/architecture/reference-cli.md`. In this checklist `specplane` means `node packages/cli/dist/cli.js` run from the
named checkout (the CLI is not on PATH in this environment; after `npm run build` in `packages/cli`). Anything not verified is marked **UNVERIFIED**.

## 0. Facts found by read-only checks (ran, 2026-11-05)

- Integration branch is `dot/codex-integration-20261101` (`origin/HEAD`). This review branch is 143 commits ahead of it; neither plan branch (`plan/2026-11-01-core-foundation`, `plan/2026-11-02-target-lifecycle`) is an ancestor of this branch.
- Worktrees: `../.specplane-worktrees/specplane/2026-11-01-core-foundation` (`88d5492`) and `.../2026-11-02-target-lifecycle` (`c652ce5`, has UNCOMMITTED edits to `packages/cli/src/cli.ts`, `commands/plan.ts`, `commands/plan.test.ts`; preserve them). No worktree has the integration branch checked out.
- `plan start --dry-run --no-fetch --json`: `2026-11-02-completion-assessment` and `2026-10-30-plan-conductor` prepare (target `dot/codex-integration-20261101`); `2026-11-02-plan-index` refuses (dependency `2026-11-02-target-lifecycle` not done); `2026-11-02-target-lifecycle` refuses with "Legacy target history is ambiguous or repository default changed; recovery is required."
- `plan next --json` for `2026-11-02-target-lifecycle` and `2026-11-01-core-foundation` fails with "Authoritative target record is unavailable; reconcile target refs before resolving the next step." (core-foundation has no `PLAN.md` on this branch).
- Dependency chain: core-foundation -> target-lifecycle, completion-assessment; plan-index needs target-lifecycle; workflow-recording needs target-lifecycle + plan-index; manual-lifecycle -> workflow-recording; product-docs -> manual-lifecycle + completion-assessment + plan-index; extension-packaging -> product-docs; claude/codex-delivery -> extension-packaging; extension-conformance -> both deliveries. A dependency counts only when `done` (needs `plan finish`, which this checklist does not cover).

## 1. Decide first (user)

1. Where the implementation lives for recording. `plan step-done` records exactly the uncommitted working-tree changes in the plan checkout (branch `plan/<id>`) against a reviewed manifest. The implementation is committed on the overnight branch, not in the plan checkouts. How to move it into a plan checkout as an uncommitted, manifest-matching change set (for example merge the overnight branch into the integration branch first, or replay per-step diffs) is **UNVERIFIED**; the spec defines only the manifest, not a bring-over method. This is the user's decision.
2. The S6 and S7 bug checks are done (fixes `17f4551`, `6c9894f`); decide whether the open items in HANDOFF "Needs the user" (5, 13) must be settled before recording.

## 2. Repair "Legacy target history is ambiguous" (target-lifecycle, core-foundation)

- Cause (source `packages/cli/src/plan/context.ts:148`): a started plan branch with no execution binding needs trusted `legacyEvidence` `{originalDefault, record}` naming the repository default at start time; current config is never used to infer it.
- Command: **none found.** `legacyEvidence` is a library option of `prepareStart`/`firstStart` (`plan/prepare-start.ts:78`, `plan/first-start.ts:62`); `plan start`, `plan retarget` and `plan next` have no flag for it (`plan start --help`: only `--no-fetch --target --dry-run --json`). **UNVERIFIED** whether any supported CLI repair exists. Spec line `reference-cli.md:403` says legacy plans without that evidence "need explicit migration design". Treat as a user/design decision, not a command.
- Precondition for any later attempt: the original default branch is established from an independent record (not from reflogs or current config), and the user confirms it.
- Check it worked (read-only, safe now): `specplane plan start --dry-run --no-fetch --json 2026-11-02-target-lifecycle` prints a JSON plan instead of the ambiguity error; `specplane plan next 2026-11-02-target-lifecycle --json` returns a step.

## 3. Abandon the conductor plan

Precondition: a clean checkout of the integration branch whose HEAD equals the local branch tip, no other worktree on it; the plan stored status is not `done`/`abandoned` (it is `ready`); no active worker lease. `abandonPlan` requires a worktree with `branch == target_branch` and commits `chore(specplane): abandon <id>` there (`plan/flows.ts:915-929`).

```sh
git worktree add ../.specplane-worktrees/specplane/integration dot/codex-integration-20261101   # UNVERIFIED path choice; any clean checkout of the branch works
cd ../.specplane-worktrees/specplane/integration
git status --short                                    # expect empty
specplane plan abandon 2026-10-30-plan-conductor      # no --delete-branch / --force needed: no plan branch exists ("where none")
```

Check: `git log -1 --format=%s` is `chore(specplane): abandon 2026-10-30-plan-conductor`; `specplane plan list --live --no-fetch` shows it `abandoned`; `specplane validate` still has 0 errors. This writes a commit on the integration branch (not pushed).

## 4. Managed recording

Per step, from the plan checkout (`specplane plan start <id>` creates or resumes it; `--dry-run --json` is the read-only check). One manifest per step, outside the checkout, closed JSON `{"protocol":1,"head":"<40-hex HEAD>","branch":"plan/<id>","changes":[{"path","beforeDigest","afterDigest","purpose"}]}`; digests are sha256 of file bytes (`missing` for absent). Template:

```sh
specplane plan start <id> --no-fetch                  # first start only; precondition: dependencies done, plan ready
specplane plan next <id> --json                       # confirm "step" is the one you are recording
# put exactly this step's change set in the working tree, then write /path/outside/checkout/<id>-NN.json
specplane plan step-done <id> --step NN --outcome done --summary "<<=72 chars incl. prefix>" \
  --changed "<path>:<purpose>" [...one per manifest entry, same purpose text] \
  --recording-set /path/outside/checkout/<id>-NN.json \
  [--trailer "Co-Authored-By: ..."]
```

Refuses (before any write) when: any tracked or untracked change is missing from the manifest, a manifest entry does not match a `--changed`, partial staging, step already done (needs `--step NN --force --reason "<text>"`), or an earlier step is not recorded (HANDOFF order). Check each step: `git log -1` shows `feat(<slug>): <summary>` with `Specplane-Workflow: step`, `Specplane-Plan`, `Specplane-Step`; step file `status: done`; `specplane plan next <id>` moves to the next step; `git status --short` is clean. Manual manifests do not claim test receipts.

Order and readiness (state from HANDOFF.md Steps table):

| Order | Plan / steps | Ready to record? |
| --- | --- | --- |
| 1 | `2026-11-02-target-lifecycle` 02-06 (01 already `done` in its checkout) | Blocked on section 2 (start/next refuse) and on the dirty edits in its worktree being reconciled with step 02+ |
| 1 | `2026-11-02-completion-assessment` 01-03 | Ready to start (dry-run ok); needs the section 1 decision |
| 2 | `2026-11-02-plan-index` 01-03 | After target-lifecycle is `done` |
| 3 | `workflow-recording` 04 (and 01-03 per its checkout), `manual-lifecycle` 02-03, `product-docs` 01-03, `extension-packaging` 01-03, `codex-delivery` 01-03 | Implementation-complete; each waits for its dependency chain (above) to be `done` |
| 4 | `claude-delivery` 01, 02 | Offline-complete only; record with the "no live evidence" limitation stated in `--open-issue` or summary |
| - | `claude-delivery` 03, `extension-conformance` 01 and 02 | **NOT READY to record.** 03: criterion 1 unmet (no done result, no budget-stop evidence, no `$.process.spawn` binding), criterion 3 has no live evidence, D19 open. Conformance 01: criterion 4 blocked on live delivery evidence. Conformance 02: needs the user's implementation review and the pin refresh |

Also **UNVERIFIED**: whether steps 01-03 of workflow-recording (and other steps the Steps table does not list) were recorded; run `specplane plan list --live --no-fetch` (ran: shows `steps 0/4` for workflow-recording) and compare with the HANDOFF Steps table before recording.

## 5. Push (user confirms first)

Precondition: sections 2-4 done as the user wants, `specplane validate` 0 errors, full suite green via `cd packages/cli && npm test`, `git status --short` shows only `problems.md`.

```sh
git remote -v
git push --dry-run origin dot/codex-integration-20261101      # read-only preview; UNVERIFIED (not run here)
git push origin dot/codex-integration-20261101                # only after explicit user go-ahead; add the review branch only if the user asks
```

Check: `git ls-remote origin dot/codex-integration-20261101` equals `git rev-parse dot/codex-integration-20261101`. No force push, no history rewrite.

## 6. Optional cleanup (user, later)

Ask GitHub Support to purge unreferenced old commits with local paths (for example `3a5b997`); delete `../specplane-backup-prerewrite-20261104.git` once satisfied; keep `specplane-private-rewrite-20261103`.
