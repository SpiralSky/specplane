---
id: architecture/file-formats
title: File formats
authors:
  - llm: claude-sonnet-5-5
    contribution: drafted
implements: [specifications R1, specifications R2, specifications R5, specifications R7, specifications R9, specifications R10, specifications R10.1, specifications R11, specifications R11.1, specifications R11.2, specifications R11.3, specifications R11.4, specifications R40, plans R28, plans R29, plans R29.1, plans R29.2, plans R30, plans §2, plans §2.1, plans §2.2, plans §3, configuration R25, configuration R25.1, roles-and-permissions R50, roles-and-permissions R56, roles-and-permissions R57, roles-and-permissions R44, roles-and-permissions R48, requests R52, requests R52.2, requests R52.4, verification R13, verification R13.1, verification R36.2, verification R61.1, verification R61.3, verification R61.4, cli R16, cli R17.2, plan-execution R27, plan-execution R27.2, plan-execution R27.4, roles-and-permissions R43, roles-and-permissions R44.1, roles-and-permissions R49, roles-and-permissions R60]
references: [cli R16.1, harness R20.1, architecture/reference-cli §8, architecture/reference-cli §12.4, roles-and-permissions R56.1, roles-and-permissions R56.2, verification §2.1, cli R17, plans R29.3, plan-execution R31.1, plan-execution R31.2, verification R32, verification R36.1, verification §3, roles-and-permissions R42.1, roles-and-permissions §2, configuration §2, requests §2, requests R52.1, plans §3.1, plan-execution R27.1, steering R59.1, later-releases R37, later-releases R37.1, later-releases R39.3, R11, R2, architecture/repository-layout §6, plan-execution R27.6, architecture/repository-layout, architecture/reference-cli, architecture/reference-cli §5.7, architecture/reference-cli §10.2, architecture/reference-cli §5.6, architecture/reference-cli §12.1]
---

# File formats

This spec fixes the concrete files Specplane reads and writes: specification files and their metadata, the content fingerprint that binds approval to content, the git notes store that holds approval, status and test records, plan record files, the configuration file, role and preset storage, request records, the audit log, test results and logs, and the rules for identifiers and names. Where the files live in a repository is `architecture/repository-layout`; how the CLI parses and checks them is `architecture/reference-cli`. Details the feature specs leave open are marked "assumption".

All Specplane-written text files are UTF-8, use LF line ends and end with one newline. Metadata is YAML 1.2 restricted to JSON-compatible values (no custom tags, no duplicate keys, string keys only, dates written as quoted-or-plain `YYYY-MM-DD` and read as strings).

## §1 Files and identifiers

Implements `specifications R7`, `specifications R5`, `specifications R1`, `specifications R2`.

### §1.1 Specification files

- One markdown file per spec. Feature and architecture specs: `<layer-dir>/<slug>.md`, ID `feature/<slug>` or `architecture/<slug>`. The ID is derived from the path and written in `id`; a mismatch is a format error naming both. The layer directories come from the configuration (`§6`).
- A slug is `[a-z0-9]+(-[a-z0-9]+)*`. A spec lives directly in its layer directory; nested folders are not specs (assumption).
- `INFO.md` in a folder is documentation. It has no frontmatter; if it has, validation reports it as probably a misnamed spec. A file with no valid frontmatter is reported invalid.
- A spec file is: frontmatter block (`---` fences, first line of the file), then the body in markdown.
- A spec is retired by deleting the file; there is no `deprecated` status.
- A requirement file's ID is `requirement/<file-stem>` (`§1.2`). It belongs to the requirement layer; its body may contain ordinary headings and requirement markers. It is cited whole by that ID or by requirement ID.

### §1.2 Requirement files

Implements `specifications R1`, `specifications R2`.

- Requirements are markdown files in the requirements directory (`§6`). One file or several; with several, one central file lists each other file by file name (a markdown list item `- <file-name>: <description>`), and files cite each other by file name.
- **Which file is central.** The file named by `paths.requirements_index` (`§6`); when that is unset, the only markdown file in the requirements directory, else `index.md`, else `README.md`. With none of these, or several candidates and no setting, validation reports an error naming the candidates, and until it is fixed every `.md` file in the directory is read in name order (assumption: the page, `R2`, says only that one central file exists).
- A requirement starts at a marker line, alone on its line: `**R<n>: <Title>**` for a top-level requirement, `*R<n>.<m>: <Title>*` (and deeper, `R<n>.<m>.<k>`) for sub-requirements. The requirement's text runs to the next marker of equal or shallower depth, or to the next heading, whichever comes first, so a requirement's content for citing purposes includes its sub-requirements and nothing after them (`§3.4`).
- A line `Retired IDs: ` followed by comma-separated backticked IDs lists retired requirement IDs. The first such line found in the central file is authoritative; other files may not carry one.
- A requirement file always has status Approved (`specifications R11`, decided with the user 2026-11-11): it never needs approval, and no record is ever written for it (`§13`). Frontmatter is optional. It may carry the author-written keys of `§2` (`id: requirement/<file-stem>`, `title`, `authors`, and so on), all optional; `status`, `approval` and the other legacy record keys are ignored with a warning (`§2`). A change to a cited requirement part still makes the citing spec `awaiting-review` with reason `outdated` (`§4.5` step 3), but a requirement file never causes `unapproved-dependency`. The product requirements page is owned by the user; Specplane never edits it unless asked.

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
authors:                      # required, may be empty
  - human: <name>
  - llm: <model id>
    contribution: drafted     # optional (R10.1)
