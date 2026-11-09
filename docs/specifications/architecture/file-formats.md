---
id: architecture/file-formats
title: File formats
status: awaiting-review
authors:
  - llm: claude-sonnet-5-5
    contribution: drafted
implements: [specifications R1, specifications R2, specifications R5, specifications R7, specifications R9, specifications R10, specifications R10.1, specifications R11, specifications R11.1, specifications R11.2, specifications R11.3, specifications R11.4, specifications R40, plans R28, plans R29, plans R29.1, plans R29.2, plans R30, plans §2, plans §2.1, plans §2.2, plans §3, configuration R25, configuration R25.1, roles-and-permissions R50, roles-and-permissions R56, roles-and-permissions R57, roles-and-permissions R44, roles-and-permissions R48, requests R52, requests R52.2, requests R52.4, verification R13, verification R13.1, verification R36.2, verification R61.1, verification R61.3, verification R61.4, cli R16, cli R17.2, plan-execution R27, plan-execution R27.2, plan-execution R27.4]
references: [plans R29.3, plan-execution R31.1, verification R32, verification R36.1, verification §3, roles-and-permissions R42.1, roles-and-permissions §2, configuration §2, requests §2, requests R52.1, plans §3.1, plan-execution R27.1, steering R59.1, later-releases R37, later-releases R39.3, R11, R2, architecture/repository-layout §6, plan-execution R27.6, architecture/reference-cli §13.4]
---

# File formats

This spec fixes the concrete files Specplane reads and writes: specification files and their metadata, the content fingerprint that binds approval to content, plan record files, the configuration file, role and preset storage, request records, the audit log, test results and logs, and the rules for identifiers and names. Where the files live in a repository is `architecture/repository-layout`; how the CLI parses and checks them is `architecture/reference-cli`. Details the feature specs leave open are marked "assumption".

All Specplane-written text files are UTF-8, use LF line ends and end with one newline. Metadata is YAML 1.2 restricted to JSON-compatible values (no custom tags, no duplicate keys, string keys only, dates written as quoted-or-plain `YYYY-MM-DD` and read as strings).

## §1 Files and identifiers

Implements `specifications R7`, `specifications R5`, `specifications R1`, `specifications R2`.

### §1.1 Specification files

- One markdown file per spec. Feature and architecture specs: `<layer-dir>/<slug>.md`, ID `feature/<slug>` or `architecture/<slug>`. The ID is derived from the path and written in `id`; a mismatch is a format error naming both. The layer directories come from the configuration (`§6`).
- A slug is `[a-z0-9]+(-[a-z0-9]+)*`. A spec lives directly in its layer directory; nested folders are not specs (assumption).
- `INFO.md` in a folder is documentation. It has no frontmatter; if it has, validation reports it as probably a misnamed spec. A file with no valid frontmatter is reported invalid.
- A spec file is: frontmatter block (`---` fences, first line of the file), then the body in markdown.
- A spec is retired by deleting the file; there is no `deprecated` status.
- A requirement file's ID is `requirement/<file-stem>` (`§1.2`). It is not a spec layer and has no section headings; it is cited whole by that ID or by requirement ID.

### §1.2 Requirement files

Implements `specifications R1`, `specifications R2`.

- Requirements are markdown files in the requirements directory (`§6`). One file or several; with several, one central file lists each other file by file name (a markdown list item `- <file-name>: <description>`), and files cite each other by file name.
- **Which file is central.** The file named by `paths.requirements_index` (`§6`); when that is unset, the only markdown file in the requirements directory, else `index.md`, else `README.md`. With none of these, or several candidates and no setting, validation reports an error naming the candidates, and until it is fixed every `.md` file in the directory is read in name order (assumption: the page, `R2`, says only that one central file exists).
- A requirement starts at a marker line, alone on its line: `**R<n>: <Title>**` for a top-level requirement, `*R<n>.<m>: <Title>*` (and deeper, `R<n>.<m>.<k>`) for sub-requirements. The requirement's text runs to the next marker of equal or shallower depth, or to the next heading, whichever comes first, so a requirement's content for citing purposes includes its sub-requirements and nothing after them (`§3.4`).
- A line `Retired IDs: ` followed by comma-separated backticked IDs lists retired requirement IDs. The first such line found in the central file is authoritative; other files may not carry one.
- A requirement file may carry the same frontmatter as a spec (`§2`) with `id: requirement/<file-stem>`; it is optional and a requirement file without it has status `awaiting-review` and no approval (assumption). The product requirements page is owned by the user; Specplane never edits it unless asked.

### §1.3 Requirement IDs

Implements `specifications R1`.

- Form: `R<number>` with sub-IDs `R<number>.<number>(.<number>)*`, numbers without leading zeros. An ID is unique across the project's requirement files.
- IDs are permanent. A removed requirement's ID is added to the retired list and never reused. The next new top-level requirement is the highest ID ever used (live or retired) plus one. A new sub-requirement takes its parent's highest child number plus one.
- Validation reports: a duplicate ID (naming both places), a live ID that is also retired, and a sub-ID whose parent does not exist.

## §2 Specification frontmatter

Implements `specifications R7`, `specifications R9`, `specifications R10`, `specifications R10.1`, `specifications R11`, `specifications R11.1`, `specifications R11.4`.

```yaml
---
id: feature/<slug>            # required; layer/slug, equals the path
title: <Title>                # required, non-empty single line
status: awaiting-review       # required; awaiting-review | approved
approval:                     # present only when status is approved (§2.3)
  by: {llm: claude-sonnet-5-5, delegated-by: spiralsky}
  date: 2026-11-09
  commit: <40-hex commit hash>
  fingerprint: spec-v2:sha256:<hex>        # assumption, §4.4
  cited: {"plans R28": "sec-v1:sha256:<hex>"}  # assumption, §4.4; absent in the hand format (§2.3)
  note: <free text>           # optional
  override: {by: {human: admin}, date: 2026-11-10}   # present only when set by an override (§2.4)
review-reason: edited         # present only when status is awaiting-review (§2.5)
authors:                      # required, may be empty
  - human: <name>
  - llm: <model id>
    contribution: drafted     # optional (R10.1)
covers: [R1, R2]              # feature specs, optional (empty is valid)
implements: [plans R28]       # architecture specs, optional
references: [R7, plans R28]   # every other cite used in the body
results: []                   # §11.1, optional
implementation: {}            # architecture specs only, §11.3, optional
---
```

