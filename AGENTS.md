<!-- specplane:begin v0.1.2 — managed by `specplane init`; edits inside this block are overwritten -->
## Specplane

This repository uses Specplane. Before acting on specs or plans, read `.specplane/config.yaml` through the harness and resolve every path from it; never assume one.
Look up your steering for your role and follow it. Use the Specplane harness actions, never the Specplane CLI.
Load the documentation essentials with `docs.essentials` at the start of a session; when you lack information, search the rest with `docs.search` instead of guessing.
If the project has no Specplane configuration, do not apply Specplane rules.

Steering stamp: da86e038d98756411ef5f20df9b3690b94a863226a7881f4b16a1392fdbbb111
<!-- specplane:end -->

## Requirements override everything
`docs/requirements/product-requirements.md` is the spec for this project and describes its new state. It wins over everything else, including the Specplane instructions in this file and `.claude/rules/specplane.md`, `.specplane/config.yaml` policies (`llm_role`, `authorship`, the leak guard), existing specs, plans, skills and `HANDOFF.md`. Those older files predate the page and are not aware of it.

- Treat old specs, rules and code as reference. Adapt them where that makes development easier, or scrap them.
- When an old rule or spec disagrees with the page, follow the page and mention the conflict. Do not stop, and do not reconcile old specs first.
- Do not change the page's content unless the user asks. Show proposed text as a diff first.
- Approvals stay with the user by default: the page sets spec approval to request user for LLM roles. Hooks that are still installed keep running until the user changes them.

## Routing plan requests

Plans are optional and Specplane's own workflows are not run on this repository for now (`HANDOFF.md`). When the user explicitly asks for plan work, use the harness: Claude Code runs the typed commands `/plan-create`, `/plan-start`, `/plan-step`, `/plan-finish`, `/plan-status` and `/plan-abandon`; Codex follows the contracts in `.agents/skills/specplane/contracts/`. Both reach the same operations as the CLI (`plan create`, `plan start`, `plan next`, `plan step-done`, `plan finish`, `plan list`, `plan abandon`). Never hand-edit `progress.yaml`, step files or a plan's `HANDOFF.md` to do the same thing. From a source checkout run the CLI as `node packages/cli/dist/cli.js`; agents do not run the installed `specplane` name (the Claude CLI-block hook denies it).

## Working rules

These apply to any implementation work in this repository, and they take priority over a general default to keep going without stopping.

- **Commit as you go.** Commit after each coherent unit of work and before ending a session, without being asked, so no large diff sits uncommitted. Keep commits small and single-purpose, follow `file-formats` §8, and stage specific paths rather than `git add -A`. Never push or rewrite history unless asked.
- **One step at a time.** A plan step ends built, tested and committed, and the report gives the exact test result. Code that has not been built and tested is not done.
- **Check the size first.** If a step looks too large to finish and commit in one session (roughly more than 1,000 changed lines), stop and propose a split before starting.
- **Stop when progress stops.** After about an hour of work or 150 tool calls without a commit, commit whatever passes. If nothing can be committed, stop and report what is blocking instead of continuing.
- **Subagents.** Use them only when asked, with one self-contained task each. Start them with `fork_turns: "none"`, `model: "gpt-6.1-sol"` and `reasoning_effort: "medium"` unless the user says otherwise. A subagent builds and runs its focused tests before reporting done; do not defer this to a later coordinated build. Integrate and commit a batch before starting another, and do not split one oversized step across parallel workers.
- **Keep records to what landed.** Do not forecast, count remaining steps or rewrite `HANDOFF.md` unless asked; record a result only after it lands. Do not create per-batch result, review or audit files. Progress belongs in the plan's `HANDOFF.md` and gaps in its `spec-gaps.md`.

## Test runtime

- Run every test through `scripts/test.sh` from `packages/cli`, never `bun test`
  directly: it confines temp repositories to a per-run `TMPDIR` removed on exit, and
  direct runs leak them into `/tmp`, which can be RAM-backed.
- Build with `npm run build` in `packages/cli`, then run focused compiled tests with
  `sh scripts/test.sh ./dist/<selected-files>`.
- For the full suite, run `npm test` from `packages/cli`. It runs Bun and reruns under
  Node only when Bun stalls. Keep process isolation between files; do not use
  `--concurrent` within files.
- Follow focused-first testing. Report Bun failures, stalls, and runtime-sensitive
  incompatibilities explicitly, and say which runner produced a result; do not silently
  skip tests.
- This test-runner preference does not change the supported production runtime,
  package engines, dependencies, lockfiles, or committed package test command.