covers: [R1, R2]              # feature specs, optional (empty is valid)
implements: [plans R28]       # architecture specs, optional
references: [R7, plans R28]   # every other cite used in the body
---
```

A spec file holds only metadata a person or LLM writes. Status, approval, review reason, test results and implementation status are Specplane-computed or Specplane-recorded state; they are never in the file and live in the notes store (`§13`; `specifications R11`, `specifications R40`). The keys `status`, `approval`, `review-reason`, `results` and `implementation` are removed from the format. If a file still has one (a legacy file before migration, `architecture/reference-cli §5.7`), validation warns, the key is ignored, and it stays outside the fingerprint (`§4.2`). Other unknown keys are handled as in `§2.1`.

### §2.1 Fields

| Field | Type | Rule |
|-------|------|------|
| `id` | string | `<layer>/<slug>` for `feature` and `architecture`; equals the file path |
| `title` | string | Any non-empty text |
| `authors` | list | Items are `{human: <name>}` or `{llm: <model id>}`, each with an optional `contribution` string. Only recorded facts; an unknown identity is `unknown`, never guessed. Earlier entries stay; approval does not add an author. Recording LLM authors follows `authorship.record_llm` (`§6`) |
| `covers` | list of cites | Feature specs: requirement IDs the spec has a heading for (parent and sub-requirements). Each item is a cite (`§3`) that must resolve to a requirement |
| `implements` | list of cites | Architecture specs: feature spec sections (`<slug> R<n>`, `<slug> §<n>`) the spec builds. Resolve to a section |
| `references` | list of cites | Every cite used in the body, deduplicated, plus cites that are neither `covers` nor `implements`. A body cite missing from `references`, `covers` and `implements` is a format error; a listed item the body never uses is a warning |

Unknown top-level fields are reported as warnings and are included in the content fingerprint (conservative, `§4.2`), except the five legacy record keys named in `§2`. A spec may not set `covers` and `implements` for the wrong layer: `covers` on an architecture spec or `implements` on a feature spec is a format error.

`covers` and `implements`, together with `references`, are the spec's dependencies (`specifications R9`): the set used for outdated checks (`§4.5`), coverage and approval order.

### §2.2 Status is computed

A spec has no stored status. The effective status the CLI reports is computed from the committed content and the records in the notes store (`§4.5`, `§13`): `approved` when an applicable approval record holds, otherwise `awaiting-review` with its reason (`specifications R11.4`). Requirement files are always approved (`§1.2`).

### §2.3 Approval records

Implements `specifications R11`, `specifications R11.1`, `cli R16`.

An approval is a record of kind `approval` in the notes store (`§13`), not a block in the spec file.

- `by` uses the author item form. A human approver is recorded as the identity of the person running the command; an LLM approver as `llm: <model id>` with `delegated-by: <human>` naming the human whose instruction allowed it. The CLI takes the person's name from git `user.name` and cannot be told another (`cli R16`).
- `date`: the day the approval was recorded.
- The record is attached to HEAD at the time it is written, the commit the status was set on (`specifications R11`, `§13.1`). Approving writes no commit on the branch.
- `fingerprint`, `cited`: see `§4.4`. The record applies to any commit whose committed spec content has this fingerprint, so approval survives rebase and squash merge (`specifications R11`).
- `note`: optional free text.
- A group of specs that cite each other is approved by one command and each member gets its own record with the same `by` and `date`, and all the members' records are written in one notes commit (`cli R16`).
- **Hand approvals before migration.** An approval written by hand in frontmatter has no `fingerprint` or `cited`; migration (`architecture/reference-cli §5.7`) converts every existing frontmatter approval of a spec or plan into a record attached to its recorded `approval.commit`, filling `fingerprint` from the content at that commit and `cited` from the cited parts at that commit, and falls back to HEAD with the recorded fingerprint when that commit is missing. Requirement files are skipped with a warning. After migration the hand format no longer exists.

### §2.4 Overrides

Implements `cli R17.2`.

A value set by an override permission (status, approver, test result) is a record with `kind: override` that carries `target: status | approver | approval-commit` and a `value`, or a `test-result` record carrying `override: {by: <author item>, date: <date>}` (`§11.1`). Overriding `status` sets `value: approved` or `value: awaiting-review`; overriding `approver` sets an author item; overriding `approval-commit` sets the commit shown as the one approved (`cli R17`). The record's own `by` and `at` are the override mark, and it stays until a normal action supersedes it. An override to approved is written with a real `fingerprint` and `cited`, computed from the committed content at the moment of the override, so it is checked like any other approval: a later content or cited-part change returns the spec to `awaiting-review` (`cli R17.2`). An `approver` or `approval-commit` override changes only what is shown and does not change the decisive record's effect.

### §2.5 Review reason

Implements `specifications R11.3`, `specifications R11.4`.

The review reason is computed, never stored. It is a string, or a list of strings when several apply, from this grammar:

- `never-approved`: no applicable approval record exists (the default for a new spec);
- `edited`: the committed content has no applicable approval record although an earlier approval of the spec exists, or a `reopen` record is the newest applicable one;
- `outdated: <cite>`: a cited part changed or was deleted since approval; one item per cited part, for example `outdated: plans R28`;
- `unapproved-dependency: <cite>`: the cite resolves to a non-requirement spec whose decisive record (`§13.2`) is not an `approval` or an `override` to approved, or that has none (never approved, reopened, or overridden to awaiting-review); one item per such cite (`specifications R11`, `§4.5` step 5).

When a person edits a spec by hand nothing else needs recording: the new content has a new fingerprint, so the spec is `awaiting-review` with reason `edited` (git keeps the old record). A person reopening a spec without editing it appends a `reopen` record (`§13.2`).

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

A name without a layer is a feature spec. `req-file` is the only place the layer `requirement` is used. `plan-ref` and `file-ref` take no project prefix; `file` is reserved so that a cite such as `file` followed by a colon and a path never parses as project `file` (assumption: this extends the `root` restriction of `later-releases R39.3`). The project prefix is an assumption of the feature specs (`specifications R7`); no prefix means the citing spec's own project, `root` names the root project (`later-releases R39.3`).

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

Approval is bound to a spec's committed content, not to a commit hash, so it survives rebase and squash. Records are found by this fingerprint (`§13.2`). Two fingerprints are used: one for the whole spec (`spec-v3`), one for a cited part (`sec-v1`).

### §4.2 Spec fingerprint `spec-v3`

Adapted from the earlier `spec-v1` and `spec-v2` (version bumped because the exclusion list changed; `spec-v2` also counted `title`, `covers`, `implements` and `references`).

Serialize a JSON object with exactly `frontmatter` and `body`, encode as UTF-8, SHA-256 it, and write `spec-v3:sha256:<lowercase hex>`.

- `frontmatter` is the parsed frontmatter with these keys removed: `status`, `approval`, `authors`, `review-reason`, `results`, `implementation`, `title`, `covers`, `implements`, `references`. The first, second, fourth, fifth and sixth are the legacy record keys (`§2`): they are no longer part of the format, and stay excluded so a legacy file hashes the same before and after migration. Everything else stays, including `id` and unknown keys. Mapping keys are sorted by Unicode code point, array order is kept, output is compact JSON with literal Unicode and standard escapes, numbers in ECMAScript form.
- `body` is everything after the closing `---` line and its newline, with CRLF and CR turned into LF. Nothing else is normalized: comments, whitespace and trailing newlines count, so a cosmetic edit is a content edit.
- Rule of the feature specs: content means the whole file except `status`, `approval` and `authors` (`specifications R11.3`). `review-reason`, `results` and `implementation` were metadata Specplane wrote, so they are excluded as well (assumption).
- A change to any excluded field alone is not an edit.
- Decision: `title`, `covers`, `implements` and `references` are metadata and so outside the fingerprint. The page lets a person correct them by hand and says that a change to metadata alone does not make a spec Awaiting Review (`cli R17`, `specifications R9`, `specifications R11.3`). A dependency changed this way is still tracked by `§4.5` step 3: a cite recorded in `cited` is compared, and a cite added later has nothing recorded to compare with, so it is not outdated until the next approval records it. Reordering a list is not an edit. A plan's fingerprint is the variant `plan-v1` of `§5.2`, which keeps these keys and also covers the step files.
- Changing these rules needs a new version tag; an old digest is never reinterpreted.

### §4.3 Part fingerprint `sec-v1`

The part text (`§3.4` step 5), CRLF to LF, with trailing blank lines removed, then `sec-v1:sha256:<hex>` of its UTF-8 bytes. A whole-spec cite uses the `spec-v3` fingerprint of the cited file. A part that no longer resolves has no fingerprint, which counts as changed (`specifications R11.2`: deletion is a change).

### §4.4 What approval stores

An `approval` record (`§13.2`) carries:

- `fingerprint`: the `spec-v3` fingerprint of the spec's committed content;
- `cited`: a map from each dependency cite (`covers`, `implements`, `references`, as written) to the part fingerprint of the cited part as committed at approval time. A cited requirement part is recorded like any other, so a later change to it outdates the spec (`specifications R11.2`).

These fields let validity be decided from the record alone, without any commit being reachable.

### §4.5 Computing the effective status

From the committed state of the current branch (`specifications R40`); uncommitted edits are ignored and reported as a note.

1. If the spec is a requirement file, it is approved; stop (`§1.2`).
2. Compute `spec-v3` of the spec as committed at HEAD. Read the notes store (`§13`) and select the records of the spec that apply (`§13.2`): the fingerprint equals it and the revert rule holds. If none applies: `awaiting-review`, reason `never-approved`, or `edited` when a record of the spec exists but none applies (another fingerprint, or the revert rule fails).
3. The newest applicable `approval`, `override` or `reopen` record decides (`§13.2`). A `reopen`, or an `override` with `target: status` and `value: awaiting-review`, gives `awaiting-review`, reason `edited` (reopened). An `approval`, or an `override` to approved, gives approved, subject to steps 4 and 5.
4. For each cite in the decisive record's `cited` map: compute the part fingerprint now; if it differs or the part is gone, add `outdated: <cite>`. Only cited parts count, never a change elsewhere in the cited spec, and requirement parts count like any other. A cite in `covers`, `implements` or `references` that was added after approval (absent from `cited`) is not compared: adding a dependency is a metadata change (`§4.2`).
5. For each dependency that resolves to a spec other than a requirement file, whose decisive record by steps 2 and 3 is not an `approval` or an `override` to approved (or that has none), add `unapproved-dependency: <cite>` (`specifications R11`: a spec citing a never-approved spec is Awaiting Review). The cited spec's newest `approval`, `reopen` or `override` to status record is read regardless of its fingerprint, and only its kind counts, never the cited spec's own outdated reasons: a mere edit of the cited spec does not flag its citers (`specifications R11.2`), so only a never-approved, reopened or overridden-to-awaiting-review cited spec does. Requirement files are always approved, so they never add this reason. Members of a group approved in one command all have records, so a group is not affected.
6. If no reason was found, the spec is `approved`; otherwise `awaiting-review` with all reasons.

Approval order is also enforced when approving (`cli R16`), so a spec cannot normally be approved before what it cites; step 5 covers specs approved by override, and specs whose cited spec was reopened later. Plans use the same steps with the fingerprint of `§5.2`.

An approval therefore never extends over later edits: only a fresh approval writes a record with a new `fingerprint`.

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
authors: [...]                   # as §2
implements:                      # specs this plan implements or writes, with the commit read
  - {spec: "feature/export", commit: <hash>, mode: writes|implements}
references: [plan/<other-id>, plans R28]
---
```