### §2.1 Fields

| Field | Type | Rule |
|-------|------|------|
| `id` | string | `<layer>/<slug>` for `feature` and `architecture`; equals the file path |
| `title` | string | Any non-empty text |
| `status` | enum | Exactly `awaiting-review` or `approved`. Any other value is a format error |
| `authors` | list | Items are `{human: <name>}` or `{llm: <model id>}`, each with an optional `contribution` string. Only recorded facts; an unknown identity is `unknown`, never guessed. Earlier entries stay; approval does not add an author. Recording LLM authors follows `authorship.record_llm` (`§6`) |
| `covers` | list of cites | Feature specs: requirement IDs the spec has a heading for (parent and sub-requirements). Each item is a cite (`§3`) that must resolve to a requirement |
| `implements` | list of cites | Architecture specs: feature spec sections (`<slug> R<n>`, `<slug> §<n>`) the spec builds. Resolve to a section |
| `references` | list of cites | Every cite used in the body, deduplicated, plus cites that are neither `covers` nor `implements`. A body cite missing from `references`, `covers` and `implements` is a format error; a listed item the body never uses is a warning |
| `approval` | map | `§2.3`. Absent unless `status: approved` |
| `review-reason` | string or list | `§2.5`. Absent when approved |
| `results`, `implementation` | | `§11` |

Unknown top-level fields are reported as warnings and are included in the content fingerprint (conservative, `§4.2`). A spec may not set `covers` and `implements` for the wrong layer: `covers` on an architecture spec or `implements` on a feature spec is a format error.

`covers` and `implements`, together with `references`, are the spec's dependencies (`specifications R9`): the set used for outdated checks (`§4.5`), coverage and approval order.

### §2.2 Status is computed

The stored `status` records what a person or command last wrote. The effective status the CLI reports is computed from committed content (`§4.5`): a stored `approved` whose approval no longer holds is reported `awaiting-review` with its reason (`specifications R11.4`). Commands that write approval keep the stored value in step with the computed one; a stale stored value is a warning.

### §2.3 Approval block

Implements `specifications R11`, `specifications R11.1`, `cli R16`.

- `by` uses the author item form. A human approver is recorded as the identity of the person running the command; an LLM approver as `llm: <model id>` with `delegated-by: <human>` naming the human whose instruction allowed it. The CLI takes the person's name from git `user.name` and cannot be told another (`cli R16`).
- `date`: the day the approval was recorded.
- `commit`: a real commit that contains the final approved content, the last commit that changed the spec's content before the approval edit. The approval edit itself is a metadata-only commit. This is the last content commit and not the commit the status was set on (`specifications R11`): a file cannot name the commit that contains it, and the last content commit identifies the same approved content.
- `fingerprint`, `cited`: see `§4.4`. Assumption: needed so that approval survives rebase and squash merge, where `commit` may no longer exist.
- **Hand format.** An approval written by hand has neither field. It is valid while `commit` is reachable, and `§4.5` checks it by reading the spec and each cited part as committed at `commit` and comparing them with now; a cited target that did not exist at `commit` counts as changed. It stays approved until the spec or a cited part really changes, so the hand-approved specs are not reopened by the first read of this format. The CLI writes `fingerprint` and `cited` into the block the next time it records approval of that spec (`cli R16`). Where `commit` is not reachable the approval cannot be checked: the spec is `awaiting-review` with reason `edited` and a warning (assumption).
- `note`: optional free text.
- A group of specs that cite each other is approved by one command and each member gets its own block with the same `by` and `date` (`cli R16`).

### §2.4 Overrides

Implements `cli R17.2`.

A value set by an override permission (status, approver, test result) carries a mark, the same map in both places: `approval.override: {by: <author item>, date: <date>}` for status or approver, `override: {by: <author item>, date: <date>}` inside a result (`§11.1`). The mark stays until a normal action replaces the value. An overridden approval is written with a real `fingerprint` and `cited`, computed from the committed content at the moment of the override, so it is checked like any other approval: a later content or cited-part change returns the spec to `awaiting-review` (`cli R17.2`).

### §2.5 Review reason

Implements `specifications R11.3`, `specifications R11.4`.

`review-reason` is a string, or a list of strings when several apply, from this grammar:

- `never-approved`: no approval was ever recorded (the default for a new spec; may be omitted);
- `edited`: a commit changed content after approval;
- `outdated: <cite>`: a cited part changed or was deleted since approval; one item per cited part, for example `outdated: plans R28`;
- `unapproved-dependency: <cite>`: the cite resolves to a spec that has no `approval` block (never approved, or reopened); one item per such cite (`specifications R11`, `§4.5` step 4).

The CLI writes and clears this field when it records a status. It is derived data: when it disagrees with the computed reason the computed reason is shown and the stored one is a warning. When a person edits a spec by hand they set `status: awaiting-review`, remove `approval`, and set `review-reason: edited` (git keeps the old record).

## §3 Citations

Implements `specifications R7`, `specifications R9`.

### §3.1 Grammar

```
cite     = file-ref | [project ":"] target
project  = "root" | NAME                    ; NAME = [a-z0-9][a-z0-9-]*, not "root" or "file" when naming a subproject
target   = req | section | spec | file-req | plan-ref
req      = "R" N ("." N)*                   ; R11, R11.2
section  = [layer "/"] slug SP ("R" N ("." N)* | "§" N ("." N)*)
spec     = [layer "/"] slug                 ; whole spec; avoid
req-file = "requirement/" slug              ; a whole requirements file (§1.2)
file-req = FILE "#" req                     ; requirement in a named requirements file, assumption
plan-ref = "plan/" PLAN-ID                  ; a plan (§5.1)
file-ref = "file:" PATH                     ; a repository file, relative to the root (§12.3); no project prefix
layer    = "feature" | "architecture"
```

A name without a layer is a feature spec. `req-file` is the only place the layer `requirement` is used. `plan-ref` and `file-ref` take no project prefix; `file` is reserved so that `file:docs/x.md` never parses as project `file` (assumption: this extends the `root` restriction of `later-releases R39.3`). The project prefix is an assumption of the feature specs (`specifications R7`); no prefix means the citing spec's own project, `root` names the root project (`later-releases R39.3`).

### §3.2 Where a cite appears

