---
id: architecture/reference-cli
title: Reference CLI
authors:
  - llm: claude-sonnet-5-5
    contribution: drafted
implements: [cli R16, harness R34, configuration R25, configuration R25.1, plan-execution R27, specifications R1, specifications R5, specifications R7, specifications R9, specifications R10, specifications R10.1, specifications R11, specifications R11.1, specifications R11.2, specifications R11.3, specifications R11.4, specifications R40, cli R16.1, verification R12, verification R24, verification R24.1, verification R64, configuration R54, roles-and-permissions R42, roles-and-permissions R42.1, roles-and-permissions R42.2, roles-and-permissions R44, roles-and-permissions R46, roles-and-permissions R50, roles-and-permissions R55, roles-and-permissions R56, roles-and-permissions R56.1, roles-and-permissions R57, cli R17.1, cli R17.2, requests R52, requests R52.1, requests R52.2, requests R52.3, requests R52.4, requests R52.5, plan-execution R27.5, plan-execution R27.5.1, plan-execution R27.5.2, verification R13, verification R13.1, verification R36, verification R36.1, verification R36.2, verification R61, verification R61.1, verification R61.2, verification R61.3, verification R61.4, verification §2, verification §3, plans R28, plans R28.1, plans R29, plans R29.1, plans R29.2, plans R29.3, plans R30, plans R30.1, plans R69, plans §2, plans §2.1, plans §2.2, plans §3.1, plan-execution R27.1, plan-execution R27.1.1, plan-execution R27.2, plan-execution R27.2.1, plan-execution R27.3, plan-execution R27.4, plan-execution R27.6, plan-execution R31, plan-execution R31.1, plan-execution §2, plan-execution §3, harness R14, harness R18, harness R19, harness R19.1, harness R19.2, harness R20, harness R20.1, harness R26, harness R26.1, harness R26.2, harness R35, harness R35.1, harness R47, harness §2, steering R51, steering R59, steering R59.1, steering R22, steering R23, cli R17, cli R33, cli R33.1, verification R32, verification R36.3, roles-and-permissions R43, roles-and-permissions R49, roles-and-permissions R55.1, roles-and-permissions R58, later-releases R37, later-releases R39, later-releases R66, plan-execution R31.2, harness R21, harness R38, roles-and-permissions R44.1, roles-and-permissions R60, harness R21.1, harness R38.1, later-releases R37.1, later-releases R39.1, later-releases R39.2, later-releases R39.3, later-releases R39.4, architecture/agent-skills §7.12, roles-and-permissions R48]
references: [architecture/agent-skills §7.5, architecture/file-formats §7.3, cli §2, architecture/file-formats §6.2, architecture/repository-layout §3, architecture/repository-layout §2, architecture/file-formats §6, configuration §2, architecture/file-formats §9.2, architecture/repository-layout §1, architecture/file-formats §9.1, architecture/file-formats §2.1, architecture/file-formats §1.1, architecture/file-formats §3.3, architecture/file-formats §11.2, architecture/file-formats §3.1, architecture/file-formats §3.2, architecture/file-formats §3.4, architecture/file-formats §5.2, architecture/file-formats §1.2, specifications R2, specifications R68, architecture/file-formats §4.2, architecture/file-formats §4.5, architecture/file-formats §2.4, architecture/file-formats §2.3, architecture/file-formats §8, architecture/file-formats §2.5, architecture/file-formats §2, specifications R4, architecture/file-formats §5.3, architecture/file-formats §11.3, architecture/file-formats §7.1, architecture/file-formats §7.2, roles-and-permissions §2, requests §2, architecture/file-formats §10, verification §2.1, verification §2.2, architecture/file-formats §11.1, architecture/file-formats §11.4, architecture/file-formats §5, architecture/file-formats §5.5, architecture/file-formats §5.4, architecture/file-formats §5.1, architecture/repository-layout §5, harness §3, architecture/file-formats §7.4, architecture/file-formats, steering, architecture/repository-layout, architecture/agent-skills, plans, harness, architecture/file-formats §13, architecture/file-formats §13.1, architecture/file-formats §13.2, architecture/file-formats §13.3, architecture/file-formats §13.4, architecture/file-formats §7.5]
---

# Reference CLI

This spec says how the reference implementation of Specplane is built: the technology, the module structure, how a repository and its configuration are loaded, how specs are parsed and cites resolved, how fingerprints and approvals are computed and checked, how validation, warnings, permissions, requests, the audit log, tests, plan flows, harness actions and human commands work, and which checks run in pre-commit hooks and CI. File contents are in `architecture/file-formats`; where files live is in `architecture/repository-layout`. The way harness text, steering and instructions are delivered is in `architecture/agent-skills`. Each section states which feature sections it implements. Details the feature specs leave open are marked "assumption". Items for later releases are marked "later release" and are not built first.

## §1 Technology choices

Implements `harness R34`.

- **Language and runtime.** TypeScript on Node.js 22 or later, compiled with `tsc` to `dist/`. The package is `specplane` on npm with one binary, `specplane`. Tests run through the repository's test script (`AGENTS.md`).
- **One core, several front ends.** All behaviour lives in a core library that never prints and never reads the terminal. Three thin front ends call it: the CLI (people), the harness adapter (the LLM, `§12`) and the user-command runner of a harness (a person typing a harness command, `§12.2`). The front end decides which role the call runs under (`§7.1`); the core never guesses it. This is what makes "same checks everywhere" (`cli §2`) true by construction.
- **Libraries.** `commander` for command routing and help; `yaml` (the eemeli library, YAML 1.2, comment-preserving document API) for reading and writing frontmatter, configuration and progress files, replacing `js-yaml` and `gray-matter` of the earlier build (assumption: round-trip writes are needed, `architecture/file-formats §6.2`); `ajv` with `ajv-formats` for the JSON records of the local store and the configuration schema. No native dependencies.
- **Git and forge.** The `git` command, started without a shell and with a fixed environment (`LC_ALL=C`, no pager, no prompts). The `gh` command is used only to open a pull request, and only when it is installed (`§11.7`). No git library is used.
- **Determinism.** The CLI and core never call an LLM. Intelligent checks are carried out by an LLM in a harness and recorded through the core (`§10`).
- **Time and randomness** (dates, ID suffixes) come from one injectable clock and random source, so tests are reproducible (assumption).
- **Output.** Every command produces a result object; one formatter prints it as text and another as JSON (`--json`). See `§13.3`.

## §2 Module structure

Implements `harness R34`. Names are the target structure; the current code under `packages/cli/src` is moved toward it, and obsolete modules are removed only after live callers are replaced. Overlay and ADR lifecycle support is deferred pending the product decisions in `later-releases R37` and `later-releases R39`; migration must preserve their source records and must not assume subprojects preserve overlay semantics.

```
src/
  cli.ts                    entry point, registers commands
  repo/        repo.ts      checkout root, main root, git common dir (§3.1)
               config.ts    load, validate, edit configuration (§3.2)
               store.ts     local store under the git common dir (§3.3)
  spec/        frontmatter.ts   split and parse frontmatter, round-trip edit (§4.1)
               sections.ts      headings, section ranges, Test lines (§4.2)
               cites.ts         extract and resolve cites (§4.3)
               requirements.ts  requirement markers and retired IDs (§4.4)
               project.ts       load the project snapshot (§4.5)
               fingerprint.ts   spec-v3 and sec-v1 (§5.1)
               status.ts        effective status, outdated reasons (§5.2)
               approve.ts       groups, checks, approval record write (§5.3)
               notes.ts         notes store: read, lookup by fingerprint, append, sync (§5.5, §5.6)
               migrate.ts       one-time move of frontmatter records to notes (§5.7)
               metadata.ts      metadata read, write, overrides (§13.2)
  verify/      validate.ts      rule registry and runner (§6.1)
               rules/*.ts       one file per rule family
               warnings.ts      warnings collector, auto-warn line (§6.3)
               coverage.ts      coverage views (§6.4)
               tests.ts         test declarations, run, record (§10)
               implementation.ts  mark implemented (§10.4)
  perm/        catalog.ts, presets.ts, roles.ts, guard.ts, docs.ts (§7)
  requests/    store.ts, accept.ts (§8)
  audit/       log.ts, retention.ts (§9)
  plan/        parse.ts, validate.ts, progress.ts, next.ts, start.ts, stop.ts,
               resume.ts, budget.ts, review.ts, finish.ts, abandon.ts, merge.ts,
               worktree.ts, meta.ts (§11, §13.5)
  harness/     actions.ts, adapter-claude.ts, adapter-codex.ts, instructions.ts,
               retrieve.ts, steering.ts, install.ts (§12)
  git/         exec.ts, blobs.ts, commit.ts, worktree.ts, hooks.ts (§1, §14)
  docs/        bundle.ts, search.ts (user and AI-facing documentation, §12.5)
  output/      text.ts, json.ts (§13.3)
  errors.ts, types.ts, clock.ts
  commands/    one file per command group, each only maps arguments to core calls (§13)
```

Rules: `spec/`, `verify/`, `plan/` and `requests/` never import from `commands/` or `harness/`; every write operation in the core takes an `Authorized` value that only `perm/guard.ts` creates (`§7.3`); only `repo/store.ts` writes into the local store and only `git/exec.ts` starts processes.

## §3 Repository, configuration and local store

Implements `configuration R25`, `configuration R25.1`, `plan-execution R27`.

### §3.1 Roots

- `checkoutRoot()` is `git rev-parse --show-toplevel` of the directory the command runs in; configuration, specs and plans are read relative to it, so a command run in a plan worktree sees that branch's files.
- `mainRoot()` is the parent directory of `git rev-parse --path-format=absolute --git-common-dir`; it is used only for `plans.worktree_dir` and the project folder name (`architecture/repository-layout §3`).
- `storeDir()` is `<git-common-dir>/specplane` (`architecture/repository-layout §2`).
- Outside a git repository, commands that need git fail with `NotARepoError`. `specplane docs` and `specplane --help` do not need a repository.

### §3.2 Configuration

- `config.ts` reads `.specplane/config.yaml` as committed at HEAD of the checkout (`git show HEAD:.specplane/config.yaml`), not the working tree, so the active preset and every other setting are the committed ones; an uncommitted change is ignored and validate and status warn that the file differs from HEAD (`architecture/file-formats §6.2`, `architecture/file-formats §7.3`). A missing file at HEAD means all defaults. The result is a fully populated `Config` plus a list of findings (unknown key, wrong type, non-positive number, unusable path, missing permission or preset) from the schema in `architecture/file-formats §6`, `§6.1` and `§6.2`. A bad key is dropped and its default used; the loader never throws on content (`configuration R25`).
- The loader runs once per command and the `Config` object is passed down; nothing re-reads it mid-command, so a change applies from the next command.
- Writing: `config set <key> <value>` and `config unset <key>` edit the working-tree YAML document in place (it takes effect once committed) (comments and key order kept), validate the new value against the schema before writing, and write through a temp file and rename. A setting set to its default is written as given (`configuration §2`).
- Every write is a guarded operation with permission `config.change` (`§7`). Under `request-user` the request holds `params: {key, old, new}` (`architecture/file-formats §9.2`). The audit entry carries `old` and `new` (`§9`). Setting `permissions.preset` is the same operation.
- Side effects of a setting are applied by the same operation: turning `pre_commit.*` on or off installs or removes the hook section (`§14.2`); changing `permissions.preset` triggers steering regeneration (`§12.4`).
- Reading is unguarded and lists every key with its value, whether it is set or default, and its default (`configuration R25`). Settings for later releases are accepted and shown, with a note that they have no effect yet.
- Terms of the old model are reported as unknown settings (`architecture/file-formats §6.2`).
- Assumption: `paths.*` and `plans.dir` are resolved and checked once at load time (inside the repository, not overlapping, `architecture/repository-layout §1`) and the checked absolute paths are what the core uses.

### §3.3 Local store

`repo/store.ts` is the only code that touches `<git-common-dir>/specplane/`. It creates the directory on first write, treats missing files as empty, writes JSON and YAML files through a temp file and rename, and appends audit lines with one `write` of a complete line (`architecture/repository-layout §2`). Files and their formats are those of `architecture/file-formats §9.1` and `§9.3`: `requests/`, `audit.jsonl`, `logs/`, `worktrees.json`, `runs/` (run marker, `§11.3`), `reviews/` (target commit seen by the final review, `§11.6`), `sessions/` (instructions already delivered, `§12.3`), `role.json` (the Administrator switch, `§7.1`) and `tmp/` (temporary checkouts, `§10.2`, `§14.2`). Plan budgets are not here: they are plan metadata (`architecture/file-formats §5.4`).

## §4 Specification parsing and cite resolution

Implements `specifications R1`, `specifications R5`, `specifications R7`, `specifications R9`, `specifications R10`, `specifications R10.1`, `specifications R11`.

### §4.1 Frontmatter