- A plan has no stored status or approval; its approval records live in the notes store like a spec's (`§13`) and are computed by `§4`. The plan's content fingerprint is `plan-v1:sha256:<hex>` (assumption), computed like `spec-v3` (`§4.2`) over the PLAN.md frontmatter minus the legacy record keys, `authors` and the `commit` of every `implements` entry, plus the PLAN.md body, plus every step file (`§5.3`) in step-number order, each with its path relative to the plan folder and its full content. The JSON object has `frontmatter`, `body` and `steps` (a list of `{path, content}`). `progress.yaml`, HANDOFF.md and `spec-gaps.md` are not part of the plan's content, so execution does not outdate approval. Decision: a step file edit is a plan edit and returns the plan to `awaiting-review`, so an approved plan cannot be changed through its steps without review; plan records follow the same revert rule as specs (`§13.2`); because `plan-v1` now includes the step files, plan approvals recorded before this change (frontmatter approvals migrated or not) have a different fingerprint and do not carry over, so such plans are re-approved; the step edit rules of `plan-execution R31.1` apply to plans that are not yet approved or are re-approved afterwards.
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

- Body sections: `## Goal`, `## Acceptance criteria`, `## Tasks` (ordered list; an item starting with `[parallel]` is independent of its `[parallel]` neighbours, `plan-execution R31.2`), `## Context` prose if needed, optional `## Guidance`.
- A step has no status in its file and its content is part of the plan fingerprint (`§5.2`). The step is done when `progress.yaml` lists it (`§5.4`). There is no skipped or blocked state (`plans §3.1`).
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
  parallelism: 1                     # greatest number of tasks of a step run at once
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
  duplicate_requirement_ids: off
  tests: off
