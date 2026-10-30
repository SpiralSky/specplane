---
plan: 2026-10-30-plan-conductor
step: 5
title: "ADR 0005, open-question resolutions, and rollout docs"
status: pending
context:
  - spec: architecture/file-formats#ADR files
  - spec: architecture/agent-skills#plan-start
  - spec: feature/plan-execution#Execution backends
  - file: docs/OPEN-QUESTIONS.md
  - file: docs/design/harness-orchestration.md
  - file: docs/decisions/0004-raise-the-nodejs-baseline-to-22-lts.md
---

## Goal

Record the decision the conductor embodies, close the four open questions with links to the
implemented behaviour, and leave the design note as history rather than as the only description.

## Acceptance criteria

- [ ] ADR `0005` exists (`specplane decision new`, then accept by the human) with Context, Options
      (A: per-harness loop, B: CLI conductor + adapter, C: external orchestrator), Decision, and
      Consequences naming the rejected options and why.
- [ ] `docs/OPEN-QUESTIONS.md` moves OQ-12…OQ-15 into Resolved with a link to the ADR and the spec
      sections that now define the behaviour.
- [ ] `docs/design/harness-orchestration.md` gains a status line: implemented by these two plans,
      ADR 0005, with the remaining review-backlog items marked done/declined.
- [ ] `architecture/agent-skills` `plan-start` documents `--run` and the session-identity rule; the
      Claude overlay references the ADR instead of restating the rationale.
- [ ] The plan's `spec-gaps.md` entries are all resolved or explicitly carried forward with a status.
- [ ] `specplane validate` and `npm test` pass; contract pins re-pinned; `specplane generate` output is
      stable.

## Tasks

1. Create ADR 0005 and fill the body from the design note; leave `status: proposed` for the human to
   accept via `/approve`.
2. Update `docs/OPEN-QUESTIONS.md` (§ Resolved questions table plus the per-question sections).
3. Annotate the design note with an implementation status header; do not delete the review findings.
4. Update the `plan-start` contract text (spawn vs "open a session") and the harness overlay pointer.
5. Walk `spec-gaps.md`; set each entry to `applied`/`rejected` or record why it stays open.
6. Final pass: run the full suite, validate, regenerate, and write the finish-ready HANDOFF section.

## Guidance

- Do not mark the ADR accepted: `accepted` is the human's decision (Specplane rule; `feature/
  spec-policies`). Leave it `proposed` and say so in the output.
- The design note is not a spec; do not let it become the authority. Point at the specs.