- In frontmatter: `covers`, `implements`, `references` items, written as plain strings (quoted when YAML needs it), and the `context` items of a step file (`§5.3`).
- In the body: an inline code span whose whole content is a cite, for example `` `plans R28` ``. A cite in a fenced code block, or a span with other text, is not a cite. A list of cites inside parentheses is written as one span per cite.
- A cite span that appears in a section whose own heading defines that same target is not a dependency (a section does not cite itself).
- Assumption: prose that merely mentions a requirement without backticks is not a cite.

### §3.3 Section headings

A citable section heading is an ATX heading of level 2 to 6 matching:

```
heading  = "#"{2,6} SP ("R" N ("." N)* ":" | "§" N ("." N)* ) SP TITLE
```

`## R11: Spec status`, `### R11.2: Outdated specs`, `## §2 Edge cases`, `### §2.1 Handoff entries`. The heading's number is its ID; it must be unique within the file, and a `R<n>.<m>` heading nested under a different parent than `R<n>` is reported. In a requirement file the target is the marker line (`§1.2`).

### §3.4 Resolution

1. Choose the project: the prefix if given, else the citing spec's project. An unknown prefix is an error.
2. `R<n>`: find the marker in the project's requirement files. Zero matches: error "requirement not found"; if the ID is on the retired list, say so. More than one: duplicate error.
3. `[layer/]slug R<n>` or `§<n>`: find the spec file by ID, then the heading in it. A spec that exists but has no such heading: error "section not found".
4. A whole-spec cite resolves to the file.
5. A cite of a requirement (`R<n>`) resolves to the requirement and its sub-requirements. A cite of a section resolves to the heading line through the line before the next heading of equal or lower level (so its subsections are included). The cited text is the part's content (`§4.3`).

6. `plan/<id>` resolves to the plan folder (and its `PLAN.md`); `file:<path>` resolves to the file. A plan or file that does not exist is an error naming the cite.
7. `requirement/<file-stem>` resolves to the requirements file.

A cite to a spec whose ID is not yet written (a planned slug) is reported as unresolved; a plan or earlier draft keeps those at requirement level. Specplane never rewrites cites on its own.

## §4 Content fingerprint and approval binding

Implements `specifications R11`, `specifications R11.2`, `specifications R11.3`, `specifications R11.4`, `specifications R40`.

### §4.1 Purpose

Approval is bound to a spec's committed content, not to a commit hash, so it survives rebase and squash. Two fingerprints are used: one for the whole spec (`spec-v2`), one for a cited part (`sec-v1`).

### §4.2 Spec fingerprint `spec-v2`

Adapted from the earlier `spec-v1` (assumption: version bumped because the exclusion list changed).

Serialize a JSON object with exactly `frontmatter` and `body`, encode as UTF-8, SHA-256 it, and write `spec-v2:sha256:<lowercase hex>`.

- `frontmatter` is the parsed frontmatter with these keys removed: `status`, `approval`, `authors`, `review-reason`, `results`, `implementation`. Everything else stays, including `id`, `title`, `covers`, `implements`, `references` and unknown keys. Mapping keys are sorted by Unicode code point, array order is kept, output is compact JSON with literal Unicode and standard escapes, numbers in ECMAScript form.
- `body` is everything after the closing `---` line and its newline, with CRLF and CR turned into LF. Nothing else is normalized: comments, whitespace and trailing newlines count, so a cosmetic edit is a content edit.
- Rule of the feature specs: content means the whole file except `status`, `approval` and `authors` (`specifications R11.3`). `review-reason`, `results` and `implementation` are metadata Specplane writes, so they are excluded as well (assumption).
- A change to any excluded field alone is not an edit.
- Decision (assumption): `title`, `covers`, `implements` and `references` count as content even though the page calls dependencies metadata (`specifications R9`). A changed dependency list changes what a spec means, and keeping it in the fingerprint means such a change is never missed. The cost is that merely reordering `references` is an edit; authors keep the lists in a stable order. A plan's fingerprint is the variant `plan-v1` of `§5.2`.
- Changing these rules needs a new version tag; an old digest is never reinterpreted.

### §4.3 Part fingerprint `sec-v1`

The part text (`§3.4` step 5), CRLF to LF, with trailing blank lines removed, then `sec-v1:sha256:<hex>` of its UTF-8 bytes. A whole-spec cite uses the `spec-v2` fingerprint of the cited file. A part that no longer resolves has no fingerprint, which counts as changed (`specifications R11.2`: deletion is a change).

### §4.4 What approval stores

At approval the CLI writes into `approval`:

- `fingerprint`: the `spec-v2` fingerprint of the spec's committed content at `commit`;
- `cited`: a map from each dependency cite (`covers`, `implements`, `references`, as written) to the part fingerprint of the cited part as committed at approval time. A spec approved by hand has no `cited` map (`§2.3`).

Assumption: these two fields extend the approval record in the shared format so that validity does not depend on `commit` being reachable.

### §4.5 Computing the effective status

From the committed state of the current branch (`specifications R40`); uncommitted edits are ignored and reported as a note.

1. Read the spec at HEAD. If `status: awaiting-review` or no `approval`: effective status `awaiting-review`, reason `never-approved` (or the stored `review-reason`).
2. Compute `spec-v2` of the committed content. If `approval.fingerprint` exists and differs: `awaiting-review`, reason `edited`. If it is absent, compare with the content at `approval.commit`; a missing commit gives `awaiting-review`, reason `edited` with a warning that the approval cannot be checked.
3. For each cite in `approval.cited`: compute the part fingerprint now; if it differs or the part is gone, add `outdated: <cite>`. A dependency listed in `covers`, `implements` or `references` but absent from `cited` is treated as changed. Only cited parts count, never a change elsewhere in the cited spec. **When `approval.cited` is absent (hand format, `§2.3`)**, compute the part fingerprint of each dependency target as committed at `approval.commit` and compare it with the one computed now; a target that did not resolve at that commit counts as changed. A hand-approved spec therefore stays approved until a cited part really changes, and the next CLI approval records `cited`.
4. For each dependency that resolves to a spec (not a requirements file) whose own file has no `approval` block at HEAD, add `unapproved-dependency: <cite>` (`specifications R11`: a spec citing a never-approved spec is Awaiting Review). Only the presence of the block is read, never the cited spec's own status, so a change elsewhere in the cited spec does not matter (`specifications R11.2`). Members of a group approved in one command all have blocks, so a group is not affected.
5. If no reason was found, the spec is `approved`; otherwise `awaiting-review` with all reasons.