coverage:
  requirement_only: []               # requirement ids
decisions: {enabled: off}            # later release
subprojects: []                      # items {name, path}; a subproject folder holds requirements/, features/, architecture/ (§12.4)
strict_mode: {enabled: off}          # measure: on|off; on unless stated while enabled (roles-and-permissions R55.1)
bypass_guards: {}                    # measure: on|off; each measure is on unless stated (roles-and-permissions R58)
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
- Configuration is read from the committed `.specplane/config.yaml` at HEAD of the checked-out branch, never from the working tree; an uncommitted change is ignored and validation and status show a warning that the file differs from HEAD. This covers every key, including `permissions.preset`.
- Terms retired with the old model are not read and are reported as unknown: `authorship` (as a policy), `llm_role`, `forbid_architecture`, `leak_guard_allow`, `spec_roots`, `decisions.dir`. Assumption: `authorship.record_llm` is the only `authorship` key.

## §7 Permissions, roles and presets storage

Implements `roles-and-permissions R50`, `roles-and-permissions R56`, `roles-and-permissions R57`, `roles-and-permissions R44`, `roles-and-permissions R48`, `configuration R25.1`.

### §7.1 Permission identifiers

Each standard permission has a stable lower-case dotted ID used in presets, steering, requests and the audit log. Assumption: the IDs below. A permission added by a new command brings its own ID and a default in every default preset.

| ID | Permission |
|----|------------|
| `spec.create.<type>`, `spec.edit.<type>`, `spec.delete.<type>` | `<type>` is `requirement`, `feature` or `architecture` |
| `spec.approve.<type>` | Approve specifications of that type: `<type>` is `requirement`, `feature` or `architecture` (`cli R16.1`, `harness R20.1`). Decision records and plans are approved under `spec.approve.feature` |
| `meta.read`, `meta.write` | Read, write specification metadata |
| `meta.write.title`, `.authors`, `.references`, `.covers`, `.approval` | Granular metadata writes (`.approval` covers date and commit) |
| `override.status`, `override.approver`, `override.approval-commit`, `override.test` | Protected overrides |
| `test.record` | Record a test result |
| `info.retrieve` | Information retrieval (viewing, review, validation, listing, coverage, test runs, audit reading) |
| `plan.meta.read`, `plan.meta.write`, `plan.meta.write.<piece>` | Plan metadata; pieces are `title`, `.authors`, `.references`, `.implements` |
| `plan.edit`, `plan.create`, `plan.delete`, `plan.start`, `plan.abandon`, `plan.complete` | Plan actions |
| `plan.budget`, `plan.resume`, `plan.softstop` | Budget, resume, soft stop |
| `decision.add`, `decision.retrieve`, `decision.edit`, `decision.delete` | Later release |
| `config.change` | Change configuration, including `permissions.preset` |
| `preset.create` | Create a custom preset as the LLM role: allow, request user or deny (`roles-and-permissions R56.2`); a person creates presets under `config.change` and `role.manage` |

The single permission `spec.approve` that earlier releases had no longer exists (`cli R16.1`). A preset or role file that still names it is not malformed: the key is ignored, so the default mode of that role applies and authority never grows, and `validate` warns "unknown permission `spec.approve`; use spec.approve.requirement, spec.approve.feature or spec.approve.architecture".

There is no permission to run a plan step: a step needs only the permissions of the actions it performs, and the page names no separate one (`plan-execution R27.1`, `plan-execution R31.1`), so `plan step-done` has none and the code carries no `plan.step`. `plan.complete` also guards `plan merge` (assumption: the page has no separate merge permission). Sending a request and accepting one have no permission of their own (`roles-and-permissions R50`). Management and system permissions (`mgmt.*`, `system.*`) are later-release and not part of a preset.

### §7.2 Default presets

The four default presets are built into Specplane (shipped as data it reads; assumption: embedded in the package, not in the repository), cannot be edited or deleted, and are selected by ID through `permissions.preset`.

| Preset ID | Number |
|-----------|--------|
| `architecture-level-llm-control` | 1, default |
| `full-manual-editing` | 2 |
| `feature-level-llm-control` | 3 |
| `full-llm-control` | 4 |

A preset file (embedded; custom presets use the same shape, `§7.4`) is:

```yaml
id: architecture-level-llm-control
title: Architecture-Level LLM Control
default_mode: deny                    # R56.1
roles:
  standard-user: {default_mode: allow, modes: {override.status: deny, override.approver: deny, override.approval-commit: deny, override.test: deny}}
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
      spec.approve.requirement: request-user
      spec.approve.feature: request-user
      spec.approve.architecture: request-user
      config.change: request-user
      preset.create: request-user
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

`permissions.preset` in `.specplane/config.yaml` (`§6`) names the active preset, read from the committed file at HEAD (`§6.2`): an uncommitted change of the preset is ignored with a validate and status warning. A preset ID is a default preset or a custom one (`§7.4`). An unknown preset ID is a malformed-setting finding and the default preset is used.

### §7.4 Custom presets

**Custom presets** (`roles-and-permissions R56`, `roles-and-permissions R56.1`) are stored in git, one file per preset, at `.specplane/roles/presets/<id>.yaml`, in the shape of `§7.2` (`id`, `title`, required `default_mode`, `roles` with `standard-user` and `llm`, each with optional `default_mode` and `modes`). Assumption: the folder is `presets/` under `roles/`, so it does not collide with the role files below. Rules:

- The file name without `.yaml` equals `id`, which is kebab-case and is not the ID of a default preset. A role key other than `standard-user` and `llm` (the Administrator is never in a preset), a permission that is not in the catalog (`§7.1`) or is a management or system permission (`role.manage`, `role.map`), a mode that is not `allow`, `request-user` or `deny`, or a missing `default_mode` makes the file malformed: validation reports an error naming the file, and the file is ignored.
- Like configuration (`§6.2`), custom presets are read from HEAD of the checked-out branch, never from the working tree; `preset` commands edit the working tree and print that the change is not committed, followed by a `Commit it to apply:` line and a ready-to-run `git add -- :/<file> && git commit -m "..." -- :/<file>` line (the `:/` pathspecs make it work from any subdirectory and commit only the written file), and put the written paths in `data.uncommitted`. The commands that create, edit or delete a preset read the working tree, so a preset created and not yet committed can be edited and activated by `config set`.
- Custom presets take effect on commit; the role and rule approval lifecycle in §7.5 does not apply to presets.
- A custom preset is resolved like a default one: role entry, else role `default_mode`, else preset `default_mode`, else `deny`. It takes part in the steering stamp through its content (`architecture/reference-cli §12.4`).

### §7.5 Custom roles, LLM role rules and mappings

Implements `roles-and-permissions R43`, `roles-and-permissions R44`, `roles-and-permissions R44.1`, `roles-and-permissions R48`, `roles-and-permissions R49`, `roles-and-permissions R60`.

**Custom role** `.specplane/roles/roles/<id>.yaml`, one file per role:

```yaml
id: triage                  # kebab-case, equals the file name, not administrator, standard-user or llm
title: Triage lead          # optional
management_level: 7         # whole number 1..99 (R49); the Administrator is above all
default_mode: deny          # required: allow, request-user or deny
modes:                      # permission -> mode; any catalog permission
  spec.edit.feature: request-user
  role.manage: allow
```

Resolution for a custom role: `modes` entry, else `default_mode`, except that the protected overrides (`§7.1`) and the management and system permissions `role.manage` and `role.map` come only from a `modes` entry (else `deny`). The default roles are fixed for `role.manage` (Standard User allow, LLM deny) and `role.map` (Standard User and LLM deny); the Administrator has all.

**LLM role rule** `.specplane/roles/rules/<id>.yaml`:

```yaml
id: review
title: Code reviewers       # optional
role: reviewer              # a default role other than administrator, or a custom role
priority: 5                 # whole number, default 0
match:                      # at least one factor; all must match
  subagent: code-reviewer
  provider: anthropic       # also agent_type, model (a trailing * is a prefix), delegated (true/false)
```

Rules for both:

- Read from HEAD of the checked-out branch, like configuration (`§6.2`); the commands edit the working tree and say the change is not committed. A malformed file (bad ID, level out of range, unknown permission or mode, unknown factor, a rule for the Administrator) is a validation error and is ignored.
- **Approval.** A notes record (`§13`) with kind `approval`, subject `role/<id>` or `role-rule/<id>`, fingerprint `role-v1:sha256:<hex>` (SHA-256 of canonical JSON of the parsed file: keys sorted, comments and spacing ignored), `by` `{human, role}` and `content` holding the approved role or rule text. Use the latest approval by `at`, then `rid`. If it applies to the committed file (`§13.2`), the state is `approved`; otherwise its content remains effective as `pending-change` or `pending-deletion` when the file is absent. Legacy records without `content` recover the file at the record's attached commit; recovered content must match the recorded fingerprint. With no effective approval, a committed definition is `pending` and does not apply. Validation warns for pending roles and rules. Malformed replacements remain errors and do not discard the last approved definition.
- **Trust.** `trusted-rules.json` in the local store: `{"<rule id>": "<fingerprint>@<level>"}`. A rule whose role is above the default LLM role (level over 5, or a management or system permission other than deny) applies only when its entry equals the effective approved rule fingerprint and the role's level.
- **Matching.** `resolveLlmRole` filters the rules that are approved, whose role applies, trusted where needed, and whose factors all match; the highest `priority`, then the smallest ID, wins; none gives `llm`. The factors come from the adapter's environment (`architecture/reference-cli §12.1`).
- **Deletion approval.** After the file is removed and committed, the same approve command writes an `approval` record with `deleted: true`, no `content`, and the `role-v1` fingerprint of canonical JSON `null`. A deletion approval is considered only on branches containing its attached commit; an absent file with no history on the branch is not a pending deletion. A latest deletion approval retires earlier approvals; the definition no longer applies, and a recreated file needs fresh approval. Pending deletions retain the approved definition and local trust (`roles-and-permissions R48`).

**Mapping** `os-users.json` in the local store: `{"os:<user name>": {"role": "<role id>", "admin_switch": true}}`; `admin_switch` is optional. The key form `<source>:<name>` leaves room for other identity sources. Never committed, per machine. `cliRole` reads it: no entries, the first-release behaviour; with entries, the mapped role if it applies (default role, or an approved custom role), else `standard-user`, and `administrator` after a switch only when `admin_switch` is true (or the mapped role is `administrator`). `role.json` records the user who switched, and a switch by another OS user is ignored.

Which role runs a command is resolved at run time from the environment and these files; it is never written into a spec or plan.

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
- Workflows: `step` (`<type>(<slug>): <summary>`, on `plan/<id>`), `plan-create` (`docs(<slug>): create plan`), `spec` (`docs(specs): <summary>`), `request` (`chore(<config|preset>): <verb> <subject> (request <id>)`, the commit of `requests accept --commit`), `start` (`chore(specplane): start <id>`), `finish` (`chore(specplane): finish <id>`), `abandon` (`chore(specplane): abandon <id>`), `archive`, `plan-edit` (`docs(<slug>): edit plan`), `plan-meta` (`docs(<slug>): set <piece>`), `stop`, `resume`, `budget` and `retarget` (`chore(specplane): <verb> <id>`). Approval, reopen, override, recorded test result and implementation status are records in the notes store (`§13`) and create no branch commit, so they have no workflow; the notes commit message is `specplane: <verb> <id>` (assumption). A metadata set of an author-written field is a metadata-only branch commit with workflow `spec` (`docs(specs): <summary>`).
- Specplane never sets author or committer; they come from git config.
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
  trusted-rules.json        local trust of LLM role rules (§7.5)
  os-users.json             local mapping of OS users to roles (§7.5)
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
  "checkout": "<plan checkout path or null>",
  "blocking": false,
  "answer": null
}
```

