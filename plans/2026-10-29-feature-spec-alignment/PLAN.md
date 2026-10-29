---
id: 2026-10-29-feature-spec-alignment
title: "Align architecture specs and CLI with applied feature specs"
status: draft
specs: ["feature/configuration","feature/decisions","feature/plan-index","feature/plan-status","feature/plan-steps","feature/plan-system","feature/spec-precedence","feature/tooling","architecture/reference-cli","architecture/file-formats","architecture/agent-skills","claude:feature/claude-integration","claude:architecture/claude-integration"]
---

# Align architecture specs and CLI with applied feature specs

## Goal

The feature-spec proposals applied on 2026-10-29 (`676b645`, `9491332`) changed config and ADR validation, stack-mode `blocked`, abandon rules, `--no-fetch`, `search --kind`, `plan restack`, repeated HANDOFF step sections, and added the per-plan `spec-gaps.md` record (Rule 6). Bring the architecture specs, the CLI, the skills, and the agent instructions in line with them.

## Scope

- Architecture edits in `architecture/reference-cli`, `architecture/file-formats`, `architecture/agent-skills`, and `claude:architecture/claude-integration`; re-pin dependants.
- Config validation: `spec_roots` paths that are missing, not a directory, or outside the repository; the `worktree_dir` error text and its backend condition.
- ADR validation: id/filename message, `superseded_by` on a non-superseded ADR as a warning, supersession cycles, feature-spec message texts.
- Plan status and commands: stack-mode `blocked`, abandoning a `done`/`abandoned` plan fails, `--no-fetch` on `plan start`/`plan finish`, `search --kind`, `restack --dry-run` listing commits.
- `spec-gaps.md`: parsing, `validate` checks, the HANDOFF latest-entry-wins rule, the finish flow listing open entries.
- Skills and standing instructions: write `spec-gaps.md` entries (`proposal` replaces `feature-spec-proposals.md`), sync `.claude/`.

## Non-goals

- Feature-spec edits (`llm_role: assist`): any new gap goes into this plan's `spec-gaps.md` as a `proposal`.
- The overlay re-pin tooling gap (repo `HANDOFF.md` next step 5): separate plan after `/spec-assist`.
- Publishing, remote setup.

## Specs implemented

| Spec | Coverage |
|------|----------|
| `feature/configuration` | Scenarios 6–8, spec root path rules |
| `feature/decisions` | Frontmatter validation, Scenarios 6–7 |
| `feature/plan-index` | Scenarios 5 and 5a (check existing behaviour) |
| `feature/plan-status` | Abandon rules, stack-mode `blocked` |
| `feature/plan-steps` | Repeated sections for re-run `blocked` steps; gaps section lists `spec-gaps.md` IDs |
| `feature/plan-system` | `spec-gaps.md` in the plan folder |
| `feature/spec-precedence` | Spec gaps record, Rule 6 |
| `feature/tooling` | `--no-fetch`, `plan restack`, `search --kind` |
| `architecture/reference-cli` | All CLI changes above |
| `architecture/file-formats` | `spec-gaps.md` format, HANDOFF repeated sections, ADR rules |
| `architecture/agent-skills` | Skills record and list `spec-gaps.md` entries |
| `claude:feature/claude-integration`, `claude:architecture/claude-integration` | Claude skills and standing instructions |

## Acceptance criteria

- [ ] Each changed scenario above has a test in `packages/cli` with the feature-spec message text.
- [ ] `specplane validate` checks `spec-gaps.md` entries and the HANDOFF latest-entry rule; `plan finish` lists open entries.
- [ ] Skills and standing instructions write `spec-gaps.md` entries; no workflow writes `feature-spec-proposals.md`.
- [ ] `npm test`, `sh harnesses/claude/tests/check-sync.sh`, and `sh harnesses/claude/tests/hooks.test.sh` pass; `specplane validate` has 0 errors and `specplane spec pin --check` is clean.

## Risks

1. Re-pinning approved architecture specs that overlays and skill contracts pin needs one commit per level (known tooling gap); budget for it in steps 01 and 05.
2. Making `superseded_by` on a non-superseded ADR a warning loosens an existing error; check that no test depends on the old severity for another reason.
3. Archived plans have `feature-spec-proposals.md` files; validation must not require them to migrate.

## Steps

1. `architecture-spec-edits`: Edit `architecture/reference-cli` and `architecture/file-formats` for every change; re-pin.
2. `config-and-adr-validation`: Config path errors and ADR checks.
3. `plan-status-and-commands`: Stack-mode `blocked`, abandon, `--no-fetch`, `--kind`, restack dry run.
4. `spec-gaps-in-cli`: Parse and validate `spec-gaps.md`; HANDOFF latest-entry rule; finish-flow listing.
5. `skills-and-agents`: Agent-skills and Claude architecture edits; skills and standing instructions; sync `.claude/`.
6. `docs-and-final-check`: README and help text; full test and validation run.