Approval order is also enforced when approving (`cli R16`), so a spec cannot normally be approved before what it cites; step 4 covers specs approved by hand or by override, and specs whose cited spec was reopened later. Plans use the same steps with the fingerprint of `§5.2`.

A hand-edited or CLI-written approval therefore never extends over later edits: only a fresh approval writes a new `fingerprint`.

A plan edit of a spec is an ordinary content edit (`specifications R11.3`): the plan does not approve it.

## §5 Plan record

Implements `plans R28`, `plans R29`, `plans R29.1`, `plans R29.2`, `plans R30`, `plans §2`, `plans §2.1`, `plans §2.2`, `plans §3`.

### §5.1 Layout and identifiers

A plan is a folder `<plans.dir>/<plan-id>/` (`§6`):

```
<plan-id>/
  PLAN.md                 plan metadata and body
  progress.yaml           execution state (§5.4)
  steps/NN-<slug>.md      one file per step (§5.3)
  HANDOFF.md              append-only step entries (§5.5)
  spec-gaps.md            gaps and assumptions, created on first entry (§5.6)
```

Archived plans live in `<plans.dir>/archive/<plan-id>/` with the same files. Shared files (conventions, notes) are other markdown files in `<plans.dir>` outside plan folders; plans cite them by path (`§12.3`).

- A plan ID is `YYYY-MM-DD-<w1>-<w2>[-<w3>[-<w4>]]`, lower-case words matching `[a-z0-9]+`, two to four words, at most 64 characters in all (assumption: keeps checkout paths short, `architecture/repository-layout §6`; longer IDs are rejected at creation). It equals the folder name and never changes. A mismatch is reported naming both.
- A plan is cited as `plan/<id>` (`§3.1`). Cites of plans and specs in a plan's `references` are dependencies; a missing target is reported, a reference cycle among plans is reported naming the plans before the plan can start.

### §5.2 PLAN.md frontmatter

```yaml
---
id: plan/<plan-id>
title: <Title>
status: awaiting-review          # awaiting-review | approved (§2, same rules)
approval: {...}                  # as §2.3
authors: [...]                   # as §2
implements:                      # specs this plan implements or writes, with the commit read
  - {spec: "feature/export", commit: <hash>, mode: writes|implements}
references: [plan/<other-id>, plans R28]
---
```

- `status` and `approval` follow `§2` and `§4`. The plan's content fingerprint is `plan-v1:sha256:<hex>` (assumption), computed like `spec-v2` (`§4.2`) over the PLAN.md frontmatter minus `status`, `approval`, `authors`, `review-reason` and the `commit` of every `implements` entry, plus the PLAN.md body; `progress.yaml`, step files and the handoff are not part of the plan's content (assumption: steps may be edited by the plan edit rules of `plan-execution R31.1`, and then the plan returns to `awaiting-review` only if PLAN.md itself changed).
- `implements` records the commit of each spec the plan was written against (`plans R29`). A later commit to that spec on the current branch that differs gives the outdated-reference warning naming plan, spec and both commits (`plans R29.3`). The pins are left out of the fingerprint, so updating one after checking what changed is a metadata edit that does not return the plan to `awaiting-review` or block starting it (`plan-execution R27.6`).
- Body sections, any order, any may be omitted: `## Goal`, `## Scope` (in and out), `## Specifications`, `## Acceptance criteria`, `## Risks`, `## Steps` (the list, one summary line each, `<NN> <title>: <summary>`).
- The plan's body cites with the same grammar and every cite appears in `references` or `implements`.

### §5.3 Step files

`steps/NN-<slug>.md`, `NN` a two-digit number from `01`, contiguous; duplicates or gaps are errors.

```yaml
---
plan: <plan-id>            # equals the folder
step: 2                    # equals NN
title: <Title>
writes: [feature/export]   # specs this step writes (R30.1), optional
implements: [feature/import]   # specs it implements, optional
context: ["plans R28", "file:docs/x.md"]   # cite strings: spec parts or repository files (§3.1)
---
```

- Body sections: `## Goal`, `## Acceptance criteria`, `## Tasks` (ordered list), `## Context` prose if needed, optional `## Guidance`.
- A step has no status in its file. The step is done when `progress.yaml` lists it (`§5.4`). There is no skipped or blocked state (`plans §3.1`).
- The body is not edited once the step has started; deviations go in the handoff.
- A `context` or `implements` item that does not resolve is reported; a `file` that does not exist yet is a warning.

### §5.4 progress.yaml

Implements `plans R29.1`, `plans R29.2`, `plan-execution R27`, `plan-execution R27.2`.

```yaml
status: not-started          # not-started | in-progress | stopped | completed | abandoned
target_branch: main          # set when the plan starts
start_commit: <hash>         # commit the plan branch was created from
branch: plan/<plan-id>
current_step: 3              # derived: lowest-numbered step not in done
done: [1, 2]
budget:                      # optional, set by plan budget
  - {resource: weekly, soft: 80, hard: 95}
session: <harness session id>        # last session that worked on it, optional
stop:                        # present only when status is stopped
  kind: soft                 # soft | hard | user | failure
  reason: <text>             # for example "session ended unexpectedly"
  needs: <what a person or later session must do>
final_review:                # present after the final review is opened
  decision: completed | back-in-progress
  reason: <text>
  by: {human: <name>}
```

- `completed` and `abandoned` are terminal. The status also tells the archive's two kinds apart; archiving moves the folder and is not a status (`plans R29.2`). Deleting a plan removes the folder.
- A run that ended without writing a stop leaves `in-progress`; the next status read reports `stopped` with reason `session ended unexpectedly` without rewriting the file (`plan-execution R27`).
- Resuming clears `stop` and sets `in-progress`; the earlier stop reason stays in `HANDOFF.md`.
- `current_step` is derived data, kept for readers of the file; a reader recomputes it from `done` and ignores a stored value that disagrees (validation warns).
- `budget` holds the plan's soft and hard limits per resource (`plan-execution R27.1`: limits and stops are attached to the plan metadata). It is written with the plan's other progress data and committed on the plan branch, so a session resumed on another machine reads it. Usage readings are not stored: the adapter measures them. A stop caused by a limit is the `stop` entry above, with the limit named in `reason`. Budgets never span plans.
- The worktree path is local state, kept in the local store (`§9.1`), not here.