`frontmatter.ts` splits a file at the first line `---` and the next line that is exactly `---`. The block is parsed with the `yaml` library in the core schema with unique keys and no custom tags; dates stay strings (`architecture/file-formats` intro). The result is `{data, bodyOffset, raw}`. A file whose first line is not `---`, whose block does not parse, or whose required fields are wrong yields a `FormatFinding` and the spec is marked invalid; it is still listed and never silently skipped (`verification R12`). Field rules are those of `architecture/file-formats §2.1`. The legacy keys `status`, `approval`, `review-reason`, `results` and `implementation` are read only to warn about them and for migration (`§5.7`); they never feed status. `INFO.md` is read as plain markdown and reported only when it has frontmatter (`architecture/file-formats §1.1`).

Editing writes back through the YAML document so untouched lines are byte-identical; only the named keys change. A spec's body is never rewritten by metadata operations. Authors are appended, never reordered (`specifications R10`, `specifications R10.1`).

### §4.2 Sections

`sections.ts` scans the body line by line, ignoring fenced code blocks, and builds an index of ATX headings. A citable heading matches the grammar of `architecture/file-formats §3.3`. The index maps each section ID to `{level, startLine, endLine}`, where `endLine` is the line before the next heading of equal or lower level. Duplicate section IDs and a child under the wrong parent are reported. The same pass collects the labelled Test lines of each section (`Test T<n> (deterministic):`, `Test T<n> (intelligent):`) and reports a duplicate label within a section as an error (`architecture/file-formats §11.2`).

### §4.3 Cites

- **Extraction.** `cites.ts` finds inline code spans outside fenced blocks whose whole content matches the cite grammar of `architecture/file-formats §3.1`, and reads the frontmatter lists `covers`, `implements`, `references`. Each cite records the file and line for messages. A cite inside the section that defines it is dropped (`architecture/file-formats §3.2`).
- **Resolution** follows `architecture/file-formats §3.4` exactly, in this order: project, then requirement or spec file, then section. The result is `{kind, file, startLine, endLine, text}` or an error with a reason (`requirement not found`, `retired`, `duplicate`, `spec not found`, `section not found`, `unknown project`).
- **Where text is read from.** Resolution takes a `Source`: `committed(rev)` reads blobs with `git cat-file --batch` (one process for the whole run), `worktree` reads files. Status uses `committed(HEAD)`, format checks use both (`§5.2`, `§6.1`).
- **References check.** For each spec, the set of cites found in the body must be a subset of `covers` plus `implements` plus `references`, and the reverse is a warning (`architecture/file-formats §2.1`, `specifications R9`).
- **Dependencies.** The dependency set of a spec is the resolved targets of those three lists. Plans add `plan/<id>` and `file:<path>` targets (`architecture/file-formats §5.2`, `§12.3`). The dependency graph is built once per snapshot and used for approval groups, plan cycles and coverage.

### §4.4 Requirements

`requirements.ts` finds the central file by the rule of `architecture/file-formats §1.2` (reporting zero or several candidates) and parses the requirement files it names: marker lines, ID tree, retired list, and each requirement's text range including sub-requirements (`architecture/file-formats §1.2`, `§1.3`). It reports duplicate IDs, retired IDs in use and orphan sub-IDs (`specifications R1`). It never writes the requirements page (`specifications R2`). The "next free ID" helper used by harness actions is highest ever used plus one.

### §4.5 Project snapshot

`project.ts` loads, for a given `Source`, the requirement files, every spec in `paths.features` and `paths.architecture`, and the plans in `plans.dir` and its archive, then the index of sections and cites. Layers that are absent are empty, never an error (`specifications R68`). The snapshot is immutable and shared by validation, status, coverage, retrieval and the final review. The snapshot at HEAD is cached for the life of one command.

## §5 Fingerprints, status and approval

Implements `specifications R11`, `specifications R11.1`, `specifications R11.2`, `specifications R11.3`, `specifications R11.4`, `specifications R40`, `cli R16`, `cli R16.1`.

### §5.1 Computing fingerprints

`fingerprint.ts` implements `architecture/file-formats §4.2` and `§4.3`:

- `specFingerprint(text)`: parse frontmatter, drop `status`, `approval`, `authors`, `review-reason`, `results`, `implementation` (legacy record keys, kept in the list so legacy files hash the same after migration), `title`, `covers`, `implements`, `references` (metadata, `cli R17`), serialise `{frontmatter, body}` as canonical JSON (keys sorted by code point, no whitespace, literal Unicode), SHA-256, prefix `spec-v3:sha256:`. The body is the text after the closing fence with CRLF and CR turned into LF.
- `partFingerprint(text)`: LF-normalised part text, trailing blank lines removed, prefix `sec-v1:sha256:`. A whole-spec cite uses `specFingerprint` of the cited file. An unresolved cite has no fingerprint.
- `planFingerprint(plan)`: the same procedure over PLAN.md, keeping those four keys, with the `commit` of every `implements` entry removed as well, plus every step file in step order, prefix `plan-v1:sha256:` (`architecture/file-formats §5.2`). `progress.yaml`, HANDOFF.md and `spec-gaps.md` are not read.
- Canonical JSON is a small local function (about 30 lines) rather than a library, so the byte output is fixed by this spec and not by a dependency version (assumption). Fingerprint prefixes are versioned; an unknown prefix in a record is reported and treated as changed.

### §5.2 Effective status

`status.ts` implements the algorithm of `architecture/file-formats §4.5` over `committed(HEAD)` and the notes store (`§5.5`), and returns `{status, reasons[], notes[]}`:

1. A requirement file is `approved` with no reasons and no lookup (`architecture/file-formats §1.2`).
2. Compute `specFingerprint` of the HEAD blob and ask `notes.ts` for the applicable records of the spec (`§5.5`). None: `awaiting-review` with reason `never-approved`, or `edited` when records of the spec with another fingerprint exist.
3. The newest applicable `approval`, `override` or `reopen` record decides, ordered by `at` then `rid` (`architecture/file-formats §13.2`). `reopen`, or an `override` to awaiting-review, gives `awaiting-review` with reason `edited`.
4. For each entry of the decisive record's `cited`, resolve the cite at HEAD and compare part fingerprints; a difference, or no resolution, adds `outdated: <cite>`. A requirement part is compared like any other part. A dependency not in `cited` was added after approval and is not compared (metadata, `architecture/file-formats §4.5`).
5. Each dependency that resolves to a spec other than a requirement file and whose decisive record is not an `approval` or an `override` to approved (or that has none) adds `unapproved-dependency: <cite>` (`specifications R11`). It reads the cited spec's newest `approval`, `reopen` or status `override` record regardless of fingerprint and only its kind, so a mere edit of the cited spec does not flag citers (`specifications R11.2`). Requirement files never add this reason.
6. If the working tree file differs from HEAD, add the note "uncommitted changes are ignored" (`specifications R40`).
7. An `override` to approved is treated like any other approval: it carries the fingerprints that `override status` wrote from the content at that moment, so a later content or cited-part change returns the spec to `awaiting-review` (`cli R17.2`, `architecture/file-formats §2.4`).

**Test T1 (assumption, deterministic):** a fixture repository with a notes ref: a spec with an `approval` record whose fingerprint matches stays `approved` after the commit is rebased (notes copied or not); changing one cited part, including a requirement part, gives `outdated: <cite>`; a spec citing a non-requirement spec with no applicable record gives `unapproved-dependency: <cite>`, and a spec citing a requirement file does not.

Statuses of many specs are computed in one pass over the shared snapshot and one read of the notes ref, so listing the project costs one `git cat-file --batch` process plus one notes read. A spec file that still has a legacy key produces the warning of `architecture/file-formats §2`.

### §5.3 Approval

`approve.ts` implements `cli R16`. Inputs: spec IDs (IDs only, never natural language) and options `--yes` and `--ref <branch>`. A spec written on a plan branch can be approved from any checkout with `--ref <branch>` (default: the current branch): the specs are read at that branch's head, the checks of step 2 apply to that head, and the record is attached to that head in the notes store (`architecture/file-formats §13`), so it counts on that branch and travels with it on merge.

1. **Resolve and expand.** Resolve each ID to a spec file. Build the dependency graph among specs and take strongly connected components: the group of a named spec is its component, so a spec that cites a cycle without being cited back is not in it (`cli §2`). The union of the groups of all named IDs is the set to approve.
2. **Checks, all collected, none stopping the others** (`cli R16`):
   - the role holds `spec.approve` as `allow` for every member (`cli R16.1`); under `request-user` one request is created for the whole set and nothing else runs (`§8`);
   - each member's file is committed and unchanged in the working tree;
   - every cite resolves; a missing part is named;
   - each non-requirement specification dependency outside the set is effectively `approved` at HEAD; requirement files are always approved and are not checked;
   - no member has a current failed test result (`verification R61.1`, `§10.3`);
   - a member that is already effectively approved is left alone; approving only such members does nothing and says so.
3. **Confirm.** When the set has more than one member, print the list and ask; `--yes` skips the prompt. Without a terminal and without `--yes` the command refuses (assumption).
4. **Write.** If any check failed, nothing is written and every reason is printed. Otherwise, for each member, compute `fingerprint` and `cited` from the HEAD content and build an `approval` record (`architecture/file-formats §2.3`, `§4.4`, `§13.2`) with a fresh `rid`, `at` now, `by` from git `user.name` (an LLM approver is `{llm, delegated-by}`) and `date` from the clock. Members of one group get the same `by` and `date`. The spec file is not touched.
5. **Notes commit.** All members' records are appended to the note on HEAD and committed in one notes commit on `refs/notes/specplane` only; no commit is made on the branch and the working tree and index are untouched (`architecture/file-formats §13.3`). The approval counts once the notes commit exists (`specifications R40`); it is local until synced (`§5.6`). `--no-commit` is not offered; there is nothing to stage.
6. **Audit.** One entry per member (`§9`).

Approval from the harness is the same function with the LLM role (`§12`); only the guard result differs (`harness R20`, `harness R20.1`).

### §5.4 Review state

A content edit by the CLI or core (`spec.edit`) writes only the content: the new fingerprint makes the spec `awaiting-review` on read, with reason `edited`, and nothing about status or review reason is written (`specifications R11.3`, `specifications R11.4`, `architecture/file-formats §2.5`). `spec reopen <id>` (human, guarded by `spec.edit.<type>`, assumption) appends a `reopen` record for the current fingerprint to the note on HEAD and commits the notes ref, by the rule of `§13.4`.

### §5.5 Notes store

`notes.ts` implements `architecture/file-formats §13`.

- **Read.** One pass: list the notes of `refs/notes/specplane` (`git notes --ref=specplane list`, then `git cat-file --batch` for the blobs), parse each as JSON Lines and build an index `spec -> fingerprint -> records` once per command. The match itself never walks history; notes on commits that are not reachable from HEAD still count. A record whose attached commit is reachable from HEAD is further checked with `git log <commit>..HEAD -- <path>`, comparing the fingerprint of each blob, and stops applying when one differs (`architecture/file-formats §13.2` rule 2); the result is cached per attached commit for the command. A line that does not parse, a record without the required fields (`rid`, `at`, `spec`, `kind`, `fingerprint`) or with an unknown fingerprint prefix is skipped and reported as a validation warning, never silently dropped.
- **Order.** Records are ordered by `at`, then `rid`; position in a note is never used.
- **Append.** Read the note on HEAD, add compact JSON lines at the end, write it back so the commit is on the notes ref only. Several records of one command go in one notes commit. A failed ref update because another writer moved the ref is retried from a fresh read.
- Writes need no clean working tree and never touch the index, working tree or HEAD.

### §5.6 Sync

- `init` sets, for each remote, the fetch refspec `+refs/notes/specplane:refs/notes/remotes/<remote>/specplane` unless present (idempotent, assumption). The local `refs/notes/specplane` is never a fetch target, so a fetch cannot overwrite it.
- `specplane sync [<remote>]` (guarded by `info.retrieve`, assumption: no separate permission) does, in order: fetch the remote's notes into the remote-tracking ref; `git notes --ref=specplane merge -s cat_sort_uniq refs/notes/remotes/<remote>/specplane`; `git push <remote> refs/notes/specplane`. A step that fails stops the command and says which step. With no remote name it uses the single remote, or `origin` (assumption). The merge is correct because records are unique lines (`architecture/file-formats §13.1`). Other commands never push.
- `validate` warns (`architecture/file-formats §13.4`) when the notes fetch refspec is missing, when a remote's notes ref has no local remote-tracking copy or is not merged into the local ref, or when no remote notes ref exists while local records exist. These are warnings, never errors.

### §5.7 Migration

`specplane migrate status` (`config.change`, assumption; one-time) reads every spec and plan (not requirement files) at HEAD with a legacy `approval`, `results` or `implementation` key and for each:

1. For a spec or plan, appends an `approval` record (fresh `rid`, `at` now) to the note on `approval.commit`, with `fingerprint` and `cited` as stored or, for the hand format, computed from the content and cited parts at that commit; when that commit is missing, the note goes on HEAD with the recorded fingerprint, or the HEAD fingerprint when none was recorded. An `override` mark becomes an `override` record with `target: status` and `value: approved`. Each `results` entry becomes a `test-result` record on its `commit`; `implementation` becomes an `implementation` record when its `status` is `implemented` or `complete` (or absent); another status is skipped with a warning.
2. Deletes `status`, `approval`, `review-reason`, `results` and `implementation` from the file.

The file changes are committed together in one branch commit, `docs(specs): move records to notes`, after the notes commit succeeds; a failed run leaves the files untouched and is safe to rerun, because a record is appended only when none with the same `spec`, `kind` and `fingerprint` exists from an earlier run (assumption). Requirement files are skipped: they are always approved, and a warning names each one that still has a legacy key so the user can remove it by hand. After the commit the fingerprints of the files are unchanged (`architecture/file-formats §4.2`), so every migrated approval still applies. `--dry-run` lists the records and edits.

## §6 Validation, warnings and coverage

Implements `verification R12`, `verification R24`, `verification R24.1`, `verification R64`, `configuration R25`, `configuration R54`.

### §6.1 Validation engine

- **Rules.** `verify/rules/` holds one module per family, each exporting `rules: Rule[]` with `{id, severity, source, run(snapshot) -> Finding[]}`. A runner executes every rule on the snapshots it needs and sorts findings by file and line. Families: `spec-format` (`architecture/file-formats §2`), `cites` (`§4.3`), `requirements` (`§4.4`), `plans` (`§11.1`), `status` (`§5.2`), `tests` (`§10`), `config` (`§3.2`), `permissions` (`§7.4`), `harness` (`§12.6`).
- **Finding** is `{severity: error|warning|note, rule, message, file, line, section, source: committed|worktree}`. Errors are things that make a file unusable: unreadable or invalid frontmatter, ID/path mismatch, unresolved cite, missing reference entry, duplicate or reused requirement ID, plan ID/folder mismatch, plan reference cycle, unreadable step, unreadable notes record. Warnings are project-state findings: uncovered items, outdated specs and results, outdated plan references, listed-but-unused references, legacy record keys in spec files, local notes behind remote, harness and steering staleness, permissions without documentation, unwritable audit log.
- **Committed and working tree.** Status, outdated and test-state rules read `committed(HEAD)`. Format rules run on both and a finding says `worktree` when the file differs from HEAD (`verification R12`).
- **Scope.** The command takes zero or more spec or plan IDs and then checks only those and their cites.
- **Exit status.** 0 when there are no errors, 1 otherwise; warnings never change it. `--json` prints the findings list and counts (`§13.3`).
- **Read-only.** The runner receives a snapshot and no writer; it cannot write files, status or the store except the audit entry of the run (`§9`).
- **Intelligent checks** (separation of layers, `specifications R4`) are not rules. They are instructions delivered by the harness (`harness R14`); an LLM may record results as warnings through the `warnings.report` action (`§12.1`, assumption), shown in the warnings list for the current session only.
- **No requirements, plans or later layers** produce no findings (`specifications R68`, `plans R69`).

### §6.2 Rule details worth fixing here

- Cites inside plans follow the same resolver; `file:<path>` must exist, and a `context` file that does not exist yet is a warning (`architecture/file-formats §5.3`).
- A plan reference cycle is found with Tarjan's algorithm over `plan/<id>` edges and reported naming the members.
- A spec with `covers` on an architecture spec, or `implements` on a feature spec, is an error (`architecture/file-formats §2.1`).
- A legacy key (`status`, `approval`, `review-reason`, `results`, `implementation`) in a spec or requirement file is a warning pointing at `specplane migrate status` (`architecture/file-formats §2`); an `implementation` record for a non-architecture spec is a warning (`architecture/file-formats §11.3`).
- Notes store checks: unparseable notes or records and a local ref behind the remote are warnings (`§5.5`, `§5.6`).
- A summary in a result that matches the credential heuristic (token names such as key, secret, password; strings of 32 or more base64 or hex characters) is a warning, never an error (`verification R61.3`).

### §6.3 Warnings collector

`warnings.ts` merges two kinds of source into one list: warning findings from the rules above, and checks that are not validation: audit log not writable (set by the audit writer during the command), harness installation missing or older than the installed Specplane (`§12.6`), steering stamp older than the active preset or steering (`§12.4`), permission without documentation or steering (`§7.4`), pre-commit setting on with no hook installed (`§14.2`). Each warning is `{text, subject: spec|plan|permission|installation, why}`. The list is recomputed on every call and nothing is stored or dismissed (`verification R24`). `specplane warnings [<id>]` narrows to one spec or plan. A warning never blocks.

**Auto warn** (`verification R24.1`): the command runner, after the command's own result is final, calls the collector when `auto_warn` is on and appends the count as the last text line, worded `N warnings; run `specplane warnings`` (`0 warnings` when none; `verification R24.1` requires only the count, the wording is an assumption). In JSON output the top-level `warnings` field stays the array of command notices (`§13.3`) and the count is a separate numeric `warning_count` field; the data is untouched. Failure of the collector never changes the command's status; it prints `warnings unavailable` (assumption). Harness adapters add the same count to the result text they return to the LLM.

### §6.4 Coverage

`coverage.ts` builds, from the dependency graph (`§4.3`), for each requirement the feature specs that list or cite it, for each feature spec the architecture specs that do, and for each spec the items it covers. Two views are returned: all items with their coverers, and uncovered items only. Uncovered requirements and feature specs are warnings (`§6.3`). No requirement is automatically exempt, including non-goals and unwanted outcomes. IDs in `coverage.requirement_only` are annotated as intentional requirement-only items but remain in the uncovered view and warning count (`verification R64`). Absent layers are skipped; several coverers are all shown and not warned. Both views are available to people and, under `info.retrieve`, to the LLM.

## §7 Roles, permissions and presets

Implements `roles-and-permissions R42`, `roles-and-permissions R42.1`, `roles-and-permissions R42.2`, `roles-and-permissions R44`, `roles-and-permissions R46`, `roles-and-permissions R50`, `roles-and-permissions R55`, `roles-and-permissions R56`, `roles-and-permissions R56.1`, `roles-and-permissions R57`, `configuration R54`, `cli R16.1`, `cli R17.1`, `cli R17.2`.

### §7.1 Which role runs

The role is chosen by the front end, never by arguments, files in the project, or anything an LLM can write:

- The CLI runs as `standard-user`. `specplane role switch administrator` writes `role.json` in the local store (`§3.3`) with the OS user who switched; until `specplane role switch standard-user`, CLI calls by that user on this machine run as the Administrator. With no mapping configured anyone may switch (`roles-and-permissions R44`). With a mapping (`os-users.json`, `architecture/file-formats §7.5`) `cliRole` returns the mapped role of the OS user (`os:<name>`), the Standard User for an unmapped user or a role that does not apply, and the Administrator only after a switch by a user whose mapping has `admin_switch`.
- The harness adapter runs LLM actions as `llm` unless an LLM role rule matches (`roles-and-permissions R44.1`): `createActionRuntime` resolves the role on every call with `resolveLlmRole` from the session's factors from the adapter's environment (`§12.1`), overridden per call by the caller record where the host gives one. A subagent has the role of the LLM that started it unless a rule gives it another (`roles-and-permissions R42.1`).
- A person's typed harness command runs through the user-command runner as `standard-user` (or the switched role), never as `llm` (`harness R18`).
- Every guarded call carries `Actor {role, kind: human|llm, name, model?, session?}`; the audit log records it (`§9`).

### §7.2 Catalog and presets

`catalog.ts` holds the permission IDs of `architecture/file-formats §7.1` with, per permission: description, what it does not allow, the commands that use it, and its steering text key (`configuration R54`). `presets.ts` embeds the four default presets in the shape of `architecture/file-formats §7.2` and exposes `mode(preset, role, permission)`: role entry, else role `default_mode`, else preset `default_mode`, else `deny`. The Administrator is hard-coded to `allow` for everything and is not a preset. A permission needed by a command that is not in the catalog is a validation finding (`§7.4`).

### §7.3 Guard

`guard.ts` is the one enforcement point (`roles-and-permissions R55`, internal restriction).

```
guard(ctx, permissions[], describeAction) ->
  { kind: "allow", token: Authorized }
  { kind: "request", permission, requestDraft }
  { kind: "deny",  permission, message }
```

- A command declares the list of permissions it needs (`roles-and-permissions R50`: a command may need several). The result is `deny` if any is `deny`, else `request` if any is `request-user`, else `allow`. The permission named is the first one that decided the result.
- Granular metadata permissions: `meta.write.<piece>` or `meta.write`, and the more permissive mode wins (`cli R17.1`). Protected overrides never fall back to `meta.write` (`cli R17.2`).
- `Authorized` is an opaque value holding the permissions and the actor. Every mutating core function (write spec metadata, approve, record result, write config, plan flows, accept request) takes one as its first argument; no front end can build it. A function that needs two permissions checks the token covers both (type check plus a runtime check). Read-only operations (reads, validation, warnings, coverage, running tests, audit reading) are guarded by `info.retrieve` (`verification §2.2`), except viewing documentation, steering and permissions (`docs`, `steering`, `permissions`, `§13.1`), which need no permission and are not guarded. The guard decides `allow` or `deny` for them like any other action, but they write nothing and so take no `Authorized` token. `request send` needs no permission (`roles-and-permissions R50`) and takes no token.
- On `deny` the message names the permission, says the action is refused, and tells the LLM not to look for another way (`steering R51`). On `request` it creates the request draft (`§8`). A refused or held action runs no part of the operation (`roles-and-permissions R50`).
- The audit writer is called by the guard for every decision (`§9`), including refusals; the command runner also audits every command, reads included (`§9`).
- A permission shared by several commands is evaluated by the same function and therefore has one mode (`roles-and-permissions §2`).

### §7.4 Documentation

`specplane permissions` lists every permission with the mode in the active preset for each role; `specplane permissions <id>` shows its full documentation: what it allows and does not, commands, mode per default preset, the reader's own role and mode, and the complete steering including custom steering (`configuration R54`). The harness serves the same function (`§12.5`). Changing the preset changes what is shown on the next command (`configuration R54`). Validation warns when a catalog entry has no description or steering key, and fails the build in tests when a preset lacks an entry for a catalog permission it should state (`steering R51`). **Test T1 (assumption, deterministic):** for each default preset, the mode of every catalog permission for Standard User and LLM equals the table and lists of `roles-and-permissions R57`, using the complete example of `architecture/file-formats §7.2`.

### §7.5 Custom presets

`perm/presets.ts` validates and reads the preset files of `architecture/file-formats §7.4` (from HEAD for what applies, from the working tree for the commands that edit them) and writes them in the shape of `§7.2`; `perm/preset-ops.ts` holds the operations and `commands/preset.ts` the front end. `activePreset`, the documentation (`§7.4`), steering generation and the `permissions.preset` check all resolve a preset ID through one function (`findPreset`), which looks in the four embedded presets first and then in the custom ones, so a custom preset behaves like a default one everywhere.

- `specplane preset list|show <id>` read and need no permission. `specplane preset create <id> [--default-mode m] [--from preset] [--title t] [--set role:permission=mode]...`, `specplane preset edit <id> [--default-mode m] [--title t] [--set ...] [--unset role:permission]...` and `specplane preset delete <id>` write the working tree and are never committed by Specplane. `role:*=mode` sets a role default.
- Every write calls `guard` with `config.change` and runs only when the result is `allow`; a `request` result is refused with a message, because a preset change cannot be sent as a request (a request would let the LLM role change what applies to the Standard User). The management level check follows: the actor's level (`roles-and-permissions R42.2`; Standard User 10, LLM 5, Administrator above all) must be above the level of every role the preset applies to except the actor's own. Assumption: this is the page's management permission and level (`roles-and-permissions R56`) until custom roles exist. Refusals and successes are audited with the command name, permission `config.change`, and the old and new default mode.
- `create` requires a default mode, given or copied with `--from` (`roles-and-permissions R56.1`), refuses an ID that exists or belongs to a default preset, and validates every `--set`. `edit` and `delete` refuse a default preset; `delete` also refuses the preset named by `permissions.preset` in HEAD or in the working-tree configuration.
- Validation reports each malformed preset file at HEAD as an error naming the file; the file is ignored. `loadSettings` reports a `permissions.preset` that names no preset and uses the default preset; `config set permissions.preset` checks the working tree for the preset and refuses an unknown one.

### §7.7 Custom roles, rules and mappings

