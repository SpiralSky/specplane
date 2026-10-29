---
name: plan-step
description: Execute the next step of a Specplane plan. Use when the user runs /plan-step.
argument-hint: "[plan-id] [--unattended]"
disable-model-invocation: true
---

# plan-step

Executes the next step of a plan (the `plan-step` workflow integration).

## Preconditions

1. **Specplane configured**: if neither `.specplane/config.yaml` nor `AGENTS.md` exists at the repository root, say "This repository is not set up for Specplane. Run `specplane init --harness claude`." and stop.
2. **CLI availability**: run `command -v specplane`. If present, use the CLI for resolution, validation, and plan flows. If absent, follow the same rules by hand from the format and flow specs (`architecture/agent-skills` § Config resolution in skills) and say once that the CLI was not found. For `/validate` without the CLI, check frontmatter and IDs by hand against `architecture/file-formats` and label the result "manual check". For `/plan-finish` without the CLI, perform `feature/plan-execution` § Finish flow by hand, in its stated order.

Resolve every spec, plan, and ADR path from config (`.specplane/config.yaml`; defaults if absent), never from hardcoded paths.

## Policy check

Read `specs.*` (authorship and `llm_role`) from config before editing any spec. Determine the session mode (below); follow `feature/spec-precedence`.

**Session mode.** The session is **unattended** if any of these holds, otherwise **attended**: `--unattended` appears in `$ARGUMENTS`; you are running as a subagent (launched through the Agent tool); the session is non-interactive (headless `claude -p`, scheduled or cloud routine, CI); the `AskUserQuestion` tool is not available. When unsure, treat the session as unattended. State the detected mode at the start of your output.

## Steps

`$ARGUMENTS` is `[plan-id] [--unattended]`: strip `--unattended`; any remaining token is the plan ID.

1. Identify the plan: the plan ID argument, else the current branch `plan/<id>`, else ask the user. If not on the plan's branch, warn before proceeding.
2. Parse the step files; find the next step (lowest-numbered step that is not `done` or `skipped`). If it is `blocked`, report its `BLOCKED:` issue and stop. If there is none, report that all steps are done and suggest `/plan-finish`.
3. Load context with `Read` (use offset/limit for large files; `Glob` to discover files): every item in the step's `context` field (spec sections by anchor, ADRs, files) plus all prior sections of HANDOFF.md.
4. Avoid reading other files unless the listed context is insufficient; record any expansion in HANDOFF.md.
5. Execute the tasks, following `feature/spec-precedence`: architecture spec first, feature spec for gaps (record each gap). On a contradiction: if attended, stop and show both passages; if unattended, do not implement the contradicted behaviour, record a `BLOCKED:` item under open issues, and continue with unaffected tasks.
6. Check the acceptance criteria and tick each met checkbox in the step file.
7. Set the step's `status` to `done`, or `blocked` if a blocking issue prevents the criteria from being met.
8. Append the step's HANDOFF.md section (`architecture/file-formats` §4.1: `## Step NN: <title>`, `**Date**`, `**Outcome**` equal to the status, all five subsections, "None." for empty ones). Never edit earlier sections.
9. Commit with message `plan/<id> step NN: <slug>`, a blank line, then a bullet summary of changes.

**Subagent branch.** If the step sets `use_subagent: true`, do steps 1-2 yourself, resolve the context items to paths, then run steps 3-9 in a fresh subagent (not a `fork`, which would inherit this session's context):

```
Agent({
  subagent_type: "general-purpose",
  description: "Execute plan step NN: <title>",
  prompt: "<steps 3-9 above>\n\nPlan: <plan-id>, checkout: <path>\nStep file: <path>\nHANDOFF.md: <path>\nContext items: <resolved paths, with heading anchors>\nSession mode: unattended"
})
```

Pass paths, not file contents; the subagent reads them itself. Run one subagent at a time. Report the subagent's summary (outcome `done` or `blocked`) and do not re-read the step's diff.

## Output

Start with the detected session mode. Then one paragraph: outcome, files changed, gaps, open issues, and the next step. Do not start the finish flow automatically after the last step; suggest `/plan-finish`.