### §5.5 HANDOFF.md

Implements `plans §2.1`, `plan-execution R27.4`.

Append-only. Each ended step adds one entry:

```markdown
# HANDOFF: <plan-id>

## Step NN: <step title>

**Date**: YYYY-MM-DD
**Outcome**: done | partial

### What changed
- `<path>`: <reason>

### Deviations from the step
None. | <text>

### Gaps found
None. | - G<n> (<kind>): <one line>

### Open issues
None. | - <text>

### What the next step must know
<self-contained facts>
```

- All sections are present; one with nothing to report says `None.`. `partial` records a halted step and where a re-run starts (`plans §2.1`).
- A repeated step adds a new `## Step NN` entry; the last one for that step is authoritative; earlier ones are never edited.
- A step is done in `progress.yaml` only when its latest entry has outcome `done`; a mismatch is an error.
- A step with no project changes still ends with a commit of its entry (`plan-execution R27.4`).

### §5.6 spec-gaps.md

Implements `plans §2.2`.

```markdown
# Gaps and assumptions: <plan-id>

## G1: <short case>

**Kind**: gap | assumption | proposal
**Step**: NN
**Case**: <what the specs do not cover>
**Resolution**: <what was done; for a proposal, the proposed text>
**Target spec**: `<spec id>`[, `<spec id>`]
**State**: open | applied | rejected
```

- Headings `## G<n>: <case>`; `n` counts up from 1 within the plan and is never reused; a declined entry keeps its number with state `rejected`.
- All six fields are required, one per line, in the order shown. `Step` names an existing step. `Target spec` lists spec IDs that exist.
- Entries are added as `open`. Open entries never block a step or the final review; the review lists them (`plans R28`).

### §5.7 Commits

Plan commits follow `§8`. The final commit of a completed plan includes moving the folder to the archive (`plans R28`).

## §6 Configuration file

Implements `configuration R25`, `configuration R25.1`.

`.specplane/config.yaml` is the project's single saved configuration, tracked in git. Every key is optional; a project with no file works with all defaults. Keys are nested YAML mappings; the dotted names of `configuration R25` map to nesting (`plans.worktree_dir` is `plans: {worktree_dir: ...}`). Booleans are written `on`/`off` or `true`/`false` and read as the same value.

```yaml
paths:                      # assumption: the feature specs leave locations open
  requirements: docs/requirements
  requirements_index: null         # file name of the central requirements file (§1.2)
  features: docs/specifications/features
  architecture: docs/specifications/architecture
  test_logs: docs/test-logs        # used only when tests.logs is git (§11.4)
plans:
  dir: docs/plans
  worktree_dir: ../specplane-plans
  setup_command: "npm ci"
  start_conditions: on
  parallelism: 1                     # later release
notifications:
  push: off
  push_permissions: [all]            # permission ids (§7.1)
steering:
  custom: []                         # items {permission|command, scope, text}
permissions:
  preset: architecture-level-llm-control
harness:
  install_block: on                  # off forbids the marked block in shared files
  separation_check: on
  instructions: {}                   # command id -> replacement text
  retrieval_include_references: off
authorship:
  record_llm: on
audit:
  retention: 30                      # days or forever
auto_warn: on
architecture:
  llm_may_mark_implemented: on
tests:
  logs: local                        # local | git | off
  logs_retention: 30
pre_commit:
  duplicate_requirement_ids: off     # later release
  tests: off                         # later release
coverage:
  requirement_only: []               # requirement ids
decisions: {enabled: off}            # later release
subprojects: []                      # later release
strict_mode: {enabled: off}          # later release
bypass_guards: {}                    # later release
roles: {llm_rules: []}               # later release; os_user_mapping is local (§7.4)
```

### §6.1 Value types and defaults

