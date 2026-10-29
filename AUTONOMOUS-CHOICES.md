# Autonomous choices report

The user asked for the repo to be completed without interruption (2026-10-29). Every judgement call made without user input is listed here so it can be revisited. Per-step detail lives in each plan's `HANDOFF.md` (items prefixed `CHOICE:`).

## Process
- Plans were set to `ready` and step/finish flows were run by subagents (one per step); the main session acted as the confirming human for `local_merge`.
- Feature specs (`llm_role: assist`) were never edited. Feature-spec findings became `feature-spec-proposals.md` files in the relevant plan folders, for user review.

## Plan creation
- No ADR commands are planned; no spec defines any.
- `plan restack` is not in `feature/tooling`: it is a feature-spec proposal, documented meanwhile in the architecture spec.
- Proposal-only findings are not implemented (e.g. `worktree_dir`-inside-repo and bad `spec_roots` errors).
- Sequencing: `cli-plan-commands` depends on `cli-spec-search`; `cli-plan-flows` on `cli-plan-commands`; `cli-forge-ci-publish` on `cli-plan-flows`; `cli-claude-harness-init` only on core; `claude-plugin-hardening` on nothing.
- `git/commit.ts` lives in `cli-plan-commands`, not `cli-plan-flows`.
- `specplane-publish.yml` is committed but never triggered; `npm publish` is not run.

## 2026-10-28-reference-cli-core
- `test` script is `npm run build && node --test` (`node --test dist/` fails on Node 22).
- `package.json`: `"type": "module"`, `engines.node >=18`; tsconfig adds `esModuleInterop`, `skipLibCheck`.
- Merged `Config` type: `pin_bases`, `plans.dir`, `decisions.dir` required, the rest optional.
