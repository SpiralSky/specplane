<!-- specplane:begin v1 — managed by `specplane init`; edits inside this block are overwritten -->
## Specplane

This repository uses Specplane. Before acting on specs, plans, or ADRs, read `.specplane/config.yaml`; resolve every path from it (`spec_roots`, `plans.dir`, `decisions.dir`), never assume one. `execution` says how plans run.

- **Authorship**: `specs.<type>.llm_role` limits what you may do to specs of that type: `none` = do not act on them, decline and say why; `assist` = ask, suggest, and review, but do not write the spec body; `draft` = you may write a draft for review.
- **Precedence**: when implementing, the architecture spec wins and the feature spec fills gaps; record each gap. If specs contradict each other, stop and report it; do not implement either side.
- **Plans**: work on a plan only in its checkout (branch `plan/<id>`), one step at a time, following the plan-step workflow. HANDOFF.md in the plan folder is the source of truth for progress.
- **Commits**: follow `architecture/file-formats` §8 (Conventional Commits subject plus `Specplane-*` trailers).
- **Workflows**: `/spec-assist`, `/spec-draft-architecture`, `/plan-create`, `/plan-step`, `/plan-finish`, `/validate`; without them, follow the contracts in `architecture/agent-skills`.
<!-- specplane:end -->
