<!-- specplane:standing v2 — installed by `specplane init --harness claude`; overwritten on update -->
## Specplane

Specplane tracks intended behaviour, review, implementation completion and evidence separately. Plans are optional; branches have no prescribed role. Specs and implementation may change together or separately. Completion is a declaration; matching its content fingerprint does not prove code correctness. Changed definitions can require reassessment. Use `specplane docs` for concepts and the requested workflow.

This repository uses Specplane. Before acting on specs, plans, or ADRs, read `.specplane/config.yaml`; resolve every path from it (`spec_roots`, `plans.dir`, `decisions.dir`), never assume one. `execution` says how plans run.

- **Authorship**: `specs.<type>.llm_role` limits spec writing and review independently of `authorship`: `none` = read and implement only, with no spec-body edits, review, or suggestions; `review` = ask, suggest, and review without independently drafting the spec body; apply a suggested edit only after the user approves that exact change; `assist` = write the body only after the user finalises the content and approves the text (refine-then-write); `draft` = you may write a draft for review. Setting a spec to `approved`, a plan to `ready`, or a decision record to `accepted` is the human's decision: never do it by editing a file.
- **Precedence**: when implementing, the architecture spec wins and the feature spec fills gaps; when using a managed plan, record gaps and assumptions in its `spec-gaps.md`; otherwise use the user's chosen record or conversation. If specs contradict each other, stop and report it; do not implement either side.
- **Plans**: when invoking managed plan execution, work only in its checkout (branch `plan/<id>`), one step at a time, following the plan-step workflow. HANDOFF.md and `spec-gaps.md` in the plan folder are the source of truth for progress and gaps.
- **Commits**: managed commands that create commits follow their documented format. Ordinary work needs no Specplane trailers. Manual implementation-completion edits are valid and do not approve a spec.
- **Workflows**: use an explicitly installed Specplane extension for agent workflows, or the standalone `specplane` CLI for manual operations. Extensions deliver the shared workflow procedures and their host-specific invocation details.

### Claude Code
- Workflows: `/spec-assist`, `/spec-draft-architecture`, `/plan-create`, `/plan-step`, `/plan-finish`, `/validate`, `/approve`, `/plan-start`, `/decision-new`, `/plan-status`, `/plan-abandon`; without them, follow the contracts in `architecture/agent-skills`.
- Read spec and plan files with `Read` (offset/limit for large specs); find files with `Glob`.
- HANDOFF.md is the source of truth for plan progress; memory is only a pointer to it.
- In a plan checkout, the session start context names the plan and its next step; work only on that step.
- Commits: put `Specplane-Agent: $SPECPLANE_AGENT` and `Specplane-Session: $SPECPLANE_SESSION` in the trailers when those variables are set.
