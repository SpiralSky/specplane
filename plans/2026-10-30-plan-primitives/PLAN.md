---
id: 2026-10-30-plan-primitives
title: "Plan primitives — next, step-done, and harness doc fixes"
status: draft
specs: ["architecture/reference-cli","architecture/agent-skills","feature/plan-status","feature/agent-integration","claude:architecture/claude-integration","claude:feature/claude-integration"]
depends_on: []
---

# Plan primitives — next, step-done, and harness doc fixes

## Goal

Give the CLI the two primitives that every harness and the future conductor need — a read-only
`plan next` resolver and a `plan step-done` writer — and close the hand-off, creation-path, and
discoverability gaps recorded in `docs/design/harness-orchestration.md` § Review backlog. Nothing in
this plan spawns a session or spends quota; it makes the existing manual loop reliable and
machine-readable first.

## Scope

- `specplane plan next <id> [--json]`: resolve the next step, its context, the checkout, blocking
  issues, open gaps, and the recommended action. Read-only, no side effects.
- `specplane plan step-done <id>`: append the `HANDOFF.md` section (`architecture/file-formats` §4.1)
  and write the commit with the `Specplane-*` trailers (§8), so the formats stop living only in the
  skill.
- Output fixes: human `plan list --live` shows `checkout`; `plan start` prints the checkout and a
  copy-pasteable `cd … && claude` line, distinguishes "resumed", reports the backend, and warns for
  `external`; a failed `git fetch` in `--live` degrades with a notice; `/plan-status` warns when the
  session is not in the plan's checkout.
- Creation paths: `spec-assist`, `spec-draft-architecture`, and `plan-create` create files through
  `specplane spec new` / `specplane plan new` and then `specplane spec validate`; `plan-create`
  points at `/approve`.
- Harness docs: an operations table (skill vs CLI-only) in `architecture/agent-skills`, the
  `disable-model-invocation` rule in the Claude overlay, a natural-language routing table in the
  project instructions, and a decision on `/plan-finish` without the CLI.

## Non-goals

- No session spawning, `--run`, or conductor loop (plan `2026-10-30-plan-conductor`).
- No new configuration keys for execution modes or notifications.
- No new slash commands: every gap is closed by a CLI command, a rendered field, or documentation.
- No change to `feature/plan-execution`'s backend definitions.

## Specs implemented

| Spec | Coverage |
|------|----------|
| `architecture/reference-cli` | `plan next`, `plan step-done`, `plan list --live` and `plan start` output, fetch degradation |
| `architecture/agent-skills` | operations table, `plan-step`/`plan-start`/`plan-status` contract text, creation-path rule |
| `feature/plan-status` | checkout shown and validated in status output |
| `feature/agent-integration` | skills create files via the CLI; no hand-written frontmatter |
| `claude:architecture/claude-integration` | `disable-model-invocation` rule, manual-mode wording |
| `claude:feature/claude-integration` | skill behaviour for the above |

## Acceptance criteria

- [ ] `plan next <id> --json` returns a documented, stable object and has no side effects (running it
      twice leaves the worktree and git state unchanged).
- [ ] `plan step-done` appends exactly one valid §4.1 section and commits with the §8 trailer order;
      it refuses when the step status and the HANDOFF outcome disagree.
- [ ] `plan list --live` prints `checkout`; `plan start` output distinguishes created vs resumed,
      names the backend, and prints a working `cd`/`claude` line.
- [ ] A fetch failure during `--live` prints one notice and exits successfully with local data.
- [ ] `/plan-status` and `/plan-start` skills render the checkout and warn on the wrong checkout.
- [ ] `spec-assist` and `spec-draft-architecture` create new specs with `specplane spec new`, and
      `plan-create` uses `specplane plan new`; each runs `specplane spec validate` afterwards.
- [ ] The operations table and the `disable-model-invocation` rule are in the specs; the routing
      table is in the project instructions; `/plan-finish`-without-CLI behaviour is decided and
      implemented.
- [ ] `specplane validate` passes; `npm test` passes; skill contract pins are re-pinned.

## Risks

1. **Two writers drift.** `step-done` and the `plan-step` skill both write the HANDOFF section and the
   commit. Mitigation: the CLI owns the format, the skill calls it and stops formatting itself; the
   skill's contract text says so explicitly.
2. **Contract pin churn.** Editing `architecture/agent-skills` changes the blob referenced by every
   `specplane-contract:` comment. Mitigation: re-pin skills in the same commit as each spec edit.
3. **`checkout` is null for `branch`/`external` backends.** Mitigation: render the branch name and
   never warn when `checkout` is null.
4. **Project-instruction edits.** The routing table lives in `AGENTS.md`, outside the managed
   Specplane block; it is a user-visible instruction change, so it is reviewed in the step's HANDOFF.
5. **Manual finish sequence is a second implementation.** Mitigation: only the local-merge variant is
   printed, labelled "manual mode: no stale-base or divergence checks", or the step records the
   alternative decision in `spec-gaps.md`.

## Steps

1. `01-plan-next`: add the read-only `plan next` resolver and its `--json` contract.
2. `02-plan-step-done`: add `plan step-done` (HANDOFF §4.1 + commit §8) and make the skill delegate.
3. `03-checkout-and-handoff-output`: checkout in `plan list --live`, richer `plan start` output,
   fetch degradation, `/plan-status` wrong-checkout warning.
4. `04-spec-new-adoption`: route spec and plan creation through `spec new` / `plan new`, validate
   afterwards, point `plan-create` at `/approve`.
5. `05-harness-docs`: operations table, `disable-model-invocation` rule, routing table, and the
   `/plan-finish` manual-mode decision; re-pin contracts.
