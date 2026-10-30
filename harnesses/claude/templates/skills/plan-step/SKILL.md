---
name: plan-step
description: Execute the next step of a Specplane plan. Use when the user runs /plan-step.
argument-hint: "[plan-id] [--unattended]"
disable-model-invocation: true
---
<!-- specplane-contract: architecture/agent-skills#plan-step@dbfad2e -->

# plan-step

Executes the next step of a plan (the `plan-step` workflow integration).

## Preconditions

1. **Specplane configured**: if `.specplane/config.yaml` does not exist at the repository root (an `AGENTS.md` alone does not count), say "This repository is not set up for Specplane. Run `specplane init --harness claude`." and stop.
2. **CLI availability**: run `command -v specplane`. If present, use the CLI for resolution, validation, and plan flows. If absent, follow the same rules by hand from the format and flow specs (`architecture/agent-skills` § Config resolution in skills) and say once that the CLI was not found. For `/validate` without the CLI, check frontmatter and IDs by hand against `architecture/file-formats` and label the result "manual check". `/plan-finish` without the CLI stops and tells the user to install it.

Resolve every spec, plan, and ADR path from config (`.specplane/config.yaml`), never from hardcoded paths.

## Policy check

Read `specs.*` (authorship and `llm_role`) from config before editing any spec. Determine the session mode (below); follow `feature/spec-precedence`.

**Session mode.** The session is **unattended** if any of these holds, otherwise **attended**: `--unattended` appears in `$ARGUMENTS`; you are running as a subagent (launched through the Agent tool); the session is non-interactive (headless `claude -p`, scheduled or cloud routine, CI); the `AskUserQuestion` tool is not available. When unsure, treat the session as unattended. State the detected mode at the start of your output.

## Steps

`$ARGUMENTS` is `[plan-id] [--unattended]`: strip `--unattended`; any remaining token is the plan ID.

1. Identify the plan: the plan ID argument, else the current branch `plan/<id>`, else ask the user. If not on the plan's branch, warn before proceeding. If `origin/plan/<id>` exists, run `git fetch origin plan/<id>` first: fast-forward when it is ahead, and stop when the branches have diverged ("Another session advanced `plan/<id>`; reconcile the branches before running a step"). Only one session at a time works on a given plan.
2. Parse the step files; find the next step (lowest-numbered step that is not `done` or `skipped`). Ordering check: confirm every lower-numbered step is `done` or `skipped`; if any is `pending` or `blocked`, run that one first (or report its `BLOCKED:` issue) rather than the step the user named. If it is `blocked`, report its `BLOCKED:` issue and stop. If there is none, report that all steps are done and suggest `/plan-finish`.
3. Load context with `Read` (use offset/limit for large files; `Glob` to discover files): every item in the step's `context` field (spec sections by anchor, ADRs, files) plus all prior sections of `<plans.dir>/<plan-id>/HANDOFF.md` (resolve `plans.dir` from config; never assume `plans/`; the repo-root HANDOFF.md is not a plan handoff).
4. Avoid reading other files unless the listed context is insufficient; record any expansion in `<plans.dir>/<plan-id>/HANDOFF.md`.
5. Execute the tasks, following `feature/spec-precedence`: architecture spec first, feature spec for gaps (record each gap). Every gap, assumption, or proposed spec edit goes into `<plans.dir>/<plan-id>/spec-gaps.md` as a new numbered entry (`## G<n>: <case>`, the six fields of `architecture/file-formats` §4.2, `**Status**: open`): create the file on the first entry and never reuse a number. A proposed spec edit the agent may not make itself is a `proposal` entry; do not write `feature-spec-proposals.md`. On a contradiction: if attended, stop and show both passages; if unattended, do not implement the contradicted behaviour, record a `BLOCKED:` item under open issues, and continue with unaffected tasks.
6. Check the acceptance criteria and tick each met checkbox in the step file.
7. Decide the outcome: `done`, or `blocked` if a blocking issue prevents the criteria from being met.
8. Stage the step's own work (`git add <paths>`), then record the outcome with the CLI: `SPECPLANE_AGENT=${SPECPLANE_AGENT:-claude-code} specplane plan step-done <plan-id> --outcome <done|blocked> --summary "<commit subject text>" --type <feat|fix|docs|...>` plus `--changed "<path>:<reason>"` per changed file, `--deviation`, `--open-issue` (`BLOCKED: ...` when blocked), `--gap G<n>` for each `spec-gaps.md` entry this step added, `--next-knows`, and `--trailer "Co-Authored-By: <the harness attribution trailer>"`. The CLI appends the HANDOFF.md section (`architecture/file-formats` §4.1), sets the step's `status`, and makes the §8 step commit in one operation; do not format the section or the commit yourself, and read its refusal message if it fails. Re-running a `blocked` step adds `--resume`. It never pushes.
9. Without the CLI (step 2 of the preconditions), do the same by hand: set the step's `status`, append the §4.1 section (`**Outcome**` equal to the status, "None." for empty subsections, gaps listed by ID), and commit per §8 with `Specplane-Workflow: step`, `Specplane-Plan`, `Specplane-Step`, `Specplane-Agent` (else `claude-code`), `Specplane-Session` (omit when unset), then the `Co-Authored-By` trailer; subject `<type>(<slug>): <summary>`, at most 72 characters.
10. If `execution.backend` is `external`, or the plan branch has an upstream, push `plan/<id>` so the next session and other machines see the step.

**Subagent branch.** If the step sets `use_subagent: true`, do steps 1-2 yourself, resolve the context items to paths, then run steps 3-9 in a fresh subagent (not a `fork`, which would inherit this session's context). The subagent does not push; you perform step 10 yourself after it returns:

```
Agent({
  subagent_type: "general-purpose",
  description: "Execute plan step NN: <title>",
  prompt: "<steps 3-9 above>\n\nPlan: <plan-id>, checkout: <path>\nStep file: <path>\nHANDOFF.md: <plans.dir>/<plan-id>/HANDOFF.md, resolved to a path\nContext items: <resolved paths, with heading anchors>\nSession mode: unattended"
})
```

Pass paths, not file contents; the subagent reads them itself. Run one subagent at a time. Report the subagent's summary (outcome `done` or `blocked`) and do not re-read the step's diff.

## Output

Start with the detected session mode. Then one paragraph: outcome, files changed, gaps (their `spec-gaps.md` IDs), open issues, and the next step. Do not start the finish flow automatically after the last step; suggest `/plan-finish`.
