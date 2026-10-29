---
id: 2026-10-29-assist-and-approve
title: "Refine-then-write assist, the review role, and approval commands"
status: draft
specs: ["feature/spec-policies","feature/configuration","feature/agent-integration","feature/tooling","architecture/agent-skills","architecture/reference-cli","architecture/file-formats","claude:feature/claude-integration","claude:architecture/claude-integration"]
depends_on: ["2026-10-29-feature-spec-alignment"]
---

# Refine-then-write assist, the review role, and approval commands

## Goal

The feature specs approved on 2026-10-29 (`506cfd6`, `01ddd69`) split `llm_role: assist` into `review` (review-only) and a refine-then-write `assist`, and add approval commands: `spec approve`/`reopen`, `plan approve`, `decision new`/`accept`, and the `approve`, `plan-start`, `decision-new`, `plan-status`, and `plan-abandon` workflow integrations. Bring the architecture specs, the CLI, the Claude skills, and the policy guard in line with them, so that a user working in Claude Code can write, approve, and reopen specs without editing frontmatter by hand.

## Scope

- Architecture edits in `architecture/agent-skills`, `architecture/reference-cli`, `architecture/file-formats` §8, and `claude:architecture/claude-integration`; re-pin dependants.
- Config: `review` in both `llm_role` enums; validation, `init` defaults, and the standing-instructions text for each role.
- CLI: `spec approve`, `spec reopen`, `plan approve`, `decision new`, `decision accept`.
- Claude harness: the `spec-assist` and `spec-draft-architecture` skills follow the new roles; new skills `approve`, `plan-start`, `decision-new`, `plan-status`, `plan-abandon`; the guard asks under `review` and `assist` and denies agent edits that set `approved`, `ready`, or `accepted`.

## Non-goals

- Feature-spec edits (`llm_role: assist`): any new gap goes into this plan's `spec-gaps.md` as a `proposal`.
- Approving the architecture specs left in `review`: the agent lists the `/approve` command; the user runs it.
- Publishing, remote setup.

## Specs implemented

| Spec | Coverage |
|------|----------|
| `feature/spec-policies` | `review` and `assist` meanings, refine-then-write, Scenarios 1, 1a, 1b |
| `feature/configuration` | `llm_role` allowed values |
| `feature/agent-integration` | `spec-assist`, `spec-draft-architecture`, `approve`, `plan-start`, `decision-new`, `plan-status`, `plan-abandon`; policy table; Scenarios 1, 1a, 9 |
| `feature/tooling` | `spec approve`, `spec reopen`, `plan approve`, `decision new`, `decision accept`; Scenarios 7–10 |
| `architecture/agent-skills` | Skill contracts above |
| `architecture/reference-cli` | All CLI changes above |
| `architecture/file-formats` | §8 `Specplane-Workflow: approve` and commit subjects |
| `claude:feature/claude-integration`, `claude:architecture/claude-integration` | Slash commands, guard rules, Scenarios 4, 6, 6a, 6b, 6c |

## Acceptance criteria

- [ ] `tooling` Scenarios 7–10 and `spec-policies`/`agent-integration` policy scenarios have tests in `packages/cli` with the feature-spec message texts.
- [ ] Config with `llm_role: review` validates; the guard asks under `review` and `assist`, and denies agent edits that approve.
- [ ] `/spec-assist` runs refine-then-write under `assist` and review-only under `review`; the five new slash commands exist in the templates and in `.claude/`.
- [ ] `npm test`, `sh harnesses/claude/tests/check-sync.sh`, and `sh harnesses/claude/tests/hooks.test.sh` pass; `specplane validate` has 0 errors and `specplane spec pin --check` is clean.

## Risks

1. The guard cannot see every `Bash` edit; status edits through `sed` are covered by the standing instructions and by `approve` being the only documented route, not by the hook alone.
2. `spec approve` re-pins and commits: a failure between the pin and the commit must leave the working tree clean (or report exactly what is left).
3. Many architecture specs are in `review` because of the approval cascade; step 06 must list each with its `/approve` command so none is forgotten.

## Steps

1. `architecture-spec-edits`: specify everything below in the architecture specs; re-pin
2. `config-and-policy`: `review` in config, validation, `init`, standing instructions
3. `spec-approve-reopen`: `spec approve` and `spec reopen`
4. `plan-approve-and-decisions`: `plan approve`, `decision new`, `decision accept`
5. `claude-harness`: skills, guard hook, `.claude/` sync
6. `docs-and-final-check`: docs, full checks, approval list for the user