| Key | Type | Default |
|-----|------|---------|
| `plans.dir`, `paths.*` | repository-relative path | `docs/plans`, `docs/requirements`, `docs/specifications/features`, `docs/specifications/architecture`, `docs/test-logs` (assumption) |
| `paths.requirements_index` | file name inside `paths.requirements` | unset: the rule of `§1.2` |
| `harness.install_block` | on/off | on (assumption: the page, `configuration R25`, has no such key; `off` stops setup writing the marked block into a shared instruction file and leaves the project's own files alone) |
| `plans.worktree_dir` | path | next to the project |
| `plans.setup_command` | string | none |
| `plans.start_conditions`, `notifications.push`, `harness.separation_check`, `harness.retrieval_include_references`, `authorship.record_llm`, `auto_warn`, `architecture.llm_may_mark_implemented` | on/off | as in `configuration R25` |
| `plans.parallelism` | integer > 0 | 1 |
| `notifications.push_permissions` | list of permission ids, or `[all]` | all |
| `permissions.preset` | preset id (`§7.2`) | `architecture-level-llm-control` |
| `audit.retention`, `tests.logs_retention` | integer days > 0, or `forever` | 30 |
| `tests.logs` | `local`, `git`, `off` | `local` |
| `coverage.requirement_only` | list of requirement IDs | empty |
| `steering.custom` | list of `{permission or command, scope, text}`; scope is `all` or a spec type or plan id (`steering R59.1`) | empty |

### §6.2 Reading and validating

- A key not in the table is an unknown-setting finding naming the key; a value of the wrong type, a non-positive number, an unusable path or a missing permission or preset is a malformed-setting finding naming key, problem and allowed values. A bad key is ignored, its default applies, and the file stays usable (`configuration R25`).
- Settings for later releases may be written; until the release exists they have no effect and are not unknown.
- Setting a value to its default and removing the key have the same effect; an explicit default is kept as written.
- There is no per-user override file in the first release; the saved file is the single source (`configuration §2`).
- A configuration change is permission-checked (`§7`) and audited (`§10`); the CLI preserves comments and key order when writing.
- A change takes effect from the next command.
- Terms retired with the old model are not read and are reported as unknown: `authorship` (as a policy), `llm_role`, `forbid_architecture`, `leak_guard_allow`, `spec_roots`, `decisions.dir`. Assumption: `authorship.record_llm` is the only `authorship` key.

## §7 Permissions, roles and presets storage

Implements `roles-and-permissions R50`, `roles-and-permissions R56`, `roles-and-permissions R57`, `roles-and-permissions R44`, `roles-and-permissions R48`, `configuration R25.1`.

### §7.1 Permission identifiers

Each standard permission has a stable lower-case dotted ID used in presets, steering, requests and the audit log. Assumption: the IDs below. A permission added by a new command brings its own ID and a default in every default preset.

| ID | Permission |
|----|------------|
| `spec.create.<type>`, `spec.edit.<type>`, `spec.delete.<type>` | `<type>` is `requirement`, `feature` or `architecture` |
| `spec.approve` | Approve specifications |
| `meta.read`, `meta.write` | Read, write specification metadata |
| `meta.write.title`, `.authors`, `.references`, `.covers`, `.approval` | Granular metadata writes (`.approval` covers date and commit) |
| `override.status`, `override.approver`, `override.test` | Protected overrides |
| `test.record` | Record a test result |
| `info.retrieve` | Information retrieval (viewing, review, validation, listing, coverage, test runs, audit reading) |
| `plan.meta.read`, `plan.meta.write`, `plan.meta.write.<piece>` | Plan metadata (later release) |
| `plan.edit`, `plan.create`, `plan.delete`, `plan.start`, `plan.abandon`, `plan.complete` | Plan actions |
| `plan.budget`, `plan.resume`, `plan.softstop` | Budget, resume, soft stop |
| `decision.add`, `decision.retrieve`, `decision.edit`, `decision.delete` | Later release |
| `config.change` | Change configuration, including `permissions.preset` |

`plan.complete` also guards `plan merge` (assumption: the page has no separate merge permission). Sending a request and accepting one have no permission of their own (`roles-and-permissions R50`). Management and system permissions (`mgmt.*`, `system.*`) are later-release and not part of a preset.

### §7.2 Default presets

The four default presets are built into Specplane (shipped as data it reads; assumption: embedded in the package, not in the repository), cannot be edited or deleted, and are selected by ID through `permissions.preset`.

| Preset ID | Number |
|-----------|--------|
| `architecture-level-llm-control` | 1, default |
| `full-manual-editing` | 2 |
| `feature-level-llm-control` | 3 |
| `full-llm-control` | 4 |

A preset file (embedded, same shape reusable by later custom presets) is:

```yaml
id: architecture-level-llm-control
title: Architecture-Level LLM Control
default_mode: deny                    # R56.1
roles:
  standard-user: {default_mode: allow, modes: {override.status: deny, override.approver: deny, override.test: deny}}
  llm:
    modes:
      spec.create.requirement: request-user
      spec.edit.requirement: request-user
      spec.delete.requirement: request-user
      spec.create.feature: request-user
      spec.edit.feature: request-user
      spec.delete.feature: request-user
      spec.create.architecture: allow
      spec.edit.architecture: allow
      spec.delete.architecture: allow
      spec.approve: request-user
      config.change: request-user
      info.retrieve: allow
      test.record: allow
      meta.read: allow
      meta.write: deny
      plan.create: allow
      plan.edit: allow
      plan.start: request-user
      plan.resume: request-user
      plan.abandon: request-user
      plan.complete: request-user
      plan.delete: request-user
      plan.budget: request-user
      plan.softstop: allow
      decision.retrieve: allow
      decision.add: request-user
      decision.edit: request-user
      decision.delete: request-user
```

- Modes are `allow`, `request-user`, `deny`. A permission a role does not list takes the role's `default_mode`, else the preset's, which is `deny` in the four presets.
- The Standard User role has `allow` for every standard permission except the three protected overrides (`roles-and-permissions R57`).
- The example is preset 1 and states every permission the LLM role has a mode for under `roles-and-permissions R57`; anything not listed, such as `meta.write.*` and the override permissions, is `deny` through `default_mode`. Presets 2 to 4 differ from it only in the nine `spec.*` entries (create, edit and delete are set together per type) and in `plan.create` and `plan.edit`; every other entry is the same in all four:

  | Preset | `spec.*.requirement` | `spec.*.feature` | `spec.*.architecture` | `plan.create`, `plan.edit` |
  |--------|------|------|------|------|
  | 1 | request-user | request-user | allow | allow |
  | 2 | deny | deny | deny | request-user |
  | 3 | request-user | allow | allow | allow |
  | 4 | allow | allow | allow | allow |
- The Administrator is not stored in a preset: it has every permission of every type and a management level above all others (`roles-and-permissions R42.1`). Management levels: Standard User 10, LLM 5.
- Resolution of the mode for a role and permission: role entry, else role `default_mode`, else preset `default_mode`, else `deny`. A permission needed for a command that is not a defined ID is a validation finding.
- The mode a role has applies everywhere, in the CLI and the harness, and a permission shared by two commands has one mode (`roles-and-permissions §2`).

### §7.3 Active preset

`permissions.preset` in `.specplane/config.yaml` (`§6`) names the active preset; the first release stores nothing else about roles in git. An unknown preset ID is a malformed-setting finding and the default preset is used.

### §7.4 Later release: custom roles, rules and mappings

Not read in the first release. Assumption for the shape:

- Custom roles, their modes, custom presets and LLM role rules (`roles.llm_rules`) are stored in git under `.specplane/roles/*.yaml` (`roles-and-permissions R48`); a role file holds `id`, `title`, `management_level`, `modes`. A change is pending until approved by a role with enough management permission and level (pending changes are request records, `§9`).
- An LLM role rule above the default LLM role applies only after the user trusts it locally; trust is recorded in the local store (`§9.1`, `trusted-rules.json`: rule fingerprint, date).
- OS user mappings (`roles.os_user_mapping`) are kept locally outside git: `os-users.yaml` in the local store (`§9.1`), mapping an OS user name to a role ID.
- Which role runs a command is resolved at run time from the environment and these files; it is never written into a spec or plan.

## §8 Commit messages

Implements `plans R28`. Referenced by the working rules of the repository (`AGENTS.md`).

Only commands or managed workflows that create commits need this format; ordinary work needs no Specplane trailers.

```
<type>(<scope>): <summary>

<body>

Specplane-Workflow: <workflow>
Specplane-Plan: <plan-id>
Specplane-Step: <NN>
Specplane-Agent: <harness>[/<model>]
Specplane-Session: <session-id>
<harness attribution trailer, e.g. Co-Authored-By>
```

- Subject: Conventional Commits; `<type>` is one of `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`, `perf`, `style`, `chore`; `<scope>` is the plan slug (ID without the date) for step commits, `specplane` for CLI housekeeping, otherwise optional; summary imperative, lower-case start, no final period, subject at most 72 characters (housekeeping subjects that embed full plan IDs are exempt).
- Trailers are the last paragraph in `git interpret-trailers` form, in the order above. `Specplane-Workflow` is required in managed commits; `Specplane-Plan` when in a plan; `Specplane-Step` for `step`; `Specplane-Agent` when an agent made the commit (`ci` for CI, absent for humans); `Specplane-Session` when the harness exposes an ID (the standing instruction sets the two from `SPECPLANE_AGENT` and `SPECPLANE_SESSION`).
- Workflows: `step` (`<type>(<slug>): <summary>`, on `plan/<id>`), `plan-create` (`docs(<slug>): create plan`), `spec` (`docs(specs): <summary>`), `approve` (`docs(specs): approve <id>` or `docs(<plan-id>): approve plan`; assumption: the page does not say that approval commits, see `architecture/reference-cli §13.4`), `start` (`chore(specplane): start <id>`), `finish` (`chore(specplane): finish <id>`), `abandon` (`chore(specplane): abandon <id>`), `archive`, `plan-edit` (`docs(<slug>): edit plan`), `stop`, `resume`, `budget` and `retarget` (`chore(specplane): <verb> <id>`). Metadata-only commits of Specplane-written spec records (reopen, override, metadata set, recorded test result, implementation status) use workflow `spec` with summaries such as `docs(specs): record result for <id>` (assumption).
- Specplane never sets author or committer; they come from git config.
- The approval commit of a spec (`§2.3`) is a metadata-only commit with workflow `approve`; the commit named in `approval.commit` is the content commit before it.
- Assumption: the old `claim`, `stack`, `shelve` workflows and the `Specplane-Stack-Base` and `Specplane-Contribution` trailers are dropped with base pins and provenance events; authors are recorded in the spec (`§2`).

## §9 Request records

Implements `requests R52`, `requests R52.2`, `requests R52.4`.

### §9.1 Local store

Assumption: state that is not content of the project (requests, audit log, logs, run markers, review records, instruction-delivery records, the role switch, trust and OS mapping) is stored under `<git common dir>/specplane/`, not under the working tree, so it is never committed or tracked, and every worktree of the repository, including plan worktrees, sees the same store.

```
<git-common-dir>/specplane/
  requests/<request-id>.json
  audit.jsonl
  logs/<log-id>.log
  worktrees.json            plan id -> worktree path
  runs/<plan-id>.json       run marker (§9.3)
  reviews/<plan-id>.json    target commit seen by the final review (§9.3)
  sessions/<session-id>.json  instructions already delivered (§9.3)
  role.json                 Administrator switch (§9.3)
  tmp/                      temporary checkouts for test runs and pre-commit checks
  trusted-rules.json        later release
  os-users.yaml             later release
```

### §9.2 Request file

One JSON file per request, in `requests/`. IDs are `<YYYYMMDDTHHMMSSZ>-<4 hex>`.

```json
{
  "id": "20261109T101500Z-a3f9",
  "state": "pending",
  "created": "2026-11-09T10:15:00Z",
  "from": {"role": "llm", "model": "claude-sonnet-5-5", "session": "<id>"},
  "permissions": ["spec.edit.feature"],
  "action": {"command": "spec edit", "params": {"spec": "feature/plans", "patch": "<unified diff of the proposed change>"}},
  "reason": "plain words",
  "base": {"branch": "main", "commit": "<hash>"},
  "diff": "<git diff text against the last approved version, when it concerns a spec>",
  "plan": "<plan-id or null>",
  "blocking": false,
  "answer": null
}
```

- `state` is `pending`, `accepted`, `declined` or `failed`. `failed` is an assumption beyond `requests §2`, which says only that an action that cannot be done is reported and does nothing: the request is then marked `failed` (accepted, but the plan is gone or the patch no longer applies), counts as answered and is not retried, so the list shows why nothing happened. `answer` is `{by, date, note}` once answered; `failed` adds `error`.
- Requests never expire and stay in the list after answering (`requests R52.1`).
- `permissions` lists every permission the requested action needs (a command may need several, `roles-and-permissions R50`), and the accepting role must hold each with `allow` (`requests R52.2`). `params.patch` is the stored change a spec edit applies on accept. The check is made at accept time against the permissions then in force; a pending record is never rewritten when the preset changes.
- On accept the action is checked again against the current state (`base` is only context for display); the diff is recomputed for display.
- Writes use write-to-temp then rename, so a concurrent writer never leaves a partial file. Accepting uses the file's `state` as a compare-and-set to avoid a double accept (assumption).
- A request to change configuration holds `params: {key, old, new}` (`configuration R25.1`).

### §9.3 Other local files

Assumption: the files of the local store besides requests, the audit log and logs.

- `runs/<plan-id>.json`: run marker `{"session": "<id>", "pid": 1234, "heartbeat": "2026-11-09T10:15:00Z"}`, kept up to date by the adapter while a session works and removed on a clean end.
- `reviews/<plan-id>.json`: `{"target_branch": "main", "target_commit": "<hash>", "seen": "2026-11-09T10:15:00Z"}`, the target tip the final review was shown against.
- `sessions/<session-id>.json`: `{"epoch": 0, "delivered": [{"key": "<instruction key>", "hash": "<sha256>"}]}`, the instruction texts already delivered in the session and the compaction epoch.
- `role.json`: `{"role": "administrator", "since": "2026-11-09T10:15:00Z"}`, present only while the Administrator switch is on (`roles-and-permissions R44`).
- `tmp/`: temporary checkouts, removed when the command ends.

Writes use the temp-file-and-rename rule of `§9.2`. A missing file is the empty or default state.

## §10 Audit log

Implements `verification R13`, `verification R13.1`.

`audit.jsonl` in the local store (`§9.1`): one JSON object per line, appended, never committed and shared by worktrees.

```json
{"ts":"2026-11-09T10:15:00Z","branch":"plan/x","actor":{"role":"standard-user","kind":"human","name":"spiralsky"},
 "model":null,"command":"spec approve","args":["feature/plans"],"permission":"spec.approve",
 "outcome":"done","reason":null,"old":null,"new":null,"request":null}
```

- `actor.kind` is `human` or `llm`; `model` is set when the harness reports it. `outcome` is `done`, `refused`, `request-sent`, `cancelled` or `failed`; `reason` explains a refusal (permission or failed test). Changes carry `old` and `new` values (configuration, metadata, status, approver, test result overrides). A bad write of the line itself does not stop the action: Specplane warns once per command (`verification R13`).
- The command runner writes an entry for every command it runs, reads included (`verification R13`: all actions). File contents and test output are never stored; test output is in the logs (`§11.4`).
- Retention (`audit.retention`): on each command entries older than the retention are dropped by rewriting the file through a temp file and rename, and one entry `{"command":"audit prune","new":{"removed":N,"oldest":"<date>"}}` is appended. `forever` prunes nothing.
- A person reads it through the CLI; an LLM only if its role holds `info.retrieve`.
- A line that cannot be parsed is skipped and reported by validation as a warning.

## §11 Test results, implementation status and logs

Implements `verification R61.1`, `verification R61.3`, `verification R61.4`, `verification R36.2`.

### §11.1 Results in frontmatter

Results live in the spec's own `results` list (`verification R61.1`); the field is excluded from the content fingerprint (`§4.2`).

```yaml
results:
  - test: "R11#1"                     # §11.2
    kind: deterministic               # deterministic | intelligent
    outcome: passed                   # passed | failed
    by: {human: spiralsky}            # or {llm: claude-sonnet-5-5}
    date: 2026-11-09
    commit: <hash the test ran on>
    fingerprint: spec-v2:sha256:<hex> # of this spec at that commit
    against: {"feature/plans": "spec-v2:sha256:<hex>"}   # spec(s) it was checked against, assumption
    summary: <one to a few lines>
    log: <log-id>                     # optional; absent when logs are off or elsewhere
    override: {by: {human: admin}, date: 2026-11-10}   # only when set by override
```

- A result is current when the tested spec's `spec-v2` fingerprint and each `against` fingerprint equal those computed now; otherwise it is shown as outdated, counts as no result for approval and implementation, and is not deleted (`verification R61.1`). A removed test makes its results outdated by the content change.
- Latest result per `test` for the current content is in effect; earlier ones stay in the list. A re-run replaces an override as the effective result and the audit log keeps both (`verification §3`).
- A failed current result blocks approval and mark-implemented; it does not change `status`.
- The summary is short and holds no credentials; the CLI warns if a summary looks like one (a heuristic over tokens such as `key`, `secret`, `password`, high-entropy strings) and does not stop recording (`verification R61.3`).
- Recording uses the metadata write path and does not make a spec `awaiting-review`.

### §11.2 Test identity

A test is declared as a line `Test (deterministic): <what and how>` or `Test (intelligent): <what and how>` in a section. Its ID is `<section id>#<n>`, where `<n>` is the 1-based position of the Test line in that section (so the first test of `R11` is `R11#1`). A section with no Test line is judged by intelligence and its result uses `<section id>#0` with kind `intelligent`. Reordering tests changes IDs and outdates old results, which is a content change anyway.

### §11.3 Implementation status (architecture specs)

Implements `verification R36.2`.

```yaml
implementation:
  status: implemented
  commit: <hash it was verified on>
  fingerprint: spec-v2:sha256:<hex>
  by: {llm: claude-sonnet-5-5}
  date: 2026-11-09
```

- Absent means unimplemented. The status is implemented only while the `spec-v2` fingerprint matches the committed content and `commit` is in the current branch's history; otherwise it is reported unimplemented. When the CLI sees such a mismatch it removes the block, so an edit followed by a revert does not restore the evidence (`verification R36.2`).
- Written only when every declared check passes on `commit` (`verification R36.1`).
- Only architecture specs carry the field; elsewhere it is a format error.

### §11.4 Test logs

Implements `verification R61.4`.

- `tests.logs: local` (default): full output and intelligent-test session text goes to `<local store>/logs/<log-id>.log`, ID `<YYYYMMDDTHHMMSSZ>-<4 hex>`; the result's `log` field names it. On another machine the id is absent from the store and the record shows "log not available".
- `tests.logs: git`: the log is written to `<paths.test_logs>/<log-id>.log` (default `docs/test-logs`, `§6`), committed with the project (assumption for the directory), and is never pruned by retention; the CLI prints the warning about private information when the setting is chosen and when a log is written.
- `tests.logs: off`: no log file; only `summary` remains.
- Local logs older than `tests.logs_retention` days are deleted at the next command; the prune is audited (`§10`).

## §12 Naming and identifier rules

Implements `specifications R1`, `plans R30`.

### §12.1 Summary table

| Thing | Form | Permanent | Where checked |
|-------|------|-----------|---------------|
| Requirement ID | `R<n>(.<m>)*`; next = highest ever used plus one; retired IDs listed | yes | `§1.3` |
| Spec ID | `feature/<slug>`, `architecture/<slug>`; equals path | yes | `§1.1` |
| Requirement file ID | `requirement/<file-stem>` | yes | `§1.2` |
| Plan ID | `YYYY-MM-DD-` plus two to four words; equals folder | yes | `§5.1` |
| Plan cite | `plan/<plan-id>` | yes | `§3.1` |
| Step | `steps/NN-<slug>.md`, `NN` contiguous from 01 | number is fixed once the step has started | `§5.3` |
| Gap ID | `G<n>`, counts up per plan | yes | `§5.6` |
| Request ID | timestamp plus 4 hex | yes | `§9.2` |
| Log ID | timestamp plus 4 hex | yes | `§11.4` |
| Test ID | `<section id>#<n>` | follows the spec content | `§11.2` |
| Permission ID | dotted lower-case | yes | `§7.1` |
| Preset ID | kebab-case | yes | `§7.2` |

### §12.2 Collisions

Two specs or plans created on parallel branches with the same ID are an ordinary git conflict (same path). Two requirements with the same number on parallel branches show as duplicates after the merge and are reported by validation (and by the pre-commit check, later release, `verification R32`).

### §12.3 Shared plan files

Files directly in `<plans.dir>` (not in a plan folder or the archive) are shared files. They are cited by repository-relative path in a plan's `references` as `file:<path>` (grammar in `§3.1`, assumption); a missing file is reported.

### §12.4 Subprojects (later release)

Spec IDs are unique within a project, and a cite to another project is written `<project>:<cite>` (`later-releases R39.3`). Subproject locations come from the `subprojects` setting. Decision records (`later-releases R37`) have no format in the first release.