- `state` is `pending`, `accepted`, `declined` or `failed`. `failed` is an assumption beyond `requests §2`, which says only that an action that cannot be done is reported and does nothing: the request is then marked `failed` (accepted, but the plan is gone or the patch no longer applies), counts as answered and is not retried, so the list shows why nothing happened. `answer` is `{by, date, note}` once answered; `failed` adds `error`.
- `plan` and `checkout` are set when the request was sent from a plan session; accepting runs the action in that plan's worktree, found from the plan record, and is refused naming the worktree if it no longer exists (`architecture/reference-cli §8`).
- Legacy records without `checkout` remain readable. A legacy plan request whose base branch is `plan/<id>` uses that branch’s live registered worktree; ambiguous legacy plan context is refused pending decline and resend. Old plan-command records whose base is outside the plan branch used `plan` as an action target, so retain their original checkout behavior. New plan-command action targets do not imply execution context.
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
- `role.json`: `{"role": "administrator", "user": "alice"}`, present only while the Administrator switch is on (`roles-and-permissions R44`); the switch counts only for the OS user named in `user` (a file without `user` counts for everyone, as in earlier versions).
- `os-users.json` and `trusted-rules.json`: `§7.5`.
- `tmp/`: temporary checkouts, removed when the command ends.

Writes use the temp-file-and-rename rule of `§9.2`. A missing file is the empty or default state.

## §10 Audit log

Implements `verification R13`, `verification R13.1`.

`audit.jsonl` in the local store (`§9.1`): one JSON object per line, appended, never committed and shared by worktrees.

```json
{"ts":"2026-11-09T10:15:00Z","branch":"plan/x","actor":{"role":"standard-user","kind":"human","name":"spiralsky"},
 "model":null,"command":"spec approve","args":["feature/plans"],"permission":"spec.approve.feature",
 "outcome":"done","reason":null,"old":null,"new":null,"request":null}
```

- `actor.kind` is `human` or `llm`; `model` is set when the harness reports it. `outcome` is `done`, `refused`, `request-sent`, `cancelled` or `failed`; `reason` explains a refusal (permission or failed test). Changes carry `old` and `new` values (configuration, metadata, status, approver, test result overrides). A bad write of the line itself does not stop the action: Specplane warns once per command (`verification R13`).
- The command runner writes an entry for every command it runs, reads included (`verification R13`: all actions). File contents and test output are never stored; test output is in the logs (`§11.4`).
- Retention (`audit.retention`): on each command entries older than the retention are dropped by rewriting the file through a temp file and rename, and one entry `{"command":"audit prune","new":{"removed":N,"oldest":"<date>"}}` is appended. `forever` prunes nothing.
- A person reads it through the CLI; an LLM only if its role holds `info.retrieve`.
- A line that cannot be parsed is skipped and reported by validation as a warning.

## §11 Test results, implementation status and logs

Implements `verification R61.1`, `verification R61.3`, `verification R61.4`, `verification R36.2`.

### §11.1 Results records

Results are records of kind `test-result` in the notes store (`§13`), attached to the commit the test ran on (`verification R61.1`). They are not in the spec file.

```json
{"rid":"<32 hex>","at":"2026-11-09T10:15:00Z","spec":"feature/specifications","kind":"test-result","test":"R11#T1","test-kind":"deterministic","outcome":"passed","by":{"human":"spiralsky"},"date":"2026-11-09","fingerprint":"spec-v3:sha256:<hex>","against":{"feature/plans":"spec-v3:sha256:<hex>"},"summary":"<one to a few lines>","log":"<log-id>","override":{"by":{"human":"admin"},"date":"2026-11-10"}}
```

`against` (the specs it was checked against, assumption), `log` (absent when logs are off or elsewhere) and `override` (only when set by override) are optional; `outcome` is `passed` or `failed`; `by` may be `{"llm":"claude-sonnet-5-5"}`. The record is shown here on one line, as stored (`§13.1`).

`test-kind` is the test's kind; `kind` is the record kind (`§13.2`).

- A result is current when the tested spec's `spec-v3` fingerprint and each `against` fingerprint equal those computed now; otherwise it is shown as outdated, counts as no result for approval and implementation, and is not deleted (`verification R61.1`). Records are found by fingerprint (`§13.2`). A removed test makes its results outdated by the content change.
- Latest result per `test` for the current content is in effect; earlier records stay in the store. A re-run replaces an override as the effective result and the audit log keeps both (`verification §3`).
- A failed current result blocks approval and mark-implemented; it does not change `status`.
- The summary is short and holds no credentials; the CLI warns if a summary looks like one (a heuristic over tokens such as `key`, `secret`, `password`, high-entropy strings) and does not stop recording (`verification R61.3`).
- Recording appends a record (`§13.3`) and does not make a spec `awaiting-review`.

### §11.2 Test identity

A test is declared as a line `Test T<n> (deterministic): <what and how>` or `Test T<n> (intelligent): <what and how>` in a section, where `T<n>` is an explicit label (`T1`, `T2`, ...) chosen by the author. Its ID is `<section id>#T<n>` (so the test labelled `T1` in `R11` is `R11#T1`); the ID follows the label, never the position, so reordering or inserting tests does not change IDs. Two Test lines with the same label in one section are an error reported by validation (`§12.2`). Intelligent judgement of a section has the ID `<section id>#0` with kind `intelligent`; it is required only for a section whose declaration, its own Test lines or, when it has none, the spec's declaration, includes intelligent judgement (`verification R36.1`), and a spec that declares neither uses intelligent judgement. A scenario in a feature spec is checked by intelligent judgement unless it names a runnable command (`verification §2.1`).

### §11.3 Implementation status (architecture specs)

