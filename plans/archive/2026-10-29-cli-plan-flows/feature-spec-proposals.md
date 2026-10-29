# Feature spec proposals — 2026-10-29-cli-plan-flows

Status: needs user review. Feature specs are `llm_role: assist`, so none of these edits has been applied. Each section gives the target, the current text, the proposed replacement, and the reason.

## 1. `feature/tooling`: add `specplane plan restack <id>`

**Target**: `docs/specifications/features/tooling.md`, section `## specplane plan`, after `### specplane plan finish <id>` (before `### specplane plan abandon <id>`).

**Problem**: `feature/plan-execution` § Restacking and Scenario 6a describe restacking, and the finish flow performs it automatically, but `feature/tooling` has no command to run it explicitly. `architecture/reference-cli` (Restack, trigger 1) already documents `specplane plan restack <id>` as an extension that depends on this proposal. Without it, the resume message "run `specplane plan restack <id>`" points at an undocumented command.

**Current text**: none (the command is absent). Neighbouring entry for style:

> ### `specplane plan finish <id>`
>
> Executes the finish flow for a plan. See `feature/plan-execution`.

**Proposed text** (insert after the `plan finish` entry):

> ### `specplane plan restack <id>`
>
> Restacks a stacked plan: replays only the plan's own commits onto the new base. See `feature/plan-execution` § Restacking. When the base plan has merged, the new base is the default branch and the plan is no longer stacked afterwards; when the base plan's branch has been rewritten, the new base is that branch's new tip. Conflicts stop the command and are surfaced to the human; they are never resolved automatically.
>
> **Options**:
> - `--dry-run`: print the base the plan would be replayed onto and the commits that would be replayed; change nothing.
>
> **Exit codes**:
> - `0`: the plan was restacked (or was already up to date).
> - `1`: any error.
>
> **Error cases**:
> - No plan with that ID → exit 1, "Plan `<id>` not found."
> - The plan is not stacked → exit 1, "Cannot restack: `<id>` is not stacked."
> - Conflicts while replaying → exit 1, with the conflicting files listed and the checkout left mid-rebase for the human to resolve.

Also add to the `plan start` entry (optional, small): "When resuming a stacked plan whose base plan has since merged, prints 'Base plan `<base-id>` has merged; run `specplane plan restack <id>`.' and continues; resume never rewrites history." This matches Scenario 8 in `feature/plan-execution`, which today does not mention it.

**Reason**: makes the explicit trigger a documented, testable command with defined exit codes, and keeps the architecture spec's extension from being an orphan. The "not stacked" text matches the `PlanStateError` text already used in `architecture/reference-cli`.

## 2. `feature/plan-steps`: HANDOFF section when a `blocked` step is re-run

**Target**: `docs/specifications/features/plan-steps.md`, section `## HANDOFF.md`, subsection `### Sections in each step's entry` (after the closing paragraph "All sections are required...") and the `## Edge cases` list.

**Problem**: the spec says HANDOFF.md has "a section per ended step" and that it is appended to by every later step, but does not say what happens when a `blocked` step is resumed and ends again: is the earlier section edited, or is a second section added? `architecture/file-formats` §4.1 already answers: "When a blocked step is later resumed, a new section with the same heading is appended; earlier sections are never edited." The feature spec is silent, and "a section per ended step" can be read as one section per step.

**Current text** (`## HANDOFF.md` intro):

> `HANDOFF.md` is created by the first step that ends and appended to by every later one (done, skipped, or blocked). It is the primary context carrier between sessions.

**Proposed text** (add as a new paragraph after the "All sections are required..." paragraph):

> When a `blocked` step is run again and ends, its new entry is appended as another section with the same `## Step NN: <title>` heading; earlier entries are never edited. A step can therefore have several entries, for example one `blocked` followed by one `done`. The latest entry for a step is authoritative: its `**Outcome**` must equal the step's current status, and a reader looking for the state of that step uses the last section with that heading. The earlier `blocked` entry stays as the record of why the step was stopped.

And add one bullet to `## Edge cases`:

> - A step that was `blocked` and is re-run gets a new HANDOFF.md section; the earlier `blocked` section is kept unchanged and the latest section wins.

**Reason**: removes the ambiguity, aligns the feature spec with `architecture/file-formats` §4.1, and keeps HANDOFF.md append-only as the "Never edit earlier sections" rule in the plan-step workflow requires. Validation of "Outcome equals status" should then check only the latest section per step; `architecture` already allows this, so no further architecture change is needed.

## 3. `feature/plan-steps`: example paths trip the architecture-leak guard

**Target**: `docs/specifications/features/plan-steps.md`, outside fenced code blocks: line 72 (the `context` entries table) and Scenarios 1 and 2 (lines 254-262).

**Problem**: `specplane spec validate feature/plan-steps` reports 6 warnings, all "Possible architecture detail (path)", from the `src/...` examples. The guard flags any path containing a slash, so only path-free examples avoid it. (The fenced examples at lines 46 and 185-211 are exempt because fences are ignored.)

**Current text**:

> `| `file:` | `file: src/graph/` | A file or directory path relative to the repository root |`
>
> Given a step's `context` lists `file: src/parser/`,
> When the agent begins the step,
> Then the agent reads `src/parser/` and HANDOFF.md, and does not read unrelated files without need.
>
> Given a step file lists only `src/parser/`,
> When the agent discovers it also needs `src/types/spec.ts`,
> Then the agent reads `src/types/spec.ts` and records in HANDOFF.md: "Context expanded: read `src/types/spec.ts` (not listed in step 02); step 03 context list should include it."

**Proposed text** (names with no slash, so they read as neutral repository documents rather than a code layout):

> `| `file:` | `file: CONTRIBUTING.md` | A file or directory path relative to the repository root |`
>
> Given a step's `context` lists `file: CONTRIBUTING.md`,
> When the agent begins the step,
> Then the agent reads `CONTRIBUTING.md` and HANDOFF.md, and does not read unrelated files without need.
>
> Given a step file lists only `CONTRIBUTING.md`,
> When the agent discovers it also needs `STYLE.md`,
> Then the agent reads `STYLE.md` and records in HANDOFF.md: "Context expanded: read `STYLE.md` (not listed in step 02); step 03 context list should include it."

Optional, same reason: the fenced examples (lines 46 and 185-211) may keep `src/...` since the guard ignores fences, but switching them to the same neutral names would keep the spec consistent and avoid depending on the fence exemption.

**Reason**: removes all six warnings without changing the meaning of the scenarios, and keeps feature specs free of implementation layout, as `forbid_architecture: true` intends. After the edit, run `specplane spec validate feature/plan-steps` (expect 0 warnings) and `specplane spec pin --check`, since plans and architecture specs may pin this spec.