Implements `roles-and-permissions R43`, `roles-and-permissions R44`, `roles-and-permissions R44.1`, `roles-and-permissions R48`, `roles-and-permissions R49`, `roles-and-permissions R60`. Formats and approval are in `architecture/file-formats §7.5`. `perm/roles.ts` parses and reads the files and the local mapping and trust, and loads the roles that apply (`loadRoleSet`: committed files plus approval records in the notes store, `role-v1` fingerprints); `perm/llm-rules.ts` matches rules (`resolveLlmRole`); `perm/role-ops.ts` holds the operations and `commands/role.ts` the front end. `activePreset` adds the applied roles to the preset as `customRoles`, so `mode`, `guard`, documentation and steering treat a custom role like a default one; `levelOf` gives the management level (`10`, `5`, above all, or the role's).

- `role list`, `role show [id]`, `role mappings`, `role rule list|show` read and need no permission. `role create|edit|delete`, `role approve` and `role rule approve` need `role.manage` as `allow`; `role map|unmap` and `role rule create|edit|delete` need `role.map` as `allow`. `role rule trust` needs no permission but a person. A `request` result is refused with a message (a request would let a lower role change what applies to a higher one), as for presets (`§7.5`).
- Level checks (`above`): the actor's level must be above that of every role concerned, including the old and approved levels for an edit, and a role never changes itself. A role cannot hand out or approve a mode more permissive than its own (`escalation`), except the Administrator. Mapping a user to a role: the role must apply and be below the actor, except for the Administrator (OS users only); the Administrator role and `admin_switch` are for the Administrator only; rules cannot give the Administrator role.
- Every write is audited with the command, the permission, the actor and the old and new values, refusals included. Approval writes a notes record on `HEAD` and refuses uncommitted changes. `role approve <id>` and `role rule approve <id>` also approve committed deletions, checking the last effective level. An approved deletion retires older definitions; recreation needs approval.
- Validation (`loadSettings` findings, so `validate` and the status line show them): an error for a malformed role or rule file; a warning for roles and rules never approved, pending edits and pending deletions. List and show include deleted files still in force and report `approved`, `pending`, `pending-change` or `pending-deletion`; rule fields and trust describe the effective approved definition while a change is pending.

### §7.6 What is not enforced

Roles are not airtight (`roles-and-permissions R55`). The first release enforces through `guard.ts` and the harness block of `§12.7`. In particular the Administrator switch is a local file (`role.json`, `§7.1`) that any process able to run the CLI would also honour; an LLM with a shell tool is kept from the CLI only by the best-effort hook of `§12.7`, which is acceptable under `roles-and-permissions R55`. Tying the switch to a person's terminal is not done; strict mode (`§15`) adds file permissions and a commit check around it. The bypass guards of `§7.8` close the common routes to it for an LLM.

### §7.8 Bypass guards

Implements `roles-and-permissions R58`.

- **Setting.** `bypass_guards.<measure>` (`on` by default) for `llm_marker`, `marker_export`, `marker_protect`, `headless_block`, `store_protect` and `hook_protect` (`perm/bypass.ts`). The measure list and its documentation text are in code; the `config` rule warns for a measure that is off and for a name that is not a measure; the `harness` rule (`§12.6`) warns when the Claude hooks are installed without the bypass-guard hook while a hook measure is on.
- **Marker (`llm_marker`).** The environment variable `SPECPLANE_ACTOR=llm`. `cliActor(root, env)` (`perm/permissions.ts`) returns, for a marked environment, an LLM actor with the role `resolveLlmRole` gives from `SPECPLANE_PROVIDER`, `SPECPLANE_AGENT_TYPE`, `SPECPLANE_SUBAGENT`, `SPECPLANE_MODEL` and `SPECPLANE_DELEGATED_BY` (the same factors the MCP server reads, `§12.1`); `role.json` and the operating system mapping are not consulted, and `switchRole` refuses an LLM actor. The setting is read from the committed configuration. Every CLI command, the harness runner and the plan commands use `cliActor`, so none runs a marked process as a person.
- **Export (`marker_export`).** The Claude session-start hook writes `SPECPLANE_ACTOR`, `SPECPLANE_PROVIDER` and `SPECPLANE_MODEL` to `CLAUDE_ENV_FILE`, which Claude Code applies to every shell command of the session (subagents included), and the plan session launcher (`adapter-claude.ts`) sets the marker and provider in the environment of the headless session it starts. A headless session that inherits the environment, or the CLI run from a shell command, is therefore marked.
- **Hook measures.** `specplane-bypass-guard.sh` is a `PreToolUse` hook on `Bash`, `Write`, `Edit`, `MultiEdit` and `NotebookEdit` (`harnesses/claude` integration spec, section 4). It reads each measure's setting from `.specplane/config.yaml` in the working tree through one read-only core query (`harness guard-config`, `§15.1`); `validate` reads the committed file, so an uncommitted change is a known difference. Failure to resolve the protection settings blocks file edits and shell calls. Best effort, like `§12.7`.
- **Adapter capability.** `bypass-guards` (`§12.6`): Claude claims it only when the hook file is installed; Codex claims nothing, so setup output, `validate` for installed Claude hooks and `docs/user/harnesses` state the gap.
- **Caller record.** `store_protect` covers the `callers/` folder of the local store (the whole local store folder is matched, so no separate pattern is needed); the model could otherwise forge a subagent identity (`§12.1`).
- **Gaps.** Claude gets per-call subagent identity from `specplane-caller.sh` (`§12.1`); where that hook is not installed, and on Codex, rules on a subagent or an agent type apply only where `SPECPLANE_SUBAGENT` or `SPECPLANE_AGENT_TYPE` is set. Codex has no hook, so on Codex only `llm_marker` applies, and only to a process that carries the marker. A process that can run arbitrary code can still clear its environment or write the local store by a route the hook does not read.

## §8 Requests

Implements `requests R52`, `requests R52.1`, `requests R52.2`, `requests R52.3`, `requests R52.4`, `requests R52.5`, `plan-execution R27.5`, `plan-execution R27.5.1`, `plan-execution R27.5.2`.

- **Store.** `requests/store.ts` reads and writes `requests/<id>.json` with the schema of `architecture/file-formats §9.2`, validated with `ajv`. IDs come from the clock and four random hex digits. Writing is temp-file and rename; two writers cannot both accept a request because accept re-reads the file and refuses unless `state` is `pending` (compare-and-set).
- **Sending.** When the guard returns `request`, the front end calls `requests.create` with the guard's draft: the sender, permission, action (`command` and `params`), reason, base branch and commit, plan id, blocking flag. For a spec edit, `params.patch` is a unified diff of the proposed change against the base and `diff` is the same text rendered against the last approved version (assumption: the patch is stored so accept can apply it). The LLM-facing reply says a request was sent and that nothing was done.
- **Deny sends nothing.** A role with `deny` creates no request (`requests R52.3`). A role with `allow` creates one only when the LLM chooses to through the `request.send` action, under steering (`steering R59`); the harness records it with the permission the action would need.
- **List and show.** `specplane requests` and the harness pane list pending first, then answered. `requests show <id>` prints sender, action, reason, and for specs the diff in git diff form with colour on a terminal (`requests R52.1`, `requests R52.4`). The diff is recomputed at show time against the current approved version; a never-approved spec shows all lines as additions.
- **Accepting.** `accept <id>` runs: re-read the record, require `pending`; resolve the checkout the action runs in: a request records the plan id and the plan's checkout, and accepting runs the action in that plan's worktree, found from the plan record, from any checkout the accepter is in; if the worktree is gone the request is refused, naming the missing worktree, and stays `pending`; build a guard check with the accepting person's role and permissions derived from the action against the destination's current HEAD and committed configuration (the stored permission list is informational), requiring `allow` (a role whose mode is `request-user` or `deny` cannot accept, and the missing permission is named, `requests R52.2`); re-check the action against the current state (the same preconditions as direct execution; the base is only context); run the action once under that authority with the accepter as actor and the request id in the audit entry; set `accepted` with `answer {by, date, note}`. If the action cannot be done (patch does not apply, content changed since a test ran) the user is told and the request becomes `failed` with `error` (assumption beyond `requests §2`, `architecture/file-formats §9.2`: it is answered and not retried). An LLM role never accepts: the front end for `llm` has no `accept` or `decline` action (`roles-and-permissions R57`).
- **Declining** sets `declined` and changes nothing else.
- **Accepted `plan start` requests.** Accepting a `plan start` request starts the plan like a plain `plan start`. Through the typed route (`harness run requests accept <id>`) with an adapter (`--adapter` or `SPECPLANE_ADAPTER`) the harness then opens the plan's session through the adapter's launcher, as `plan-start` does, with the session ID chosen before the accept so the plan record, the run marker and the host session name the same one. A request that does not start a plan opens nothing. The accept stands whatever follows: when the adapter lacks `session-opening` (`harness R35.1`) the launch is refused, and when the launch fails the result says so; both print the adapter's manual command (`§11.3`). In a plain terminal (`requests accept <id>`, no adapter) nothing is launched and the output lists the manual command of each installed harness.
- **Blocking requests.** In a plan run `request.send` takes `blocking: bool` (`plan-execution R27.5`). A blocking request soft-stops the plan with reason `waiting for request <id>` (`§11.3`). When it is accepted or declined and the plan is stopped for that reason, the response includes `resume: <plan-id>`; the harness resumes the plan if a session is active, otherwise the plan stays stopped until `plan resume`. The answer is part of the resume context (`plan-execution R27.5.1`). Non-blocking requests only record `blocking: false`. The final review lists pending ones for the plan (`§11.6`, `plan-execution R27.5.2`).
- **Notifications.** After a request is stored, if `notifications.push` is on and the permission is in `notifications.push_permissions`, the adapter's `notify(summary)` is called with a short text and no content (`requests R52.5`). A harness without `notify` ignores it. The list and dialogue are the only places a request is answered.
- **Dialogue.** If a session is active, the adapter opens the dialogue for each new request in order; closing it leaves the request pending (`requests R52.4`).

## §9 Audit log

Implements `verification R13`, `verification R13.1`, `configuration R25.1`.

- `audit/log.ts` appends one JSON line per decision or action in the format of `architecture/file-formats §10`: time, branch (`git branch --show-current`, or the short commit when detached), actor, command, arguments, permission, outcome (`done`, `refused`, `request-sent`, `cancelled`, `failed`), reason and for changes `old` and `new`. No file content and no test output are written (`verification R13`).
- Entries are produced in three places: the guard (every decision), the command runner (`done` or `failed` after the operation, `cancelled` on interrupt, and for every command it runs, reads included, because `verification R13` covers all actions), and the request code (`request` id). A guarded action therefore has at least two entries only when it ran after a request; the runner merges the guard and result for the same call into one line where it can (assumption).
- A failed append sets a flag read by the warnings collector and prints one warning at the end of the command; the action proceeds (`verification R13`). The writer never throws into the caller.
- **Retention** (`audit.retention`): at the start of each command that is not `audit`, entries older than the retention are dropped by rewriting through a temp file and rename, and one entry `audit prune` records how many and the oldest date kept (`verification R13.1`). `forever` skips it. Concurrent commands race harmlessly: the rewrite re-reads the file and keeps any line appended meanwhile (assumption: rewrite takes a `audit.lock` file created with `wx` and skips pruning if it exists).
- `specplane audit [--since <date>] [--branch <name>] [--actor <role>] [--json]` reads it. For an LLM the same read needs `info.retrieve` (`§12.1`). Lines that do not parse are skipped and counted in a warning.

## §10 Tests, results and implementation status

Implements `verification R36`, `verification R36.1`, `verification R36.2`, `verification R61`, `verification R61.1`, `verification R61.2`, `verification R61.3`, `verification R61.4`, `verification §2`, `verification §3`, `configuration R25`.

### §10.1 Declarations

`tests.ts` reads the labelled Test lines from the section index (`§4.2`). The ID of a test is `<section id>#T<n>` from its label (`architecture/file-formats §11.2`), never its position; a duplicate label within a section is a validation error and the section's tests are not run. A section whose effective declaration includes intelligent judgement has the verdict `<section id>#0`, kind `intelligent`. The effective declaration of a section is its own Test lines; a section with none inherits the declaration of the spec (`verification R36.1`). The spec's declaration is its preamble Test lines, if any (id `<spec id>#T<n>`, assumption), and a spec that declares neither judges its sections by intelligence. A spec's own result set is the union over its sections.

**Runnable definition (assumption).** A deterministic test can be run by the CLI only if the Test line is followed, before the next blank-line-separated paragraph, by a fenced block with the info string `specplane-test`:

```yaml
run: ["specplane", "validate", "--json"]   # argv array, no shell
cwd: .                                     # relative to the checkout, default "."
setup: [["sh", "scripts/make-fixture.sh"]] # optional argv list run first
expect:
  exit: 1
  stdout-contains: ["unresolved cite"]
```

The block is part of the section, so editing it is a content edit. A deterministic Test line with no block cannot be run by the CLI and is reported as `not run: no runnable definition`; an LLM in a harness may run it by following the prose and record the result as that LLM. Intelligent tests are never run by the CLI (`verification §2.1`).

### §10.2 Running

`specplane test run [<spec-id>[#section]] [--all]` and the harness action `test.run` call the same function.

1. Needs only `info.retrieve` (`verification §2.2`).
2. Reads the committed content at HEAD. To run against it, the runner creates a temporary checkout of HEAD with `git worktree add --detach <tmp>` under `<store>/tmp/`, runs each test there, and removes it (assumption: this makes "committed state" true when the working tree is dirty). If the working tree differs the output says the committed state was tested (`verification R36.2`, `verification §2.2`).
3. Each test starts its argv without a shell, with a clean environment plus `SPECPLANE_TEST=1`, a wall-clock limit of 120 seconds (assumption, `--timeout` overrides) and output captured. The `expect` keys are `exit`, `stdout-contains`, `stderr-contains`, `stdout-equals` (assumption). A failure summary names the failed expectation and the first lines of the difference.
4. The result per test is `passed`, `failed` or `not-run` (harness missing, no definition, interrupted). An interrupted run records nothing and the audit log gets `cancelled` (`verification §3`).
5. Output goes to the log (`§10.5`), not to the result.

### §10.3 Recording

`tests.record` appends one `test-result` record to the note on HEAD, the tested commit (`architecture/file-formats §11.1`, `§13`) after the guard returns `allow` for `test.record`:

- `test`, `test-kind`, `outcome`, `by` (the actor), `date`, `rid`, `at`, `fingerprint` (`specFingerprint` of that spec at that commit), `against` (fingerprints of the specs it was checked against: the specs it `covers` or `implements`), `summary`, optional `log`.
- Under `request-user` the test still runs and its outcome is shown; a request is created holding `{spec, test, outcome, summary, commit, fingerprint}`. On accept, the record is written only if HEAD is still the tested commit and its fingerprints still equal those in the request; otherwise nothing is recorded and the user is told why (`verification R61.2`).
- Under `deny` the outcome is shown with the note "not recorded".
- A summary that looks like a credential gives a warning but is recorded (`§6.2`).
- Recording writes a notes commit only and does not change status; the spec file is not touched, so it is not an edit (`architecture/file-formats §13.3`).
- Override: `specplane spec override test <id> <test> passed|failed|clear` needs `override.test` and appends a result record with `override: {by, date}` (`cli R17.2`, `architecture/file-formats §11.1`).

A result is **current** when its `fingerprint` and every `against` fingerprint equal the ones computed at HEAD now, else **outdated**; the effective result per test is the latest current one (`verification R61.1`, `verification §3`). Approval and mark-implemented use only current results: a current `failed` blocks them and names the test; outdated results count as none.

### §10.4 Implementation status

`implementation.ts` implements `specplane spec implement <id>` (also a harness action). Only architecture specs have implementation records (`architecture/file-formats §11.3`).

1. Needs `test.record` with mode `allow` for the actor, and for the `llm` role the setting `architecture.llm_may_mark_implemented` to be on (`verification R36.1`).
2. Takes `commit = HEAD`, noting when the working tree differs from it, and runs the checks at that commit: all deterministic tests (`§10.2`), plus an intelligent verdict (`<section id>#0`) only for every section whose effective declaration, own or inherited from the spec (`§10.1`), includes intelligent judgement. Intelligent verdicts exist only as current results recorded through `tests.record` by an LLM in a harness; from the CLI they are reported as `needs harness`, and the command ends with the status unchanged (`verification R36.1`).
3. Appends an `implementation` record `{status: implemented, fingerprint, by, date}` to the note on HEAD only when every test and section has a current `passed`.
4. A current `failed` refuses and names it (`verification R36`).
5. Reading status: `implemented` only if an `implementation` record applies by the rule of `architecture/file-formats §13.2` (fingerprint equals the HEAD fingerprint and, while its commit is reachable from HEAD, no later commit changed the fingerprint; this keeps "changed and changed back" unimplemented, `architecture/file-formats §11.3`); otherwise it is shown as unimplemented with the reason and nothing is removed (`verification R36.2`).

### §10.5 Logs

A test run writes `<log-id>.log` according to `tests.logs`: `local` to `<store>/logs/`, `git` to `<paths.test_logs>/` (`architecture/file-formats §6`) with a warning printed when selected and on each write, `off` none (`architecture/file-formats §11.4`, `verification R61.4`). Retention of local logs runs with audit retention at command start and is audited. Logs are text with a header (spec, test, commit, actor) and the captured output; the intelligent session text is supplied by the harness adapter when recording.

## §11 Plans

Implements `plans R28`, `plans R28.1`, `plans R29`, `plans R29.1`, `plans R29.2`, `plans R29.3`, `plans R30`, `plans R30.1`, `plans R69`, `plans §2`, `plans §2.1`, `plans §2.2`, `plans §3.1`, `plan-execution R27`, `plan-execution R27.1`, `plan-execution R27.1.1`, `plan-execution R27.2`, `plan-execution R27.2.1`, `plan-execution R27.3`, `plan-execution R27.4`, `plan-execution R27.6`, `plan-execution R31`, `plan-execution R31.1`, `plan-execution §2`, `plan-execution §3`.

### §11.1 Parse and validate

`plan/parse.ts` reads a plan folder (active or archived) per `architecture/file-formats §5`: PLAN.md frontmatter and body, step files, `progress.yaml`, handoff entries and gap entries. `plan/validate.ts` produces findings for: ID versus folder, steps contiguous from 01 with matching `step` and `plan` fields, `implements` and `context` cites resolving, the latest handoff outcome agreeing with `done`, gap IDs counting up, reference cycles, a missing referenced plan, and the outdated-reference warning: a plan's recorded commit for a spec differs from the latest commit that changed that spec on the current branch (`git log -1 --format=%H -- <path>`), naming plan, spec and both commits (`plans R29.3`). Project without plans: nothing (`plans R69`).

### §11.2 Status and next step

`plan/next.ts` computes, from `progress.yaml` and the step list, the **next step** (lowest-numbered step not in `done`) and its readiness. A step is **waiting** when it lists a spec in `implements` whose effective status at the plan branch HEAD is not `approved` (`plans R30.1`, `plan-execution R27`); the reply names the spec. A selection (next, N steps, all remaining) is validated: it must start at the next step and a waiting step ends the selection there; a selection starting later is denied naming the next step (`plan-execution R27`). Plan status shown to users is `progress.yaml` `status`, except that `in-progress` with no live run marker is reported `stopped` with reason `session ended unexpectedly` without rewriting the file (`§11.3`, `plans R29.1`). `plan list [--live]` reads the plan folder of the checkout the command runs in; `--live` reads each running plan's own checkout through `worktrees.json` and merges, with a path git no longer lists dropped (`architecture/repository-layout §3`).

### §11.3 Start, run marker, stop, resume

- **Start** (`plan start <id> [--target <branch>] [--force-deps <ids>]`; `plan.start` permission, `plan-execution R31.1`). Order: guard; load the plan from the current checkout; check start conditions when `plans.start_conditions` is on: the plan and every spec in its `implements` entries with `mode: implements` and its `references` are effectively approved at the target tip, naming each that is not (`plan-execution R27.6`); a referenced plan must be `completed` unless named in `--force-deps`, which the handoff records (assumption, as the feature spec); a reference cycle always refuses. Then: target is `--target`, else the current branch; record `target_branch` and `start_commit`; `git worktree add -b plan/<id> <path> <target-commit>` where `<path>` is from `architecture/repository-layout §3`; record the path in `worktrees.json`; run `plans.setup_command` in the new directory, and on failure remove the worktree and branch and fail with the command's output; write `progress.yaml` with `status: in-progress` in the new worktree and commit it (`chore(specplane): start <id>`, `architecture/file-formats §8`). The main checkout is untouched. Starting writes the first run marker.
- **Run marker.** While a session works, the adapter keeps `runs/<plan-id>.json` `{session, pid, heartbeat}` updated every minute and removes it on a clean end (assumption). A status read treats a marker whose heartbeat is older than five minutes, or with a dead pid on this machine, as no run. Assumption: before attempting the hard-stop progress commit, budget enforcement writes `{session, reason}` as `hardStop` on that run marker and emits a `plan budget-hard-stop` audit event naming the plan, resource and session. This records the budget decision, not proof that a live host session was terminated. Recovery requires that the marker, hard-stop context and plan progress name the same non-empty session; start and resume clear the context for a new run. A recovered hard stop is committed by a status read only when progress.yaml has no staged or unstaged edits; otherwise it is reported without rewriting the file.
- **Step finished** (`plan step-done <id> --step N --outcome done|partial`, harness action `plan.step-done`): requires a handoff entry for the step with the same outcome and all sections (`architecture/file-formats §5.5`); requires a commit on the plan branch since the step began (an entry-only commit is created if there is none, `plan-execution R27.4`); for `done` appends `N` to `done` and advances `current_step`; commits `progress.yaml`. `plan step-done` needs no permission of its own: running a step needs only the permissions of what the step does (`roles-and-permissions R50`, `plan-execution R27.1`), and the page defines no separate step permission, so the code must not add a `plan.step` permission. Claude Code's step command records the step itself and the agent never runs this directly (`AGENTS.md`); the function is the same.
- **Stop** (`plan stop <id> [--reason ...]`, harness `plan.softstop`): sets `status: stopped` with `stop {kind, reason, needs}` after the LLM wrote the handoff entry; commits. Kinds: `soft` (LLM or budget soft stop), `user`, `hard` (harness ended the session by force; written by the adapter, or by the next status read when it finds the marker stale after a budget hard stop was logged), `failure`. A soft stop by the LLM needs `plan.softstop` (allow in every default preset). A block is never turned into a skipped step.
- **Resume** (`plan resume <id>`; `plan.resume`). Not available for `completed` or `abandoned`. Re-creates the worktree from `plan/<id>` if gone (`git worktree add <path> plan/<id>`), clears `stop`, sets `in-progress`, commits, and returns a **resume context**: the plan's next step, handoff entries, any answers to requests that stopped it, and for a `hard` or `failure` stop or an unexpected end the session log pointer the adapter holds for `progress.yaml` `session`. After a soft stop the context has no session log (`plan-execution R27.2`). Start conditions are not rechecked. If `target_branch` no longer exists the plan stays stopped asking for a new target, set by `plan retarget <id> --target <branch>` (assumption).
- **Selection never skips**: resume continues at the first step not done.

### §11.4 Budgets

`budget.ts` stores per plan a list `{resource, soft, hard}` in the plan's `progress.yaml` `budget` field (`architecture/file-formats §5.4`; plan metadata, `plan-execution R27.1`), committed on the plan branch with `chore(specplane): budget <id>`, set by `plan budget <id> --resource <name> --soft <n> --hard <n>` under `plan.budget` (`plan-execution R27.1.1`). A resource is a name the adapter reports (tokens, `5h`, `weekly`); the adapter publishes `measurable(resource)`; a budget on an unmeasurable resource is refused with the reason (`harness R35.1`). During a run the adapter calls `evaluate(plan, usage)`: at soft it tells the LLM to bring the work to a safe point, commit and write the partial handoff, then calls `plan stop --kind soft --reason "soft stop at 80% of the weekly limit"`; at hard it ends the session and records `stop.kind: hard`. No budget means no check. Budgets never span plans. Usage readings are held by the adapter and not stored; the soft or hard stop that ended a run is the `stop` entry of `progress.yaml`.

### §11.5 Create and edit (LLM)

`plan.create` writes the folder from a template and commits it (`docs(<slug>): create plan`; `plan.edit` commits `docs(<slug>): edit plan`, `architecture/file-formats §8`): ID `<today>-<words>` (two to four lowercase words, `architecture/file-formats §5.1`), PLAN.md with no `status` field (a plan has no stored status, `architecture/file-formats §5.2`), an empty `progress.yaml` with `status: not-started`, and step files. Needs `plan.create`; `plan.edit` for later changes, including adding or removing steps. Editing a step that has started is refused except to later steps; deviations go in the handoff. Neither approves anything (`plan-execution R31`, `plan-execution R31.1`). Assumption: the core edit API takes plan-relative `{path, before, after}` changes, with null for an absent file; exact before text prevents a queued edit from overwriting later work. Only PLAN.md and step files are editable. Until the harness records a separate step-begun event, `current_step` is conservatively treated as started along with completed steps and steps with handoff entries; this can also freeze a next step merely preselected by step-done. Plan approval is the spec approval flow of `§5.3` applied to PLAN.md.

### §11.5.1 Parallel tasks

`plan/tasks.ts` reads the `## Tasks` list of a step file (top-level items, continuation lines joined; items inside code fences are ignored) and the `[parallel]` marker, and groups consecutive marked tasks (`groupTasks`). `planTasks` gives the groups, the setting `plans.parallelism` and the concurrency for the harness: the setting capped by the widest group when the adapter has the `subagents` capability, otherwise one, with a note that says why tasks run one after another (parallelism not available there, or the setting is one). `plan.next` returns this as `tasks` for the next step; the adapter is the one the harness names (`SPECPLANE_ADAPTER`, carried as `adapter` in the action context), and no adapter means no subagents are claimed. `plan/validate.ts` warns (rule `plans`) about a `[parallel]` task with no marked neighbour and about marked neighbours that name the same backticked path. All plan record writes stay with the session; subagents do not call `plan.*` actions. Because several subagents of one session may reach the plan record at the same moment, `plan.step-done` runs under `withStoreLockWait` (lock `plan-<id>` in the shared git directory, `repo/store.ts`): a second writer waits up to 15 seconds for a live holder and then fails with the ordinary lock error, and a lock whose PID is not yet written counts as held. After the first writer, the others find the step already recorded and are denied by the rule of `§11.3`. Budget accounting needs no per-task code: subagents draw on the same account windows the session adapter reads (`§11.4`, `§8`), so their usage reaches the same hard and soft stops. Subagents run in the session's own worktree; separate worktrees per task are not built.

### §11.6 Final review and finishing

- **Open.** When `done` covers every step, or on request, `plan review <id>` assembles: per step the handoff outcome and changes; open gap entries; unrun steps; pending requests whose `plan` is this plan; acceptance criteria from PLAN.md for the LLM to mark met or not with evidence (the CLI lists them and does not decide); referenced specs whose content changed on the target branch since `start_commit` (compare `specFingerprint` at `start_commit` and at the target tip, with the effective status at the tip) and, separately, specs changed on the plan branch (`plans R28.1`). The target tip seen is stored in `reviews/<plan-id>.json`. The plan stays `in-progress`.
- **Decide.** `plan finish <id> --complete | --back <reason>` needs `plan.complete` (`plan-execution R31.1`); under `request-user` a request goes to the user. `--back` sets `final_review {decision: back-in-progress, reason, by}` and leaves `in-progress`; steps may then be added. `--complete` sets `status: completed`, writes `final_review`, moves the plan folder to `<plans.dir>/archive/<id>/` and commits both as the plan branch's last commit (`chore(specplane): finish <id>`), so a merge brings the archived plan (`plans R28`, `plans R29.2`). Completion is a declaration; it is not conditional on tests.
- **Merge** is separate: `plan merge <id> --pr | --local` (also the harness action `plan.merge`, guarded by `plan.complete`, `architecture/file-formats §7.1`). `--pr` pushes nothing itself; it runs `gh pr create` when `gh` is available and otherwise prints the branch to open (`§1`). `--local` runs only in a checkout of the target branch without uncommitted changes and refuses when the target tip differs from `reviews/<plan-id>.json` until the review is shown again; it runs `git merge --no-ff plan/<id>` and on conflict stops, runs `git merge --abort`, and shows the conflicting paths. Specplane never resolves conflicts. After a merge it removes the worktree (refused if dirty unless `--force`) and deletes the branch (`plan-execution §2`, `plan-execution R27`).

### §11.7 Abandon and delete

`plan abandon <id>` (`plan.abandon`): stop the run first, then, in the checkout where the command was run, bring the plan folder from the plan branch (`git checkout plan/<id> -- <plan dir>`), set `status: abandoned`, move the folder to the archive and commit; remove the worktree unless it has uncommitted changes (then ask, or `--force`); keep the branch (`plan-execution §3`). `plan delete <id>` (`plan.delete`): stop the run, remove the folder and commit, remove the worktree under the same rule; references to it are reported missing by validation (`plans R29.2`). Both are audited.

## §12 Harness-facing actions, steering and retrieval

Implements `harness R14`, `harness R18`, `harness R19`, `harness R19.1`, `harness R19.2`, `harness R20`, `harness R20.1`, `harness R26`, `harness R26.1`, `harness R26.2`, `harness R34`, `harness R35`, `harness R35.1`, `harness R47`, `harness §2`, `steering R51`, `steering R59`, `steering R59.1`, `steering R22`, `steering R23`, `configuration R54`.

### §12.1 Actions

`harness/actions.ts` holds a registry `{id, permissions, input schema, handler}`; each handler calls the same core function as the CLI with `Actor {role: llm}` and returns a result object plus the instruction text the adapter attaches (`§12.3`). The set for the first release: `spec.retrieve`, `spec.list`, `spec.create`, `spec.edit`, `spec.delete`, `spec.approve`, `spec.meta.read`, `spec.review-context`, `spec.implement`, `validate`, `warnings`, `coverage`, `test.run`, `test.record`, `config.get`, `config.set`, `permissions.docs`, `docs.search`, `docs.essentials`, `audit.read`, `request.send`, `plan.create`, `plan.edit`, `plan.list`, `plan.next`, `plan.step-done`, `plan.softstop`, `plan.start`, `plan.resume`, `plan.abandon`, `plan.delete`, `plan.budget`, `plan.review`, `plan.finish`, `plan.merge` (guarded by `plan.complete`, assumption), `decision.add`, `decision.retrieve`, `decision.edit`, `decision.delete` (each guarded by the permission of the same name; they refuse while `decisions.enabled` is off; `decision.retrieve` is a read action under its own permission, `later-releases R37.1`), `role.list` and `role.show` (read actions under `info.retrieve`: the roles with their levels and approval state, and the LLM role rules; changing them is for people through the CLI, `§7.7`), `warnings.report` (no permission, adds a warning for the current session only, `§6.1`). Read-only actions need `info.retrieve` (viewing, review, validate, warnings, coverage, test runs, audit, `plan.list`; they have no permissions of their own, `harness R26.2`). Spec writes need `spec.create|edit|delete.<type>`; approval `spec.approve`; plan flows `§11`. There is no `request.accept` or `request.decline` and no `role.switch` action (`§8`, `§7.1`). Authorship: `spec.create` and `spec.edit` append the LLM as author with a contribution when `authorship.record_llm` is on, using the model the adapter reports and `unknown` otherwise; they never add a human (`harness R19.1`, `specifications R10`).

**Active command (`harness R38`).** `harness/active-command.ts` stores the command in the local store at `sessions/<session-id>.command.json`, separate from instruction delivery proofs. The user-command runner and command-target steering entry use `SPECPLANE_SESSION`; an adapter-provided runtime command also initializes it. Direct model workflows call `command.begin` with a known command name; it delivers the existing command instructions and updates only session control state, with no new permission. Every MCP action reads the current command, so an already-running server observes transitions and compaction does not clear the restriction. The next command replaces it; new sessions use distinct IDs. While it is `spec-review`, dispatch refuses write actions before permission requests or handlers run, except `decision.add`, `request.send` for `decision add`, and requests for genuine reads. `test.run` is also refused because it executes project code and records results despite using the read permission. Reads retain their permissions. Audit and instruction bookkeeping continue; no review findings are persisted.

**LLM identity.** The adapter's environment gives the server `SPECPLANE_SESSION`, `SPECPLANE_MODEL`, `SPECPLANE_DELEGATED_BY`, `SPECPLANE_ADAPTER` and, for the LLM role rules (`roles-and-permissions R44.1`), `SPECPLANE_PROVIDER` (default `anthropic` for the Claude adapter and `openai` for the Codex one), `SPECPLANE_AGENT_TYPE` and `SPECPLANE_SUBAGENT`; they are never tool input. The actor's role is resolved on every call (`§7.1`). All callers of a Claude Code session share one server process, so the subagent comes from a per-call record. The Claude pre-tool hook `specplane-caller.sh` (matcher `mcp__specplane__.*`) writes `<git-common-dir>/specplane/callers/<tool_use_id>.json` with `{agent_type, agent_id, at}` when the hook input has `agent_id` or `agent_type`, refusing an ID outside `^[A-Za-z0-9_-]{1,128}$`, and never decides a call. The MCP request carries the same ID in `params._meta["claudecode/toolUseId"]`; `tools/call` (`harness/caller.ts`) reads and deletes the record, removes records older than 24 hours, and passes the caller to `runtime.call`. Per-call factors are the session's, overridden by the record: `agent_type` is the record's, and `subagent` and `delegated` apply when it has an `agent_id`. The audit actor shows `agentType`, `agentId` and `delegatedBy` (the session). Identity never comes from tool input; a call without a record keeps the session's factors. The session server of `§12.8` is a second route: it takes the caller from the Claude Code engine and needs no record file. Codex's hook input names no agent, so Codex has none of this (capability `subagent-identity`, `§12.6`); `validate` warns when an approved rule states `subagent`, `agent_type` or `delegated` and the installed harness lacks it.

`spec.edit` accepts either replacement text of a section or a whole-file replacement, applies it, and when it changes content on an approved spec writes only the content, the review state following from the new fingerprint (`§5.4`); under `request-user` it stores a patch (`§8`) and writes nothing. `spec.create` writes frontmatter with the chosen ID, title, authors and cites, and no status. The harness never accepts a `status` or `approval` key or any other legacy record key from the LLM in any write: such keys in supplied text are rejected (`harness R20`, `roles-and-permissions R57`).

**Channel (decision).** The harness integration exposes the actions to the LLM as tools of a Specplane MCP server that the harness starts (stdio), one tool per action rather than a dispatch tool, so each tool carries its own input schema and permission. The server is part of the CLI package but runs the actions in-process: the permission check of `§7.3` runs inside the CLI process on every call, never in the harness. Each harness architecture spec names how the server is declared: Claude Code through the mod and session server of `§12.8` for the plugin, and through the `specplane` entry of the project's `.mcp.json` that `init --harness claude` writes for the route without the plugin, Codex through an MCP server registered in its configuration; each names the channel in its own architecture spec. A harness that cannot host an MCP server reports the capability as missing (`§12.6`). Where a harness offers a mod that registers tools itself, a second channel exists: the session server of `§12.8`. It serves the same registry through the same runtime, so permission checks and results do not differ by channel; the harness architecture spec says which channel an install uses.

### §12.2 User commands

Harness commands typed by the person (`/requests`, approval by ID, status panes, viewing) are implemented by the adapter running the matching core function in the user-command runner with role `standard-user` and no model call; with arguments it passes the arguments and the command's instructions to the LLM (`harness R18`). A command typed with no arguments never makes a model call: it shows its own result, for `plan-step` the plan's next step and how to run it (`architecture/agent-skills §7.5`). `harness R21` viewing (`spec-view`, implemented in `commands/spec-view.ts`) is a user command built on the spec view of `spec show` and the last-approval commit of the notes store, with the diff made by the routine of `§8`; `harness R38` review (`spec-review`) is a model command with no CLI of its own, built on `spec.retrieve` and `spec.review-context` (`§12.1`). The runner is a small process the harness hook invokes (`specplane harness run <command> [args]`, assumption); it is not a general route to the CLI and refuses commands outside the harness command list. With `--adapter <name>` (or, without it, the `SPECPLANE_ADAPTER` environment variable) it also checks the capability the command depends on (today `spec-view` needs `viewing`) and refuses by name when that adapter lacks it, instead of running the command anyway (`harness R35.1`; `requireCapability` in `harness/adapter.ts`).

### §12.3 Instruction delivery

`instructions.ts` implements `harness R14`. Each command and each permission has an instruction text (default: its documentation, `steering R22`, replaced by `harness.instructions.<command>` when configured). Replacement changes text only; limits in `§7.3` still apply (`harness R14`).

- Per session, `sessions/<session-id>.json` lists `{key, hash}` of instruction texts already delivered and the compaction epoch. `deliver(session, key)` returns the text unless the same hash was delivered in the current epoch.
- A harness that reports compaction (a hook) calls `epoch++`, which makes everything deliverable again. An adapter that cannot report its context state never marks anything delivered, so instructions are sent again when unsure (`harness R14`).
- A harness that can load instructions on demand (skills) gets a pointer to the skill instead of text; the behaviour is the same.
- If the adapter cannot deliver at a command, it delivers at the nearest earlier point, usually session start, and returns a notice that the user sees (`harness R35.1`).

### §12.4 Steering

`steering.ts` generates steering from templates in `assets/steering/` filled with data, never free text from the model: the actor's role, the mode of each permission under the active preset, the commands, and the five cases of `steering R59` (request-user, deny, user-run command, allow, plan block) plus the blocking-request guidance and the layer rules. Output per role: a short always-loaded part (role, limits, no-bypass, the rule that checks and not steering decide) and per-permission and per-command parts delivered with the command (`steering R51`). Custom steering from `steering.custom` is appended after the generated text of the same permission or command, a general item before a specific one and labelled so the specific one wins on conflict, and never replaces the no-bypass text (`steering R59.1`). `specplane steering <command|permission>` prints exactly what an LLM receives (`steering R59.1`, `configuration R54`).

Every generated text carries a stamp `sha256(preset id + preset version + custom steering + Specplane version)`. Delivered files (`§12.7`) embed it; the warnings collector compares it to the computed stamp and warns when missing or different (`steering R59`). Steering is regenerated, and installed files rewritten when owned, when `permissions.preset` or `steering.custom` changes (`§3.2`); if regeneration fails the old text is replaced by a short notice that it cannot be trusted and a warning is raised, never left claiming more than the role has.

### §12.5 Retrieval and documentation

- `retrieve.ts` implements `harness R26`: for each named spec, return the spec text and, when `harness.retrieval_include_references` or the call asks, every part its `covers`, `implements` and `references` cites resolve to, each with its source cite, deduplicated, and only that part (the section and its subsections). A cite that does not resolve is returned as `not found`. Specs and parts that are effectively `awaiting-review` are marked. The request may name several specs. Spec text is read from the working tree (the LLM works on it), status from HEAD; a note says when they differ (assumption). It is read-only and needs `info.retrieve` (`harness R26.1`, `harness R26.2`).
- Documentation (`steering R22`, `steering R23`): the user documentation is written in the repository's `docs/user/` (`architecture/repository-layout §1`) and copied by `build-docs` to markdown under `assets/docs/` with a manifest. The manifest lists the required topics: the specification, plan and configuration formats, every command, every configuration key with its default, every permission, and five mandatory notes: group approval (`cli R16`), a role with `allow` approving without confirmation (`harness R20.1`), the audit retention default (`verification R13.1`), the warning about private information in logs kept in git (`verification R61.4`), and which commands and capabilities each harness supports (`harness R35.1`). **Test T1 (assumption, deterministic):** the build fails when a catalog permission, a command or a configuration key is missing from the documentation, shown without its default, or when a mandatory note is missing (`steering R22`). `build-ai-docs` generates the AI-facing form deterministically from it: an always-loaded essentials file under a size limit (checked in tests) and a searchable remainder. `specplane docs [topic]` and `docs search` read the bundle offline; `docs.search` is the harness action. Generated files are never hand-edited and are rebuilt by the package build.
- `specplane permissions` output (`§7.4`) is shared by CLI and harness.

### §12.6 Setup and staleness

`harness/install.ts` installs the files of one named harness (`harness R34`: the user names it) into the places of `architecture/repository-layout §5`: owned files are written with a version header; standing instructions go to an owned file, or to the marked block in a shared file that is created if absent and changed only between its markers (`harness §2`). The standing text is fixed and short: Specplane is in use, read `.specplane/config.yaml` and resolve paths from it, look up steering (`harness §2`). A block that is unbalanced stops setup with an error. `harness` findings in validation: installed file missing, version header older than the CLI, stamp mismatch, marker problems. Two harnesses share one block (`harness §3`). Each adapter implements `capabilities()` (instructions on demand, push, subagents, viewing, usage measurement, command blocking, session opening, bypass guards, strict mode and `subagent-identity`, "telling subagents apart for LLM role rules": Claude claims it when `.claude/hooks/specplane-caller.sh` is installed, or, when the session server of `§12.8` serves the session, only when the host version matched (the caller hook then does not count); Codex never). The Claude installer writes every hook of its templates, including the caller hook and its `PreToolUse` entry in the settings. The `harness` rule also warns when an approved LLM role rule states `subagent`, `agent_type` or `delegated` and the installed harness lacks the capability; setup and every action state which are missing and refuse rather than substitute (`harness R35.1`).

### §12.7 Keeping the LLM off the CLI

Enforcement of `harness R47` has two parts. Core exports `isSpecplaneCommand(shellText)`, which splits the text into simple commands (handling `;`, `&&`, `|`, subshells, `env` prefixes, `sh -c`, `npx`, `bunx` and path-qualified `specplane`) and reports a match. Each adapter installs a pre-tool hook that calls it for shell tool calls and denies a match with a message pointing to the harness actions; a harness without such a hook states that it cannot block (`harness R35.1`). The check is best effort; stronger guards (environment markers, headless detection) are later release (`§15`).

### §12.8 Session server

Implements `harness R19`, `harness R35.1`, `roles-and-permissions R44.1`, `roles-and-permissions R58`.

The session server is the second action channel (`§12.1`). A harness mod starts it once per session and forwards each tool call to it; it serves the same action registry as the MCP server (`harness/actions.ts`) through one `createActionRuntime` per session, and calls `runtime.call(action, input, caller)`. The Claude plugin uses it (the Claude architecture spec, section 10; the MCP server stays for harnesses without a mod).

- **Entry and actors.** A core entry (`harness/session-server-main.ts`, name an assumption) that the mod starts as a child process at session start, passing the session ID, the project directory and its own PID as arguments (assumption). Every actor it serves is an LLM actor. The mod starts the child with `SPECPLANE_ACTOR=mod` in the child's environment. The core starts only when the value is exactly `mod`, and refuses otherwise (a host that was itself started by the plan launcher carries `SPECPLANE_ACTOR=llm`, `§7.8`, so the marker alone cannot tell the mod's child from another). Once started it marks its own environment as an LLM's (`SPECPLANE_ACTOR=llm`), so every process it starts is marked. This start check, `marker_protect` (which refuses a shell command that sets the variable) and a refusal by the bypass-guard hook of shell commands that name the session server entry are text matching and best effort: a shell command that got past them could start its own core and claim an identity.
- **Socket and secret.** The core chooses the socket path, never the mod. The directory is `$XDG_RUNTIME_DIR/specplane` when that variable is set, otherwise a per-user directory under the system temporary directory; it is created or checked with mode `0700` and owned by the user, and the socket has mode `0600`. The path is at most 100 bytes (the Unix socket limit is about 104), so the file name is short and derived from the session ID (not random), which lets the leftover-socket rule below apply; when the directory would make it longer, the core fails with a message. The core generates a random per-session secret. Its only stdout output is one readiness line, a JSON object with the socket path, the secret, the PID and the action list (name, description, input schema); everything else goes to stderr. Every request carries the secret in the header `x-specplane-secret`; a request without it, or with another value, is refused and no action runs. The secret keeps a shell command from using the session's own core; it does not stop a core that the shell command started itself.
- **Requests.** `POST /call` with the action name, the input, the caller and the model. The caller is what the engine gave the mod: the agent ID (present only for a subagent), the agent type (from the host's agent list for that ID) and the tool use ID. The model is the session's model as the mod reads it. The core never takes identity from the input: it builds the actor from the caller, the model and the session as `§12.1` does (`agent_type`, `subagent` and `delegated` apply when there is an agent ID; the provider is `anthropic`; `roles-and-permissions R44.1`), and records the model in the audit actor, which the MCP route does not do unless `SPECPLANE_MODEL` is set in the server's environment (`harness/mcp-run.ts`; the plugin manifest does not set it, so that route audits `unknown`). The reply carries the same text an MCP tool result would carry, with the error flag; the mod returns it as a string, because the host rejects any other result shape.
- **Long calls.** The host gives a forwarded request 30000 ms and has no option to raise it. The core therefore answers every request within 25 seconds. When the action is still running it answers `pending` with a job ID, and the mod sends `POST /poll` with that ID, which waits up to 25 seconds again, until the answer is `done`. The result of a job is kept until it is delivered or the core exits. The action keeps running if the mod stops asking.
- **Output.** After the readiness line the core writes nothing to stdout, and the mod keeps draining the spawn stream: an undrained stream stalls the child.
- **Lifecycle.** At session end the mod sends `POST /shutdown`; the core removes its socket and exits. The core also exits when its parent process is gone, which covers a killed host (the host's SIGKILL leaves the child and its socket behind). At start the core removes a socket path left by an earlier process, and other sockets in its directory, only when nothing answers on them. After shutdown is requested the core refuses new calls and polls and runs nothing for them; calls already running finish first, bounded by the 25 seconds. The host does not restart a child that exited. When the connection itself fails (no socket, connection refused), so the request was not sent, the mod starts a new core and sends the call again, once. When a request was sent and no answer came within the host's limit, the mod reports the failure, does not retry and does not start another core. There is at most one core per session. When the new core does not start, the call is denied with a message that names the cause (core exited, socket missing, secret refused). A job that was pending in the old core is lost and reported as such, not run again. A resumed session starts a new core.
- **Host version.** The plugin records the host version it was built and checked against (`2.1.322`). At load the mod compares it with the running version. On a mismatch it still serves the tools and warns, and the adapter reports the `subagent-identity` capability as missing (`harness R35.1`), because identity depends on engine behaviour that was checked only on the recorded version. When a session server serves the session, the capability is decided only by this match and the installed caller hook does not count; without a session server the caller-hook rule of `§12.6` stays. The caller hook's matcher also matches the mod's tools, and the records it writes in a plugin session are not read and expire as `§12.1` describes. The host's mod API is early access and may change between versions. The mod passes the running version and the checked version to the core as start arguments, and the core records the match in the session's record in the local store, from which the adapter reads it (assumption).
- **Guards.** `marker_protect` covers the identity variables, so a shell command cannot set or unset `SPECPLANE_*` to affect a server (`§7.8`). The secret is not an authorisation by itself; it only keeps other local processes from using the identity of the engine's caller.
- **Evidence.** A probe server, not the production core, was run live on Claude Code 2.1.322 in headless sessions only (`harnesses/claude/host-evidence/2.1.322-socket-probe/live-results.txt`): the socket route works from the main agent and from a subagent; the agent ID is present only for a subagent; a tool result must be a string; an undrained spawn stream stalls the child; the 30000 ms limit is the only one seen and no way to raise it is known from the 2.1.312 declarations; the host does not restart an exited child; after SIGTERM of the host the child and socket were gone (how was not observed); SIGKILL of the host leaves both. The secret header is a design choice that the probe did not test. Not verified: interactive sessions, Windows, and a compacted or resumed session.

## §13 Human commands

Implements `cli R16`, `cli R16.1`, `cli R17`, `cli R17.1`, `cli R17.2`, `cli R33`, `cli R33.1`, `configuration R25`, `verification R12`, `verification R13`, `verification R24`, `verification R64`.

### §13.1 Command list

| Command | Does | Permission |
|---------|------|------------|
| `init --harness <name>` | Create `.specplane/config.yaml` if asked, set the notes fetch refspec (`§5.6`), install the harness files (`§12.6`) | `config.change` for the file |
| `validate [<id>...] [--json]` | `§6.1` | `info.retrieve` |
| `warnings [<id>]`, `coverage [--uncovered]` | `§6.3`, `§6.4` | `info.retrieve` |
| `spec list`, `spec show <id>` | Effective status, authors, results, implementation (from the notes store) | `info.retrieve` |
| `spec approve <id>... [--yes] [--ref <branch>]` | `§5.3`; writes a record only | `spec.approve` |
| `spec meta get <id>`, `spec meta set <id> <field> <value>` | `§13.2` | `meta.read`, `meta.write[.piece]` |
| `spec override status\|approver\|approval-commit\|test ...` | `§13.2` | `override.*` |
| `spec reopen <id>`, `spec implement <id>` | `§5.4`, `§10.4` | `spec.edit.<type>`, `test.record` |
| `migrate status [--dry-run]` | `§5.7` | `config.change` |
| `sync [<remote>]` | `§5.6` | `info.retrieve` |
| `test run [<id>] [--all]` | `§10.2` | `info.retrieve` |
| `config get [<key>]`, `config set\|unset <key> [<value>]` | `§3.2` | `config.change` for writes |
| `permissions [<id>]`, `steering <command\|permission>` | `§7.4`, `§12.4` | none |
| `role show`, `role switch <role>` | `§7.1` | none |
| `requests [list\|show <id>\|accept <id>\|decline <id>]` | `§8` | permission of the requested action |
| `audit` | `§9` | `info.retrieve` |
| `plan meta get <id>`, `plan meta set <id> <field> <value>` | `§13.5` | `plan.meta.read`, `plan.meta.write[.piece]` |
| `plan list\|show\|next\|start\|stop\|resume\|review\|finish\|merge\|abandon\|delete\|budget\|retarget` (assumption, below) | `§11` | the plan permissions, `info.retrieve` for the read-only ones |
| `docs [topic]`, `docs search <text>` | `§12.5` | none |
| `check ...` | `§14` | none |

The permission column names the permission that guards the command; Standard User holds all of these, and a read-only command is checked against `info.retrieve` like any other (`§7.3`). Spec content is edited in an editor, not by a command. **Assumption:** the feature specs say plans are managed through the harness (`plan-execution R31`) and give the CLI only plan metadata (`cli R33`, `§13.5`); the human plan commands above (`start`, `stop`, `resume`, `review`, `finish`, `merge --pr|--local`, `abandon`, `delete`, `budget`) are an addition so a person without a harness can run the same functions, and `plan retarget <id> --target <branch>` and `--force-deps` on `start` are assumptions with no counterpart in the feature specs. Every command accepts `--json`, and `--dry-run` where it writes: a dry run runs the guard and all checks and prints the writes it would do (assumption).

### §13.2 Metadata

`metadata.ts` reads and writes the author-written frontmatter fields of a spec through the YAML document (`title`, `authors`, `covers`, `implements`, `references`), with the permission per piece mapped to `meta.write.<piece>` (`cli R17.1`). Status, approver and test results are not frontmatter; they are records, and their overrides map to `override.*` and append `override` or `test-result` records carrying the mark of `architecture/file-formats §2.4`. `override status approved|awaiting-review`, `override approver` and `override approval-commit` append `override` records with `target` and `value` (`architecture/file-formats §2.4`); `override status approved` computes the fingerprints from the HEAD content so later edits reopen it (`cli R17.2`). A `meta get` shows the records' fields (approver, date) read from the store. All writes record `old` and `new` in the audit log (`cli R17`). Metadata writes do not change body or review state (`specifications R11.3`): `title`, `covers`, `implements` and `references` are outside the fingerprint (`architecture/file-formats §4.2`), so correcting them leaves an approved spec approved; a field that is not one of those in `architecture/file-formats §2.1`, including a legacy record key, is refused. `plan meta` commands use the same code on PLAN.md (later release).

### §13.5 Plan metadata

`plan/meta.ts` backs `plan meta get <id> [--json]` and `plan meta set <id> <field> <value>` (`cli R33`, `cli R33.1`). The plan is read through `requirePlan`, so a started plan is read and changed in its own worktree, and an archived plan can be read.

- **Get** is guarded by `plan.meta.read`. It returns the author-written fields of PLAN.md (`title`, `authors`, `implements`, `references`), the effective approval (`§11.2`), the execution status with its stop reason, `current_step`, `done`, `budget`, `branch`, `target_branch` and `session` from `progress.yaml`. Execution fields are shown, never settable.
- **Set** takes one of `title`, `authors`, `references`, `implements` and is guarded by `[plan.meta.write.<piece>, plan.meta.write]`, the more permissive of the two (`cli R17.1`). Any other field, including `status` and every progress field, is refused naming the plan commands that change it; plans have no protected override in this release (`cli R33.1`). Values parse as for specs (`§13.2`): `authors` items are `human:<name>` or `llm:<model>` with an optional `|<contribution>`; `references` items must be valid cites that resolve; `implements` items are `<spec>` or `writes:<spec>`, each spec must exist, and the recorded `commit` of an unchanged `implements` entry is kept (a new one takes the spec's latest commit). An empty value clears a list.
- **Write.** The key is edited in PLAN.md with the frontmatter editor and committed alone on the plan's branch: `docs(<slug>): set <piece>`, workflow `plan-meta`. It is refused for an archived, completed or abandoned plan, and when PLAN.md has uncommitted changes (the commit would absorb them). Because the `plan-v1` fingerprint keeps `title`, `references` and `implements` (`architecture/file-formats §5.2`), changing those makes the plan Awaiting Review again; `authors` does not.
- **Audit.** One entry per call with the permission used and the old and new values, or `failed` with the reason (`cli R17`). The action can be requested (`request-user`): accepting it runs the same function with the stored `id`, `field` and `value` (`§8`).

### §13.3 Output and errors

- Each command returns `{ok, data, findings, warnings}`; `text.ts` prints a short human form (what happened, then details), `json.ts` prints the object. Auto warn adds its line or field (`§6.3`).
- Exit status (assumption: the feature specs fix no exit codes beyond `verification R12`'s pass or fail): 0 success; 1 validation errors or a refused action; 2 usage error; 3 not a git repository or other environment error; 4 internal error. A held action (request sent) exits 0 and says so.
- Error classes in `errors.ts`: `UsageError`, `NotARepoError`, `GitError`, `FormatError` (carries findings), `PermissionError` (names the permission), `PreconditionError` (lists every reason), `RequestStateError`. Messages state what happened, where, and what to do next.

### §13.4 What is committed

Assumption: the page does not say which Specplane writes are committed, but under `specifications R40` an uncommitted change has no effect, so the rule is explicit.

- **Notes commit by the command**: `spec approve`, `spec reopen`, `spec override ...`, `test record` and `spec implement` append records to the note on HEAD and commit them on `refs/notes/specplane` only, never on the branch (`architecture/file-formats §13.3`). They need no clean working tree, have no `--no-commit` and use no commit message workflow; the notes commit message is `specplane: <verb> <id>` (assumption). `spec meta set` of an author-written field is a metadata-only branch commit with the workflow and message of `architecture/file-formats §8`, staged by path and never including other files; `--no-commit` leaves it staged. The plan commands of `§11` that already say they commit (`start`, `step-done`, `stop`, `resume`, `budget`, `retarget`, `finish`, `abandon`, `delete`, `plan.create`, `plan.edit`) are branch commits as before. If the spec file has other uncommitted changes than the keys `meta set` wrote, it writes them but does not commit, and says that nothing takes effect until the file is committed. `migrate status` makes one branch commit (`§5.7`).
- **Left in the working tree**, because they are the person's or the LLM's own edits: `spec.create`, `spec.edit` (a content edit writes only content, `§5.4`) and `config set`. Configuration is read from the file committed at HEAD (`§3.2`, `specifications R40`), so a `config set` takes effect only once the person commits it, like spec content. The result text says "written, not committed".
- A commit under a request is made on accept, by the accepting person's command.

## §14 Pre-commit and CI checks

Implements `verification R12`, `verification R32`, `verification R36.3`, `configuration R25`.

### §14.1 CI

The reference CLI's own test wrapper clears inherited Specplane actor, agent, session and adapter environment variables and Claude detection markers before either test runner (including fallback). Tests that need a harness identity set it explicitly; starting the suite from an LLM shell must not change CLI test permissions.

The earlier generated-index job no longer exists. The CI recipe is a documented command, not a generated workflow: run `specplane validate --json` on the checked-out commit; a non-zero exit fails the job. It reads committed content, needs no permission, no local store and no harness, and writes nothing. `specplane test run --all` may be added by a project; the `deterministic` runnable tests execute in the same temporary checkout and the job fails on `failed`. Neither records results in CI (no role records; assumption).

### §14.2 Pre-commit hooks

- `specplane check requirement-ids --staged` (setting `pre_commit.duplicate_requirement_ids`, `verification R32`): parses requirement files from the index (`git show :<path>`), reports duplicate IDs naming both places, exits 1 on any; it runs nothing else.
- `specplane check tests --staged` (setting `pre_commit.tests`, `verification R36.3`): when anything is staged, selects every architecture spec that declares deterministic tests (not only those whose files are staged, so a code-only commit that breaks a spec's tests is blocked too), exports the index to a temporary directory under `<store>/tmp/` (`git checkout-index --prefix`), runs their deterministic tests there, and exits 1 naming spec and test; never runs intelligent tests, never records results or sets implementation.
- **Install and remove.** `hooks.ts` manages sections in the file at `git rev-parse --git-path hooks/pre-commit`, bounded by `# specplane:begin <check>` and `# specplane:end <check>`; the file is created executable if absent. Turning a setting on inserts its section; off removes only that section and deletes the file if only the shebang remains; other lines are untouched (`verification R32`). `config set` applies it (`§3.2`); validation warns when a setting is on and its section is missing; a person may delete a section by hand without affecting others.

## §15 Later releases

Implements `harness R21.1`, `harness R38.1`, `later-releases R37.1`, `later-releases R39.1`, `later-releases R39.2`, `later-releases R39.3`, `later-releases R39.4`, `roles-and-permissions R43`, `roles-and-permissions R49`, `roles-and-permissions R55.1`, `roles-and-permissions R58`, `later-releases R37`, `later-releases R39`, `later-releases R66`, `plan-execution R31.2`, `harness R21`, `harness R38`.

Not built in the first release; each has a defined attachment point:

- **Custom roles, management levels, role mapping, LLM role rules** (`roles-and-permissions R43`, `roles-and-permissions R49`, `roles-and-permissions R48`, `roles-and-permissions R60`): built (`§7.7`).
- **Strict mode** (`roles-and-permissions R55.1`): built (`§15.1`). **Bypass guards** (`roles-and-permissions R58`) are built (`§7.8`): the environment marker read by actor resolution, and the Claude bypass-guard hook.
- **Decision records, subprojects, migration** (`later-releases R37`, `later-releases R39`, `later-releases R66`): decision records are built: the `decisions/` module (`decisions.ts`: format, search, guarded writes with requests, approval through `spec.approve` by ID, status from the notes store; format in `§14` of `file-formats`), the `decision` CLI group (`commands/decision-cli.ts`), the four harness actions (`§12.1`), the request actions `decision add|edit|delete` and the `decisions` validation rule, all behind `decisions.enabled`; a project registry behind `subprojects` extending the resolver of `§4.3` (built: `Project.subprojects`, `resolveCite` resolves by project name, validation runs the cite, requirement and format families per project; spec IDs of a subproject are qualified `<name>:<layer>/<slug>`, and status, notes, test and implementation records and coverage use `allSpecs`, `findDoc` and `projectOf` over the root and its subprojects, `§12.4` of `file-formats`); the migration command is built as a harness command and instruction (`§12.3`, agent-skills section 7.11): it has no CLI of its own and adds no action; the LLM writes through the existing `spec.create.*` actions.
- **Viewing command** (`harness R21`): `spec-view`, an adapter command run by the user-command runner (`§12.2`). **Review command** (`harness R38`, built): the harness command `spec-review` on `spec.retrieve` and `spec.review-context`, with the session restriction entered through `command.begin` (`architecture/agent-skills §7.12`).
- The pre-commit checks of `§14.2` (built; kept in this list only for history).

### §15.1 Strict mode

Implements `roles-and-permissions R55.1`, `verification R32`.

- **Settings.** `strict_mode.enabled` (default off) and `strict_mode.<measure>` for `edit_block`, `git_commit_guard` and `os_permissions` (`perm/strict.ts`, the same dynamic-map kind as `bypass_guards`). A measure is in force when strict mode is enabled and the measure is not stated off. The core reads the committed configuration (`§3.2`); the Claude hook reads the working-tree file, like `§7.8`. The `config` rule warns for a name that is no measure and for a measure on while strict mode is off; the `strict` validation rule (`verify/rules/strict.ts`, warnings only) reports a measure in force that the installation cannot carry out: a Claude installation whose guard hook does not mention strict mode, a Codex installation (no pre-tool hook), no harness at all, a missing pre-commit section, files left open.
- **`edit_block` (harness).** In the Claude guard hook `specplane-bypass-guard.sh` (`§7.8`): file-tool writes and shell writes (redirect, `tee`, `sed -i`, `perl -i`, `mv`, `rm`, `cp` onto, `dd of=`, `git checkout`/`restore`/`apply`/`rm`/`mv`/`stash` naming the folder) to the folders from `paths.requirements`, `paths.features`, `paths.architecture`, the subprojects, `.specplane/decisions` and `.specplane/roles` are denied with a message that points to the actions. The hook queries the read-only `harness guard-config` JSON endpoint once per invocation for all protected folders and strict-mode and bypass-guard switches. This uses the core configuration parser and path normalization on the working-tree file, including block/flow YAML, quoted keys and values, comments and subprojects. Unavailable core/JSON support, an invalid response or malformed protection settings block file edits and shell calls rather than guessing defaults; Read tools remain available. Specplane's own writes go through the core and the MCP server, which the hook does not see.
- **`git_commit_guard` (git).** `strict` is a section of the managed pre-commit hook (`§14.2`, `hooks.ts`, check name `strict`, no `pre_commit.*` setting of its own): `config set strict_mode.enabled|git_commit_guard` installs or removes it (`config-effects.ts`). `specplane check strict --staged` (`commands/check.ts`, needs no permission) does nothing unless the measure is in force and `cliActor` is an LLM actor (the process carries the marker, `§7.8`); it then reads `git diff --cached --name-status`, maps each staged path to the permission a direct change would have needed (`spec.create|edit|delete.<layer>` by folder including subprojects, `decision.add|edit|delete`, `config.change`, `role.manage`) and exits 1 when the active preset gives the actor's role anything but `allow` for one (`request-user` is refused because a commit cannot ask). The hook adds denial of `git commit --no-verify`/`-n`, `core.hooksPath` and writes to `.git/hooks`.
- **`os_permissions` (operating system).** `perm/strict-os.ts`: the installed `.claude/hooks/specplane-*` files, `.claude/settings.json` and the pre-commit hook lose their write bits (execute bits kept), and the store folder becomes 0700 with its files 0600; relaxing restores the write bit on the guarded files. Applied by the setting effect, and after `init --harness` rewrites the files (`harness/install.ts`). The store writer always writes private files (0600, folders 0700) whether or not strict mode is on. The hook denies `chmod`, `chown`, `chgrp`, `chattr` and `setfacl` naming those files.
- **Adapter capability.** `strict-mode` (`§12.6`): Claude claims it when the installed guard hook mentions strict mode (an older copy does not count); Codex claims nothing.
- **Gaps.** All hook measures are text matching and can be got round by a script that writes the files; the hook cannot tell a person's tool call from an LLM's, so `edit_block` blocks every tool call in the session, which is intended because the user edits in their own editor. The commit check recognises an LLM only through the marker (`§7.8`), so an LLM that clears the marker (blocked by `marker_protect`) or runs under Codex is treated as a person. File permissions do not stop the owner or root, and linked plan checkouts get their own `.claude` copies that are not locked. The `hook_protect` check and `os_permissions` overlap on purpose.
- **Left to the harness specs or a later release without a design here:** viewing and review permissions (`harness R21.1`, `harness R38.1`: they are the `info.retrieve` permission, `harness R26.2`), the subproject decision rule (`later-releases R39.1`: a permission matter, no code beyond the existing spec-creation permissions) 
