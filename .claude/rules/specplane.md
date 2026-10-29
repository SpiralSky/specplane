<!-- specplane:standing v1 — installed by `specplane init --harness claude`; overwritten on update -->
## Specplane

This repository uses Specplane. Before acting on specs, plans, or ADRs, read `.specplane/config.yaml`; resolve every path from it (`spec_roots`, `plans.dir`, `decisions.dir`), never assume one. `execution` says how plans run.

- **Authorship**: `specs.<type>.llm_role` limits what you may do to specs of that type: `none` = do not act on them, decline and say why; `review` = ask, suggest, and review, but do not write the spec body; `assist` = write the body only after the user finalises the content and approves the text (refine-then-write); `draft` = you may write a draft for review. Setting a spec to `approved`, a plan to `ready`, or a decision record to `accepted` is the human's decision: never do it by editing a file.
- **Precedence**: when implementing, the architecture spec wins and the feature spec fills gaps; record each gap, assumption, or proposed spec edit as a `spec-gaps.md` entry in the plan folder. If specs contradict each other, stop and report it; do not implement either side.
- **Plans**: work on a plan only in its checkout (branch `plan/<id>`), one step at a time, following the plan-step workflow. HANDOFF.md and `spec-gaps.md` in the plan folder are the source of truth for progress and gaps.
- **Commits**: follow `architecture/file-formats` §8 (Conventional Commits subject plus `Specplane-*` trailers).
- **Workflows**: `/spec-assist`, `/spec-draft-architecture`, `/plan-create`, `/plan-step`, `/plan-finish`, `/validate`; without them, follow the contracts in `architecture/agent-skills`.

### Claude Code
- Read spec and plan files with `Read` (offset/limit for large specs); find files with `Glob`.
- HANDOFF.md is the source of truth for plan progress; memory is only a pointer to it.
- In a plan checkout, the session start context names the plan and its next step; work only on that step.
- Commits: put `Specplane-Agent: $SPECPLANE_AGENT` and `Specplane-Session: $SPECPLANE_SESSION` in the trailers when those variables are set.
