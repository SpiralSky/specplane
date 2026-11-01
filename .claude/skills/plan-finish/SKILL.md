---
name: plan-finish
description: Run the finish flow for the current plan. Use when the user runs /plan-finish.
argument-hint: "[plan-id]"
disable-model-invocation: true
---
<!-- specplane-contract: architecture/agent-skills#plan-finish@74958ce -->

# plan-finish

Runs the finish flow for the current plan (the `plan-finish` workflow integration).

## Preconditions

1. **Specplane configured**: if `.specplane/config.yaml` does not exist at the repository root (an `AGENTS.md` alone does not count), say "This repository is not set up for Specplane. Run `specplane init --harness claude`." and stop.
2. **CLI availability**: run `command -v specplane`. If present, use the CLI for resolution, validation, and plan flows. If absent, follow the same rules by hand from the format and flow specs (`architecture/agent-skills` § Config resolution in skills) and say once that the CLI was not found. For `/validate` without the CLI, check frontmatter and IDs by hand against `architecture/file-formats` and label the result "manual check". `/plan-finish` without the CLI runs its manual mode (labelled "manual mode: no stale-base or divergence checks").

Resolve every spec, plan, and ADR path from config (`.specplane/config.yaml`), never from hardcoded paths.

## Policy check

Read `config.plans` and `config.execution` before finishing.

- If the CLI is unavailable: run the manual sequence below, labelled "manual mode: no stale-base or divergence checks".
- If any step of the plan is not `done` or `skipped`: stop and report which.

## Steps

1. Identify the plan: the plan ID in `$ARGUMENTS`, else the current git branch `plan/<id>`.
2. Confirm with the user: "Run finish flow for `<plan-id>`?" In attended sessions use `AskUserQuestion`. In unattended sessions proceed only if the session was explicitly started to finish the plan.
3. Invoke `specplane plan finish <id>` (readiness checks, verification, rebase, final commit, PR or merge). Verification lists the open `spec-gaps.md` entries; open entries never stop the flow.
4. When verification asks for acceptance-criteria confirmation, check each criterion and state the evidence. Report the open `<plans.dir>/<plan-id>/spec-gaps.md` entries it listed (ID, kind, target spec) so they are reviewed, and say that they do not block the merge.
5. The plan's handoff log is `<plans.dir>/<plan-id>/HANDOFF.md` (resolve `plans.dir` from config); it is committed on the plan branch and moves with the plan when archived. Do not touch the repo-root HANDOFF.md.

**Manual mode (no CLI).** Instead of step 3, print "manual mode: no stale-base or divergence checks" once and follow this sequence (the finish flow's order, for the two merge modes only). Stop and tell the user to install the CLI when the plan is stacked on another plan or `plans.status_source` is `frontmatter`, since those need the stack and claim logic.

1. Check that the branch is `plan/<id>`, `git status --porcelain` is empty, and every step is `done` or `skipped`.
2. Run `plans.test_command` in the checkout when it is set; list the acceptance criteria and open `spec-gaps.md` entries as in step 4.
3. `git fetch origin` when a remote exists, then `git rebase <default>`; on a conflict run `git rebase --abort` and stop. Re-run the tests when the rebase applied new commits.
4. Set `status: done` in `<plans.dir>/<id>/PLAN.md`; when `archive_done` is true run `git mv <plans.dir>/<id> <plans.dir>/archive/<id>`; stage the plan folder and commit:
   ```
   chore(specplane): finish <id>

   Specplane-Workflow: finish
   Specplane-Plan: <id>
   Specplane-Agent: <$SPECPLANE_AGENT, else claude-code>
   Specplane-Session: <$SPECPLANE_SESSION; omit when unset>
   ```
   followed by the `Co-Authored-By` attribution trailer.
5. `pull_request`: `git push -u origin plan/<id>`, then open the pull request (`gh pr create --base <default> --head plan/<id> --title "chore(specplane): finish <id>"`), or print the push command and PR instructions when no forge CLI is available. `local_merge`: confirm with the user, then in the main checkout `git merge --no-ff -m "Merge plan/<id>" plan/<id>`, then `git worktree remove <checkout>` (worktree backend) and `git branch -d plan/<id>`.

## Output

The result: PR URL, merge confirmation, or the error that stopped the flow and what to do about it.
