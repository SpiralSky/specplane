<!-- specplane:begin v2 — managed by `specplane init`; edits inside this block are overwritten -->
## Specplane

Specplane tracks intended behaviour, review, implementation completion and evidence separately. Plans are optional; branches have no prescribed role. Specs and implementation may change together or separately. Completion is a declaration; matching its content fingerprint does not prove code correctness. Changed definitions can require reassessment. Use `specplane docs` for concepts and the requested workflow.

This repository uses Specplane. Before acting on specs, plans, or ADRs, read `.specplane/config.yaml`; resolve every path from it (`spec_roots`, `plans.dir`, `decisions.dir`), never assume one. `execution` says how plans run.

- **Authorship**: `specs.<type>.llm_role` limits spec writing and review independently of `authorship`: `none` = read and implement only, with no spec-body edits, review, or suggestions; `review` = ask, suggest, and review without independently drafting the spec body; apply a suggested edit only after the user approves that exact change; `assist` = write the body only after the user finalises the content and approves the text (refine-then-write); `draft` = you may write a draft for review. Setting a spec to `approved`, a plan to `ready`, or a decision record to `accepted` is the human's decision: never do it by editing a file.
- **Precedence**: when implementing, the architecture spec wins and the feature spec fills gaps; when using a managed plan, record gaps and assumptions in its `spec-gaps.md`; otherwise use the user's chosen record or conversation. If specs contradict each other, stop and report it; do not implement either side.
- **Plans**: when invoking managed plan execution, work only in its checkout (branch `plan/<id>`), one step at a time, following the plan-step workflow. HANDOFF.md and `spec-gaps.md` in the plan folder are the source of truth for progress and gaps.
- **Commits**: managed commands that create commits follow their documented format. Ordinary work needs no Specplane trailers. Manual implementation-completion edits are valid and do not approve a spec.
- **Workflows**: use an explicitly installed Specplane extension for agent workflows, or the standalone `specplane` CLI for manual operations. Extensions deliver the shared workflow procedures and their host-specific invocation details.
<!-- specplane:end -->

## Routing plan requests

The plan skills are user-invoked only, so route natural-language requests to the CLI. Run the command from the shell; never hand-edit `PLAN.md`, step files, or `HANDOFF.md` to do the same thing.

| The user asks to | Run |
|------------------|-----|
| start a plan | `specplane plan start <id>` |
| do the next step of a plan | `specplane plan next <id>`, then execute the step it names (`/plan-step`); record it with `specplane plan step-done <id>` |
| finish a plan | `specplane plan finish <id>` |
| see plan status | `specplane plan list --live` |
| rebase a stacked plan after its base merged | `specplane plan restack <id>` |

## Test runtime

- Use Bun for all future test runs, including focused tests and full suites. Do not
  run tests under Node or use mixed-runtime test runners.
- Build with `npm run build` in `packages/cli`, then run focused compiled tests with
  `bun test --parallel=20 --timeout=30000 ./dist/<selected-files>`.
- For the full suite, run `bun test --parallel=20 --timeout=30000 ./dist` from
  `packages/cli` after building. Keep process isolation between files; do not use
  `--concurrent` within files.
- Follow focused-first testing. Report Bun failures, stalls, and runtime-sensitive
  incompatibilities explicitly; do not silently skip tests or substitute Node.
- This test-runner preference does not change the supported production runtime,
  package engines, dependencies, lockfiles, or committed package test command.
