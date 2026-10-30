---
plan: 2026-10-30-plan-primitives
step: 4
title: "Creation paths — route spec and plan creation through the CLI"
status: done
context:
  - spec: feature/agent-integration
  - spec: feature/spec-policies
  - spec: architecture/agent-skills#spec-assist
  - spec: architecture/agent-skills#spec-draft-architecture
  - spec: architecture/agent-skills#plan-create
  - spec: architecture/agent-skills#approve
  - file: packages/cli/src/commands/spec.ts
  - file: packages/cli/src/plan/new-template.ts
  - file: harnesses/claude/templates/skills/spec-assist/SKILL.md
  - file: harnesses/claude/templates/skills/spec-draft-architecture/SKILL.md
  - file: harnesses/claude/templates/skills/plan-create/SKILL.md
---

## Goal

`specplane spec new <type> <slug>` and `specplane plan new` already exist and produce correct
frontmatter and skeletons (`spec` writes `author: user`, `status: draft`, and requires
`--implements` for architecture specs). The skills still hand-write files, which is a second writer
for one format. Route creation through the CLI and validate immediately after.

## Acceptance criteria

- [x] `spec-assist`, `spec-draft-architecture`, and `plan-create` create files only via
      `specplane spec new` / `specplane plan new`; a contract line in `architecture/agent-skills` says
      so, and each skill's `## Steps` shows the command it runs.
- [x] After creation each skill runs `specplane spec validate <id>` (or `plan validate`), and reports
      the result rather than assuming success.
- [x] `plan-create` ends its output with the `/approve <id>` pointer, and its reminder that a human
      sets `status: ready` is kept.
- [x] The `spec new` scaffold is checked against `architecture/file-formats` §1.3/§1.4: missing
      required sections are a `gap` entry in `spec-gaps.md` and are fixed in the CLI in this step.
- [x] Where the selected root or `extends` matters, the skill passes `--root`/`--extends` instead of
      writing overlay frontmatter by hand (`claude:feature/claude-integration`).
- [x] `specplane validate` and `npm test` pass; contract pins re-pinned.

## Tasks

1. Read the three skills and the `specNew`/`planNew` implementations; list every file they currently
   write directly and replace each with the CLI call.
2. Check `scaffold(type, title)` against the §1.3 and §1.4 templates; fix any missing section in the
   CLI (this is the only behaviour change allowed in this step, and only where the spec requires it).
3. Add the creation rule to `architecture/agent-skills` (a line under `## Contract structure` or the
   shared preamble, so it applies to every skill) and update the three skill sections.
4. Add the `/approve` pointer to `plan-create`'s `## Output` and to `architecture/agent-skills`
   `plan-create`.
5. Assert authorship is untouched: `spec new` must not gain a content flag; a `feature` spec edits
   still go through `llm_role` review in `spec-assist`.
6. Tests: `spec new` on each type, `spec new` into an overlay root, refusal on duplicate ID, and
   `spec validate` immediately after creation.

## Guidance

- This step is about adoption, not new capability. If `spec new` needs a missing flag (`--root`,
  `--extends`), add it; do not add `--body`/`--content`.
- `plan-create` currently says "using `specplane plan new` when available" — that hedge can go now
  that the command exists; the skill should state it plainly and keep the no-CLI manual path.