Implements `verification R36.2`.

An `implementation` record (`§13.2`), attached to HEAD when it was verified:

```json
{"rid":"<32 hex>","at":"2026-11-09T10:15:00Z","spec":"architecture/file-formats","kind":"implementation","status":"implemented","by":{"llm":"claude-sonnet-5-5"},"date":"2026-11-09","fingerprint":"spec-v3:sha256:<hex>"}
```

- No applicable record means unimplemented. The record applies by the rule of `§13.2` (fingerprint match, and the revert rule while the commit it is attached to is reachable from HEAD), so a change followed by a revert does not restore the evidence (`verification R36.2`). Records are never removed.
- Written only when every declared check passes on the commit it is attached to (`verification R36.1`).
- Only architecture specs have implementation records; one for another spec is ignored with a validation warning.

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
| Test ID | `<section id>#T<n>`, label written in the spec | yes while the label stays | `§11.2` |
| Permission ID | dotted lower-case | yes | `§7.1` |
| Preset ID | kebab-case | yes | `§7.2` |

### §12.2 Collisions

Two Test lines with the same label in one section are a validation error (`§11.2`). Two specs or plans created on parallel branches with the same ID are an ordinary git conflict (same path). Two requirements with the same number on parallel branches show as duplicates after the merge and are reported by validation (and by the pre-commit check, `verification R32`).

### §12.3 Shared plan files

Files directly in `<plans.dir>` (not in a plan folder or the archive) are shared files. They are cited by repository-relative path in a plan's `references` as `file:<path>` (grammar in `§3.1`, assumption); a missing file is reported.

### §12.4 Subprojects

Spec IDs are unique within a project, and a cite to another project is written `<project>:<cite>` (`later-releases R39.3`). Subproject locations come from the `subprojects` setting, a list of items `{name, path}` (`§6`): `name` is kebab-case, unique, not `root` or `file`, and `path` is a folder inside the repository that does not contain or sit inside another subproject's folder.

- A subproject folder has the layout `<path>/requirements/`, `<path>/features/` and `<path>/architecture/`. Plans stay in the root project's plans folder. The root project's own spec folders are not inside any subproject folder.
- A spec ID inside a subproject is path-derived and starts with the subproject name: `<name>:feature/<slug>`, `<name>:architecture/<slug>`, `<name>:requirement/<stem>`. This is the ID used in the notes store (`§13`), in `approve`, `reopen`, `override`, test and implementation records, coverage and `validate <ids>`. A root spec keeps `feature/<slug>`; `root:<id>` is accepted for it. The frontmatter `id` inside a subproject spec stays the local `<layer>/<slug>` (the path inside the subproject), so moving a folder does not rewrite the specs.
- Resolution: a cite without a project resolves in the citing spec's own project; `root:<cite>` resolves in the root project; `<name>:<cite>` in that subproject. An undeclared name is a resolution error. A cite to the root project names it (`root:<cite>`, R39.3), also in a subproject that has no requirement files; a bare cite in a subproject that resolves only in the root project is a validation error naming the qualified `root:<cite>` form.
- Validation runs the `requirements`, `spec-format` and `cites` families inside each subproject; each finding carries the project name (the `project` field of the report), and the text report appends `project <name>` to the finding and prints one count line per project. The `subprojects` family reports a declared folder that is missing and, as a warning, a subproject requirement with the title of a root requirement but a different text (R39.4: the root requirement wins).
- Approval status, the notes store, test and implementation records and coverage cover subproject specs by their qualified ID. A cite recorded in `cited` or listed in `references`, `covers` or `implements` is resolved in the project of the spec that holds it, so a spec in a subproject depends on a spec in another project through the cite `<name>:<cite>` and is held back (`unapproved-dependency`) until that spec is approved, as in one project. Approval groups (`§4.5`) follow cites across projects. A requirement or feature of a subproject is covered, and named in coverage, as `<name>:R<n>` or `<name>:feature/<slug>`; a cite covers the item in the project it points into, so a subproject feature spec can cover a root requirement. Validation scoped to spec IDs (`validate <ids>`) includes subproject specs: the format, cite, tests and status checks run for the named ones. The key that compares cites inside a subproject keeps `root:X` and `X` apart, since they name different projects there; in the root project they are the same. The harness spec-write path (`spec.create`, `spec.edit`, `spec.delete`) accepts the qualified ID: the file goes into the subproject's `requirements/`, `features/` or `architecture/` folder, the frontmatter `id` stays the local `<layer>/<slug>`, the permission is the one of the layer, and an undeclared project name is refused. A bare slug (given without a layer) that names a spec in the root and in a subproject, or in two subprojects, is refused as ambiguous and the error lists the qualified IDs.

## §13 Notes store and records

Implements `specifications R11`, `specifications R11.1`, `specifications R11.4`, `specifications R40`, `verification R61.1`, `verification R36.2`, `cli R16`, `cli R17.2`.

Approval, review and implementation state, and test results, are records kept in git notes beside the commits, not in spec files (decided with the user 2026-11-11). Users accept that notes need explicit syncing and that some hosts drop them (`§13.4`).

### §13.1 Store

- The ref is `refs/notes/specplane`. A record is attached to HEAD at the time it is written, by a git note on that commit: the commit the status was set on (`specifications R11`). Test results are attached to the commit the test ran on, which is HEAD (`architecture/reference-cli §10.2`).
- A note is JSON Lines: one record per line, each a compact JSON object (UTF-8, LF, one trailing newline). Several records written on one commit share the note. Writers append lines and never rewrite or delete earlier ones.
- Every record has a unique `rid` (random 128-bit value, 32 lowercase hex digits) and `at` (RFC 3339 UTC timestamp). Because lines are unique and self-describing, merging with `cat_sort_uniq` loses nothing (`§13.4`).
- Requirement files have no records (`§1.2`).

### §13.2 Record format and lookup

Every record has:

| Field | Meaning |
|-------|---------|
| `rid` | Unique record ID |
| `at` | RFC 3339 UTC timestamp of the write |
| `spec` | The spec ID, or `plan/<id>` |
| `kind` | `approval`, `reopen`, `override`, `test-result` or `implementation` |
| `by` | Author item (`§2.1`), with `delegated-by` for a delegated LLM (`§2.3`) |
| `date` | The day the record was made |
| `fingerprint` | `spec-v3` of the spec content (or `plan-v1` of the plan, `decision-v1` of a decision record, `role-v1` of a role or rule file, `§7.5`) the record applies to |

Kind-specific fields:

- `approval`: `cited` (`§4.4`), optional `note`.
- `reopen`: optional `note`.
- `override`: `target` and `value` (`§2.4`), `cited` and optional `note` when the value is `approved`.
- `test-result`: the fields of `§11.1`.
- `implementation`: `status: implemented` (`§11.3`).

**Lookup is by content.** The effective state at HEAD is computed from the committed fingerprint and the whole notes ref, not only notes on commits reachable from HEAD. A record applies when:

1. its `spec` equals the spec and its `fingerprint` equals the spec's current committed fingerprint, and
2. when the commit it is attached to is reachable from HEAD, no commit after it up to HEAD changed the spec's (or plan's) fingerprint. When the commit is not reachable (after a rebase or squash merge), the fingerprint match alone decides.

Rule 2 keeps "changed and changed back" from restoring old evidence (`verification R36.2`). It applies the same way to approvals, reopens, overrides and implementation records.

Among applicable `approval`, `override` and `reopen` records the newest decides, ordered by `at`, then by `rid`; order within a note never counts. `approval` and an `override` to approved give approved (subject to `§4.5` steps 4 and 5); `reopen` and an `override` to awaiting-review give awaiting-review.

Decision: because lookup is by content, a record written on one branch applies on every other branch whose committed content is identical, once the notes are present there. Together with rule 2 this is limited to identical content and is an intended consequence of binding status to content (`specifications R11`, `specifications R40`).

### §13.3 Writing

Approve, reopen, override, test-result and implementation commands append lines to the note on HEAD and commit that note on `refs/notes/specplane`. A group approval writes every member's record in one notes commit. They never create a commit on the branch and never change the spec file, so they do not make a spec outdated by themselves (`specifications R11.3`). The audit log entry (`§10`) is unchanged. A write that finds the ref changed by another writer re-reads and appends again (assumption: git's own ref update gives the lock).

### §13.4 Sync and merge

- `specplane init` sets the remote's notes fetch refspec to `+refs/notes/specplane:refs/notes/remotes/<remote>/specplane`, so a fetch brings the remote's notes into a remote-tracking ref and never overwrites the local `refs/notes/specplane`.
- `specplane sync` (`architecture/reference-cli §5.6`) does fetch, then merge, then push, in that order. The merge is `git notes --ref=specplane merge -s cat_sort_uniq refs/notes/remotes/<remote>/specplane`, which is safe because each line is a unique record with a `rid` (`§13.1`). The push is `git push <remote> refs/notes/specplane`.
- Validation warns when the notes fetch refspec is missing for a remote, or when a remote has a notes ref that has no local remote-tracking copy or whose records are not all merged into the local ref, or when the remote has none while local records exist.
- A host that drops notes loses records; the spec then reads `awaiting-review` with reason `never-approved` until approval is recorded again.

### §13.5 Migration

A one-time command (`architecture/reference-cli §5.7`) converts every legacy frontmatter `approval` block, `results` list and `implementation` block (accepted shapes: a map whose `status` is `implemented` or `complete`, or with no `status`; any other `status` is skipped with a warning) of a spec or plan into records attached to the recorded `commit` (HEAD when it is missing, using the recorded fingerprint), then deletes the five legacy keys from those files in one commit. Requirement files are skipped and the command warns that their legacy keys should be removed by hand.

## §14 Decision records

Implements `later-releases R37`, `later-releases R37.1`. Records are on only while `decisions.enabled` is on.

### §14.1 File

A record is the file `.specplane/decisions/D<n>.md`, where `<n>` is a positive integer without leading zeros; the ID `D<n>` is also the frontmatter `id`. The next ID is the highest existing number plus one, and a deleted number is not reused while a higher one exists (assumption: the folder is the only registry). The folder is outside the configured spec folders, so the old architecture decision records in `docs/decisions` are not read as records; they stay what they are (assumption: no automatic import, `later-releases R37`).

Frontmatter (JSON-compatible YAML like a spec's): `id`, `title` (non-empty), `date` (`YYYY-MM-DD`, the day the user decided; default today), optional `concerns` (a list of specification IDs, plan IDs or cites, each shown as written), `authors` (like a spec's, `{human: name}` or `{llm: model, contribution}`; written by the harness, the model only when `authorship.record_llm` is on). The legacy record keys (`status`, `approval`, `review-reason`, `results`, `implementation`) are not accepted.

The body has exactly the sections `## Decision` (what was decided, required), `## Context` (the context and reasons the user gave, required) and optionally `## Reasons`, in any order, with no text before the first. Editing by field rewrites these three sections; a record with other sections is edited by hand, and the field edit refuses it.

### §14.2 Approval

A record's approval is a notes-store record (`§13`) with subject `decision/D<n>` and the fingerprint `decision-v1:sha256:<hex>`: SHA-256 of the canonical JSON (`§4.2` rules) of `{frontmatter without authors, body}` with LF line ends. Lookup is by content like a spec's (`§13.2`), so approval survives rebase and an edit of any field except `authors` returns the record to Awaiting Review with reason `edited`; a record never approved has `never-approved`, and one not yet committed `not committed`. An approval record has no `cited` entries: a record depends on no other part. Approval needs committed content and the `spec.approve.<type>` permission of the specification's type (`spec.approve.feature` for a decision record); the approver is never invented. Reading and listing use the working-tree file with the status of the committed one.

### §14.3 Validation

The `decisions` rule family, run only when records are on: a file name that is not `D<n>.md`, a broken frontmatter, a mismatched `id`, a missing title or invalid date, a missing or empty Decision or Context section, an unknown section or text before the first section are errors; a `concerns` entry that is neither an existing specification ID, nor a resolvable cite, is a warning. With records off the folder is not read.
