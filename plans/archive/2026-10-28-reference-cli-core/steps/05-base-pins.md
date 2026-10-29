---
plan: 2026-10-28-reference-cli-core
step: 5
title: Base pins, section anchors, skill drift, and spec pin command
status: done
context:
  - spec: architecture/reference-cli#Base pins
  - spec: architecture/reference-cli#Skill contract drift
  - spec: architecture/reference-cli#Validation output format
  - spec: feature/spec-overlays#Base pins
  - spec: feature/spec-overlays#Validation rules for overlays
  - spec: architecture/agent-skills#Keeping skills in sync with specs
  - spec: architecture/file-formats
  - spec: feature/configuration
  - decision: decision/0003
  - file: packages/cli/src/spec/
  - file: packages/cli/src/git/
  - file: packages/cli/src/commands/
---

## Goal

Implement base pins (ADR 0003): the `based_on` checks in `validate`, the `specs.pin_bases` policy, `<id>#<slug>` section-anchor checks, skill contract drift, and the `specplane spec pin [--check]` command.

## Acceptance criteria

- [x] In the `specs-framework` repo, `specplane spec pin --check` exits 0 and `specplane validate` reports no `base-changed` or `skill-drift` findings (all pins currently match).
- [x] After committing a change to a base spec's body, `validate` reports `base-changed` with the message from `feature/spec-overlays` § Stale pins, and `spec pin --check` exits 1.
- [x] A base change that touches only frontmatter `status` or `author` produces no finding.
- [x] When the pinned blob is missing from the object store, `base-changed` still fires and says the diff is unavailable.
- [x] An `approved` spec with a stale pin produces an error; with `specs.pin_bases: off` it does not (but see HANDOFF: the specs keep the error under `off`).
- [x] Missing pins: nothing under `off`; a warning for an `extends` spec under `warn`; an error for `extends` and `implements` under `require`.
- [x] A `based_on` key not listed in `extends`/`implements` produces an error.
- [x] `<id>#<slug>` matching no heading in the referenced spec produces a warning; the `<id> § <Heading>` prose form is not checked.
- [x] A skill whose contract comment has a stale pin, an unresolved anchor, or no comment produces a `skill-drift` warning.
- [x] `specplane spec pin <id>` writes `based_on` (only that key changes; formatting and key order are preserved), prints `pinned <ref> <hash>` per entry, and refuses with "commit or stash changes to `<path>` first" when a referenced file has uncommitted changes.
- [x] All unit tests pass.

## Tasks

1. Implement `src/git/blobs.ts`: `committedBlob`, `hasUncommittedChanges`, `readBlob` per `architecture/reference-cli` § Base pins, using the shell-free git runner from step 02.
2. Implement `src/spec/slug.ts`: `slugify`, `headingSlugs` (GitHub rules; `-1`, `-2` suffixes for duplicates; fenced code blocks skipped). Leave step `context` anchors on `findHeading` from step 03: they match heading text, not slugs (`feature/plan-steps` § `context` entries).
3. Implement `src/spec/pins.ts`: `normalisedHash`, `checkPins`, `approveGuard`, `writePins`. Add `specs.pin_bases` to the config defaults and schema if step 02 did not.
4. Add the anchor check: scan spec bodies for `<id>#<slug>` references and warn when the slug is not in `headingSlugs` of the resolved spec.
5. Implement `src/spec/skill-drift.ts` per `architecture/reference-cli` § Skill contract drift.
6. Wire the pin, anchor, and skill-drift checks into `validate` (finding types `base-changed`, `pin`, `anchor`, and `skill-drift` from § Validation output format; severities per `feature/spec-overlays` § Validation rules for overlays).
7. Implement `src/commands/spec-pin.ts` (`spec pin <id> [<ref-id>...]` and `spec pin --check`) and register it under `spec` in `src/cli.ts`.
8. Unit tests: slugs (punctuation, duplicates, code blocks), normalised hash, each `pin_bases` value, stale and missing-object cases (use a temp git repo), `writePins` round-trip, anchor check, skill drift. Extend the integration test with `specplane spec pin --check`.

## Guidance

- Use the real git object store in tests: create a temp repo, commit a base spec, pin it, commit a change, and check the finding. Do not mock `git rev-parse`.
- Abbreviate written pins to 7 characters, longer only if ambiguous (`git rev-parse --short`).
- **Gap: skill discovery.** "A skill directory registered by an installed harness" is not defined until the `init --harness` plan. Until then, check `SKILL.md` files under the directories a harness overlay lists as Specplane-owned skill locations (for Claude: `.claude/skills/*/` and `harnesses/claude/templates/skills/*/` if present), behind one function (`skillDirs(config, root)`) so the later plan can replace it. Record this gap in the plan's HANDOFF.md.
- Finding messages are in `architecture/file-formats` §1.5 (including the `pin` type for missing, unresolvable, and invalid pins); the skill contract comment format is §1.6. `feature/tooling` § `specplane spec pin` defines the command's output and errors.
- After this step, finish the plan by hand (the finish flow is implemented by a later plan), following `feature/plan-execution` § Finish flow: check all steps are done, run the tests, rebase onto `main`, then set `status: done`, move the folder to `plans/archive/`, commit, and merge according to `plans.merge` (`local_merge` in this repo: merge `--no-ff` into `main` in the main checkout after the user confirms).
