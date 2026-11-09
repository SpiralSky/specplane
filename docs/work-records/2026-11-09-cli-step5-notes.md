# CLI step 5 notes: plans

Written 2026-11-09. Scope: the plan record, plan commands and plan execution of `plans`, `plan-execution`, `file-formats` §5, §7.1, §8, §9, `repository-layout` §3 and `reference-cli` §11. Specs were not edited.

## Code

New `packages/cli/src/plan/`: `model.ts` (parse the record), `validate.ts` (rules, hooked into `specplane validate`), `ctx.ts` (guard, audit, local store, worktree map, run marker, commit helper), `status.ts` (effective plan approval and status, next step, selection check), `create.ts` (scaffold, approve), `run.ts` (start, step-done, stop, resume, budget, retarget), `finish.ts` (review, finish, merge, abandon, delete); `commands/plan-cli.ts` registers `specplane plan ...`. Tests: `plan/plan.test.ts`.

The old plan system moved to `src/legacy-plan/` (git mv). It is no longer registered in the CLI; it stays only because the old operation engine (`core/*`, `harness/claude-mcp*`, `commands/plan.ts`, `commands/plan-approve.ts`, `generate/*`) imports it, and that engine is replaced in the harness step. Old tests that exercised the old CLI plan flows (start, finish, restack, shelve, retarget, PLANS.md index, stacking, step-done with blocked/skipped) were deleted with the codex experimental-workflow tests that drove them.

## Fixes outside plans

- `plans.worktree_dir` had kind `path` ("inside the repository"), which contradicted `repository-layout` §3 (outside the project). New setting kind `outpath`: absolute or relative to the main checkout; a value that resolves inside the project is refused when a plan starts.
- `harness/conformance-matrix.ts` pointed at deleted suites; those entries were removed.
- `assets/docs/topics/workflows/plans.md` example no longer uses `--no-fetch`.

## Assumptions and deviations

- **Permissions.** `plan create`, `approve` (`spec.approve`, a person only), `start`, `stop` (`plan.softstop`, any kind), `resume`, `budget`, `retarget` (`plan.resume`), `finish`/`merge` (`plan.complete`), `abandon`, `delete`; `list`, `status`, `next`, `review` need `info.retrieve`. `plan step-done` needs no permission (the catalog has none; it is part of the run). `request-user` is refused with an audit entry `refused` (requests are a later step). Every command is audited `done`, `refused` or `failed`.
- **Plan approval.** `plan approve <id>` applies the spec approval flow to PLAN.md with `plan-v1` and a `cited` map of `references`. Effective approval is computed from HEAD (edited, or outdated cite).
- **Where a plan's files are live.** After start, `progress.yaml`, handoff and step records are written and committed in the plan's worktree, on `plan/<id>`. Commands run from the main checkout find the worktree through `worktrees.json` checked against `git worktree list`. The main checkout keeps its `not-started` copy until the merge, so `plan list` without `--live` shows `not-started` for a started plan.
- **Run marker.** `start` and `resume` write `runs/<id>.json` with `pid: null` (the CLI process ends at once); only the five-minute heartbeat rule applies. `plan heartbeat <id>` refreshes it for adapters. A plan with all steps done and no live marker is reported in progress with the final review pending, not stopped.
- **step-done.** Requires the next step, a latest handoff entry with the same outcome and all five sections; stages every change in the plan worktree (`git add -A` there) and makes one commit with workflow `step`, so the step's work and record are committed together. `partial` records the entry and commits without marking the step done. Clears the run marker when the last step is done.
- **Start.** Conditions are read at the target tip (committed content): plan Approved, specs in `implements` with mode `implements` and spec cites in `references` Approved, referenced plans completed (or named in `--force-deps`, recorded in a new HANDOFF.md note), cycles refuse. Setup runs through `sh -c`; failure removes worktree and branch.
- **Finish.** `--complete` needs a recorded review (`plan review`) and a clean worktree; it does not require every step done (the spec calls completion a declaration; the review lists unrun steps). Archive move and `progress.yaml` are in one commit `chore(specplane): finish <id>`.
- **Merge.** `--pr` runs `gh pr create` when available, else prints what to do (not tested: needs `gh` and a remote). `--local` is tested. A dirty plan worktree refuses the merge unless `--force`, checked before merging so the branch can be deleted.
- **Abandon/delete.** Refuse before any change when the worktree is dirty (no prompt; `--force`). Delete keeps the plan branch (the spec is silent; keeping avoids losing work). Delete uses workflow `delete`, which `file-formats` §8 does not list.
- **Legacy plans.** The 12 plans in this repository's `plans/` have no `progress.yaml`; validation reports one warning each ("retired plan format") instead of errors.
- **Plan edit.** There is no `plan edit` command; plan and step files are edited with ordinary tools. Not enforced: "a step's body is not edited once the step has started", and `plan.edit` is not used by any command.
- **Concurrency.** Plan commands do not take the checkout writer lease.

## Not done

Requests (blocking requests that soft-stop a plan, answers in the resume context), budget enforcement (`evaluate`, measurability, adapter side), harness actions and steering for plans, `plan.meta.*` permissions (later release), the harness adapter that keeps the run marker, `gh pr create` against a real remote, parallelism (later release), documentation rewrite of the bundled docs and skills that still describe the old plan commands.
