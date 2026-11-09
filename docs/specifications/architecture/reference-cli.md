---
id: architecture/reference-cli
title: Reference CLI
status: awaiting-review
authors:
  - llm: claude-sonnet-5-5
    contribution: drafted
implements: [cli R16, harness R34, configuration R25, configuration R25.1, plan-execution R27, specifications R1, specifications R5, specifications R7, specifications R9, specifications R10, specifications R10.1, specifications R11, specifications R11.1, specifications R11.2, specifications R11.3, specifications R11.4, specifications R40, cli R16.1, verification R12, verification R24, verification R24.1, verification R64, configuration R54, roles-and-permissions R42, roles-and-permissions R42.1, roles-and-permissions R42.2, roles-and-permissions R44, roles-and-permissions R46, roles-and-permissions R50, roles-and-permissions R55, roles-and-permissions R56, roles-and-permissions R56.1, roles-and-permissions R57, cli R17.1, cli R17.2, requests R52, requests R52.1, requests R52.2, requests R52.3, requests R52.4, requests R52.5, plan-execution R27.5, plan-execution R27.5.1, plan-execution R27.5.2, verification R13, verification R13.1, verification R36, verification R36.1, verification R36.2, verification R61, verification R61.1, verification R61.2, verification R61.3, verification R61.4, verification §2, verification §3, plans R28, plans R28.1, plans R29, plans R29.1, plans R29.2, plans R29.3, plans R30, plans R30.1, plans R69, plans §2, plans §2.1, plans §2.2, plans §3.1, plan-execution R27.1, plan-execution R27.1.1, plan-execution R27.2, plan-execution R27.2.1, plan-execution R27.3, plan-execution R27.4, plan-execution R27.6, plan-execution R31, plan-execution R31.1, plan-execution §2, plan-execution §3, harness R14, harness R18, harness R19, harness R19.1, harness R19.2, harness R20, harness R20.1, harness R26, harness R26.1, harness R26.2, harness R35, harness R35.1, harness R47, harness §2, steering R51, steering R59, steering R59.1, steering R22, steering R23, cli R17, cli R33, cli R33.1, verification R32, verification R36.3, roles-and-permissions R43, roles-and-permissions R49, roles-and-permissions R55.1, roles-and-permissions R58, later-releases R37, later-releases R39, later-releases R66, plan-execution R31.2, harness R21, harness R38]
references: [cli §2, architecture/file-formats §6.2, architecture/repository-layout §3, architecture/repository-layout §2, architecture/file-formats §6, configuration §2, architecture/file-formats §9.2, architecture/repository-layout §1, architecture/file-formats §9.1, architecture/file-formats §2.1, architecture/file-formats §1.1, architecture/file-formats §3.3, architecture/file-formats §11.2, architecture/file-formats §3.1, architecture/file-formats §3.2, architecture/file-formats §3.4, architecture/file-formats §5.2, architecture/file-formats §1.2, specifications R2, specifications R68, architecture/file-formats §4.2, architecture/file-formats §4.5, architecture/file-formats §2.4, architecture/file-formats §2.2, architecture/file-formats §2.3, architecture/file-formats §8, architecture/file-formats §2.5, architecture/file-formats §2, specifications R4, architecture/file-formats §5.3, architecture/file-formats §11.3, R62, R63, architecture/file-formats §7.1, architecture/file-formats §7.2, roles-and-permissions §2, requests §2, architecture/file-formats §10, verification §2.1, verification §2.2, architecture/file-formats §11.1, architecture/file-formats §11.4, architecture/file-formats §5, architecture/file-formats §5.5, architecture/file-formats §5.4, architecture/file-formats §5.1, architecture/repository-layout §5, harness §3, architecture/file-formats §7.4]
---

# Reference CLI

This spec says how the reference implementation of Specplane is built: the technology, the module structure, how a repository and its configuration are loaded, how specs are parsed and cites resolved, how fingerprints and approvals are computed and checked, how validation, warnings, permissions, requests, the audit log, tests, plan flows, harness actions and human commands work, and which checks run in pre-commit hooks and CI. File contents are in `architecture/file-formats`; where files live is in `architecture/repository-layout`. The way harness text, steering and instructions are delivered is in `architecture/agent-skills`. Each section states which feature sections it implements. Details the feature specs leave open are marked "assumption". Items for later releases are marked "later release" and are not built first.

## §1 Technology choices

Implements `cli R16`, `harness R34`.

- **Language and runtime.** TypeScript on Node.js 22 or later, compiled with `tsc` to `dist/`. The package is `specplane` on npm with one binary, `specplane`. Tests run through the repository's test script (`AGENTS.md`).
- **One core, several front ends.** All behaviour lives in a core library that never prints and never reads the terminal. Three thin front ends call it: the CLI (people), the harness adapter (the LLM, `§12`) and the user-command runner of a harness (a person typing a harness command, `§12.2`). The front end decides which role the call runs under (`§7.1`); the core never guesses it. This is what makes "same checks everywhere" (`cli §2`) true by construction.
- **Libraries.** `commander` for command routing and help; `yaml` (the eemeli library, YAML 1.2, comment-preserving document API) for reading and writing frontmatter, configuration and progress files, replacing `js-yaml` and `gray-matter` of the earlier build (assumption: round-trip writes are needed, `architecture/file-formats §6.2`); `ajv` with `ajv-formats` for the JSON records of the local store and the configuration schema. No native dependencies.
- **Git and forge.** The `git` command, started without a shell and with a fixed environment (`LC_ALL=C`, no pager, no prompts). The `gh` command is used only to open a pull request, and only when it is installed (`§11.7`). No git library is used.
- **Determinism.** The CLI and core never call an LLM. Intelligent checks are carried out by an LLM in a harness and recorded through the core (`§10`).
- **Time and randomness** (dates, ID suffixes) come from one injectable clock and random source, so tests are reproducible (assumption).
- **Output.** Every command produces a result object; one formatter prints it as text and another as JSON (`--json`). See `§13.3`.

## §2 Module structure

Implements `cli R16`, `harness R34`. Names are the target structure; the current code under `packages/cli/src` is moved toward it, and modules of removed features (overlays, pins, leak guard, ADR parsing, `PLANS.md` generation, forge restack, the conductor and writer-lease machinery) are deleted.

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
               fingerprint.ts   spec-v2 and sec-v1 (§5.1)
               status.ts        effective status, outdated reasons (§5.2)
               approve.ts       groups, checks, approval write (§5.3)
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
               worktree.ts (§11)
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

- `config.ts` reads `.specplane/config.yaml` from `checkoutRoot()`; a missing file means all defaults. The result is a fully populated `Config` plus a list of findings (unknown key, wrong type, non-positive number, unusable path, missing permission or preset) from the schema in `architecture/file-formats §6`, `§6.1` and `§6.2`. A bad key is dropped and its default used; the loader never throws on content (`configuration R25`).
- The loader runs once per command and the `Config` object is passed down; nothing re-reads it mid-command, so a change applies from the next command.
- Writing: `config set <key> <value>` and `config unset <key>` edit the YAML document in place (comments and key order kept), validate the new value against the schema before writing, and write through a temp file and rename. A setting set to its default is written as given (`configuration §2`).
- Every write is a guarded operation with permission `config.change` (`§7`). Under `request-user` the request holds `params: {key, old, new}` (`architecture/file-formats §9.2`). The audit entry carries `old` and `new` (`§9`). Setting `permissions.preset` is the same operation.
- Side effects of a setting are applied by the same operation: turning `pre_commit.*` on or off installs or removes the hook section (`§14.2`); changing `permissions.preset` triggers steering regeneration (`§12.4`).
- Reading is unguarded and lists every key with its value, whether it is set or default, and its default (`configuration R25`). Settings for later releases are accepted and shown, with a note that they have no effect yet.
- Terms of the old model are reported as unknown settings (`architecture/file-formats §6.2`).
- Assumption: `paths.*` and `plans.dir` are resolved and checked once at load time (inside the repository, not overlapping, `architecture/repository-layout §1`) and the checked absolute paths are what the core uses.

### §3.3 Local store

`repo/store.ts` is the only code that touches `<git-common-dir>/specplane/`. It creates the directory on first write, treats missing files as empty, writes JSON and YAML files through a temp file and rename, and appends audit lines with one `write` of a complete line (`architecture/repository-layout §2`). Files: `requests/`, `audit.jsonl`, `logs/`, `worktrees.json`, as in `architecture/file-formats §9.1`, plus these assumptions (not in that table): `budgets.json` (plan id to budget list, `§11.4`), `runs/<plan-id>.json` (run marker, `§11.3`), `reviews/<plan-id>.json` (target commit seen by the final review, `§11.6`), `sessions/<session-id>.json` (instructions already delivered, `§12.3`) and `role.json` (the Administrator switch, `§7.1`).

## §4 Specification parsing and cite resolution

Implements `specifications R1`, `specifications R5`, `specifications R7`, `specifications R9`, `specifications R10`, `specifications R10.1`, `specifications R11`.

### §4.1 Frontmatter

`frontmatter.ts` splits a file at the first line `---` and the next line that is exactly `---`. The block is parsed with the `yaml` library in the core schema with unique keys and no custom tags; dates stay strings (`architecture/file-formats` intro). The result is `{data, bodyOffset, raw}`. A file whose first line is not `---`, whose block does not parse, or whose required fields are wrong yields a `FormatFinding` and the spec is marked invalid; it is still listed and never silently skipped (`verification R12`). Field rules are those of `architecture/file-formats §2.1`. `INFO.md` is read as plain markdown and reported only when it has frontmatter (`architecture/file-formats §1.1`).

Editing writes back through the YAML document so untouched lines are byte-identical; only the named keys change. A spec's body is never rewritten by metadata operations. Authors are appended, never reordered (`specifications R10`, `specifications R10.1`).

### §4.2 Sections

`sections.ts` scans the body line by line, ignoring fenced code blocks, and builds an index of ATX headings. A citable heading matches the grammar of `architecture/file-formats §3.3`. The index maps each section ID to `{level, startLine, endLine}`, where `endLine` is the line before the next heading of equal or lower level. Duplicate section IDs and a child under the wrong parent are reported. The same pass collects `Test (deterministic):` and `Test (intelligent):` lines per section and numbers them (`architecture/file-formats §11.2`).

### §4.3 Cites

- **Extraction.** `cites.ts` finds inline code spans outside fenced blocks whose whole content matches the cite grammar of `architecture/file-formats §3.1`, and reads the frontmatter lists `covers`, `implements`, `references`. Each cite records the file and line for messages. A cite inside the section that defines it is dropped (`architecture/file-formats §3.2`).
- **Resolution** follows `architecture/file-formats §3.4` exactly, in this order: project, then requirement or spec file, then section. The result is `{kind, file, startLine, endLine, text}` or an error with a reason (`requirement not found`, `retired`, `duplicate`, `spec not found`, `section not found`, `unknown project`).
- **Where text is read from.** Resolution takes a `Source`: `committed(rev)` reads blobs with `git cat-file --batch` (one process for the whole run), `worktree` reads files. Status uses `committed(HEAD)`, format checks use both (`§5.2`, `§6.1`).
- **References check.** For each spec, the set of cites found in the body must be a subset of `covers` plus `implements` plus `references`, and the reverse is a warning (`architecture/file-formats §2.1`, `specifications R9`).
- **Dependencies.** The dependency set of a spec is the resolved targets of those three lists. Plans add `plan/<id>` and `file:<path>` targets (`architecture/file-formats §5.2`, `§12.3`). The dependency graph is built once per snapshot and used for approval groups, plan cycles and coverage.

### §4.4 Requirements

`requirements.ts` parses the requirement files named in the central file: marker lines, ID tree, retired list, and each requirement's text range including sub-requirements (`architecture/file-formats §1.2`, `§1.3`). It reports duplicate IDs, retired IDs in use and orphan sub-IDs (`specifications R1`). It never writes the requirements page (`specifications R2`). The "next free ID" helper used by harness actions is highest ever used plus one.

### §4.5 Project snapshot

`project.ts` loads, for a given `Source`, the requirement files, every spec in `paths.features` and `paths.architecture`, and the plans in `plans.dir` and its archive, then the index of sections and cites. Layers that are absent are empty, never an error (`specifications R68`). The snapshot is immutable and shared by validation, status, coverage, retrieval and the final review. The snapshot at HEAD is cached for the life of one command.

## §5 Fingerprints, status and approval

Implements `specifications R11`, `specifications R11.1`, `specifications R11.2`, `specifications R11.3`, `specifications R11.4`, `specifications R40`, `cli R16`, `cli R16.1`.

### §5.1 Computing fingerprints

`fingerprint.ts` implements `architecture/file-formats §4.2` and `§4.3`:

- `specFingerprint(text)`: parse frontmatter, drop `status`, `approval`, `authors`, `review-reason`, `results`, `implementation`, serialise `{frontmatter, body}` as canonical JSON (keys sorted by code point, no whitespace, literal Unicode), SHA-256, prefix `spec-v2:sha256:`. The body is the text after the closing fence with CRLF and CR turned into LF.
- `partFingerprint(text)`: LF-normalised part text, trailing blank lines removed, prefix `sec-v1:sha256:`. A whole-spec cite uses `specFingerprint` of the cited file. An unresolved cite has no fingerprint.
- Canonical JSON is a small local function (about 30 lines) rather than a library, so the byte output is fixed by this spec and not by a dependency version (assumption). Fingerprint prefixes are versioned; an unknown prefix in a record is reported and treated as changed.

### §5.2 Effective status

`status.ts` implements the algorithm of `architecture/file-formats §4.5` over `committed(HEAD)` and returns `{status, reasons[], notes[]}`:

1. Read the spec blob at HEAD. No approval, or stored `awaiting-review`: `awaiting-review` with reason `never-approved`.
2. Compare `specFingerprint` of the HEAD content with `approval.fingerprint`. Without a stored fingerprint, read the blob at `approval.commit` instead; a commit that is not in history adds reason `edited` and a note that approval cannot be checked.
3. For each entry of `approval.cited`, resolve the cite at HEAD and compare part fingerprints; a difference, or no resolution, adds `outdated: <cite>`. A dependency not in `cited` counts as changed.
4. A requirement-file dependency is compared the same way; a requirement file without approval data is never itself a reason.
5. If the working tree file differs from HEAD, add the note "uncommitted changes are ignored" (`specifications R40`).
6. An approval with `override: true` is treated like any other approval: it carries the fingerprints that `override status` wrote from the content at that moment, so a later content or cited-part change returns the spec to `awaiting-review` (`cli R17.2`). Assumption: this replaces the "first calculation" wording of `architecture/file-formats §2.4`, which the fingerprints make unnecessary.

Statuses of many specs are computed in one pass over the shared snapshot, so listing the project costs one `git cat-file --batch` process. Stored and computed values that differ produce the warning of `architecture/file-formats §2.2`; commands that write approval or review state keep them in step.

### §5.3 Approval

`approve.ts` implements `cli R16`. Inputs: spec IDs (IDs only, never natural language) and options `--yes`, `--no-commit`.

1. **Resolve and expand.** Resolve each ID to a spec file. Build the dependency graph among specs and take strongly connected components: the group of a named spec is its component, so a spec that cites a cycle without being cited back is not in it (`cli §2`). The union of the groups of all named IDs is the set to approve.
2. **Checks, all collected, none stopping the others** (`cli R16`):
   - the role holds `spec.approve` as `allow` for every member (`cli R16.1`); under `request-user` one request is created for the whole set and nothing else runs (`§8`);
   - each member's file is committed and unchanged in the working tree;
   - every cite resolves; a missing part is named;
   - each dependency outside the set is effectively `approved` at HEAD (requirement files are exempt, `§5.2` item 4, assumption: the page owner approves requirements);
   - no member has a current failed test result (`verification R61.1`, `§10.3`);
   - the stored status of a member that is already effectively approved is left alone, and approving only such specs does nothing and says so.
3. **Confirm.** When the set has more than one member, print the list and ask; `--yes` skips the prompt. Without a terminal and without `--yes` the command refuses (assumption).
4. **Write.** If any check failed, nothing is written and every reason is printed. Otherwise, for each member, compute `approval.fingerprint` and `approval.cited` from the HEAD content, find `approval.commit`, and write the block (`architecture/file-formats §2.3`, `§4.4`): `by` from git `user.name` (an LLM approver is `{llm, delegated-by}`), `date` from the clock, `status: approved`, and removal of `review-reason`. Members of one group get the same `by` and `date`.
5. **Content commit.** `approval.commit` is found by walking `git log --format=%H -- <path>` newest first and taking the last commit whose `specFingerprint` equals the current one before the first that differs.
6. **Commit.** One commit contains exactly the written files, with message `docs(specs): approve <id>` and the trailers of `architecture/file-formats §8`; `--no-commit` leaves the edit staged. The approval counts once it is committed (`specifications R40`).
7. **Audit.** One entry per member (`§9`).

Approval from the harness is the same function with the LLM role (`§12`); only the guard result differs (`harness R20`, `harness R20.1`).

### §5.4 Review state writes

When the CLI or core writes a spec because a content edit made it stale (`specifications R11.3`, `specifications R11.4`), it sets `status: awaiting-review`, removes `approval` and writes `review-reason` from the computed reasons (`architecture/file-formats §2.5`). Plain `git commit` of a hand edit does not do this; the effective status is computed on read, and a stored value that disagrees is a warning (`§6.3`). `spec reopen <id>` (human, guarded by `spec.edit.<type>`, assumption) performs the write without changing content.

## §6 Validation, warnings and coverage

Implements `verification R12`, `verification R24`, `verification R24.1`, `verification R64`, `configuration R25`, `configuration R54`.

### §6.1 Validation engine

- **Rules.** `verify/rules/` holds one module per family, each exporting `rules: Rule[]` with `{id, severity, source, run(snapshot) -> Finding[]}`. A runner executes every rule on the snapshots it needs and sorts findings by file and line. Families: `spec-format` (`architecture/file-formats §2`), `cites` (`§4.3`), `requirements` (`§4.4`), `plans` (`§11.1`), `status` (`§5.2`), `tests` (`§10`), `config` (`§3.2`), `permissions` (`§7.4`), `harness` (`§12.6`).
- **Finding** is `{severity: error|warning|note, rule, message, file, line, section, source: committed|worktree}`. Errors are things that make a file unusable: unreadable or invalid frontmatter, ID/path mismatch, unresolved cite, missing reference entry, duplicate or reused requirement ID, plan ID/folder mismatch, plan reference cycle, unreadable step, unreadable result record. Warnings are project-state findings: uncovered items, outdated specs and results, outdated plan references, listed-but-unused references, stale stored status, harness and steering staleness, permissions without documentation, unwritable audit log.
- **Committed and working tree.** Status, outdated and test-state rules read `committed(HEAD)`. Format rules run on both and a finding says `worktree` when the file differs from HEAD (`verification R12`).
- **Scope.** The command takes zero or more spec or plan IDs and then checks only those and their cites.
- **Exit status.** 0 when there are no errors, 1 otherwise; warnings never change it. `--json` prints the findings list and counts (`§13.3`).
- **Read-only.** The runner receives a snapshot and no writer; it cannot write files, status or the store except the audit entry of the run (`§9`).
- **Intelligent checks** (separation of layers, `specifications R4`) are not rules. They are instructions delivered by the harness (`harness R14`); an LLM may record results as warnings through `harness.report-warning` (assumption), shown in the warnings list for the current session only.
- **No requirements, plans or later layers** produce no findings (`specifications R68`, `plans R69`).

### §6.2 Rule details worth fixing here

- Cites inside plans follow the same resolver; `file:<path>` must exist, and a `context` file that does not exist yet is a warning (`architecture/file-formats §5.3`).
- A plan reference cycle is found with Tarjan's algorithm over `plan/<id>` edges and reported naming the members.
- A spec with `covers` on an architecture spec, or `implements` on a feature spec, is an error (`architecture/file-formats §2.1`).
- `implementation` on a non-architecture spec is an error (`architecture/file-formats §11.3`).
- A summary in a result that matches the credential heuristic (token names such as key, secret, password; strings of 32 or more base64 or hex characters) is a warning, never an error (`verification R61.3`).

### §6.3 Warnings collector

`warnings.ts` merges two kinds of source into one list: warning findings from the rules above, and checks that are not validation: audit log not writable (set by the audit writer during the command), harness installation missing or older than the installed Specplane (`§12.6`), steering stamp older than the active preset or steering (`§12.4`), permission without documentation or steering (`§7.4`), pre-commit setting on with no hook installed (`§14.2`). Each warning is `{text, subject: spec|plan|permission|installation, why}`. The list is recomputed on every call and nothing is stored or dismissed (`verification R24`). `specplane warnings [<id>]` narrows to one spec or plan. A warning never blocks.

**Auto warn** (`verification R24.1`): the command runner, after the command's own result is final, calls the collector when `auto_warn` is on and appends `N warnings; run `specplane warnings`` as the last text line (`0 warnings` when none). In JSON output the count is a top-level `warnings` field and the data is untouched. Failure of the collector never changes the command's status; it prints `warnings unavailable` (assumption). Harness adapters add the same count to the result text they return to the LLM.

### §6.4 Coverage

`coverage.ts` builds, from the dependency graph (`§4.3`), for each requirement the feature specs that list or cite it, for each feature spec the architecture specs that do, and for each spec the items it covers. Two views are returned: all items with their coverers, and uncovered items only. Uncovered requirements and feature specs are warnings (`§6.3`). Exempt: requirements `R62`, `R63` and their sub-requirements, and IDs in `coverage.requirement_only` (`verification R64`). Absent layers are skipped; several coverers are all shown and not warned. Both views are available to people and, under `info.retrieve`, to the LLM.

## §7 Roles, permissions and presets

Implements `roles-and-permissions R42`, `roles-and-permissions R42.1`, `roles-and-permissions R42.2`, `roles-and-permissions R44`, `roles-and-permissions R46`, `roles-and-permissions R50`, `roles-and-permissions R55`, `roles-and-permissions R56`, `roles-and-permissions R56.1`, `roles-and-permissions R57`, `configuration R54`, `cli R16.1`, `cli R17.1`, `cli R17.2`.

### §7.1 Which role runs

The role is chosen by the front end, never by arguments, files in the project, or anything an LLM can write:

- The CLI runs as `standard-user`. `specplane role switch administrator` writes `role.json` in the local store (`§3.3`); until `specplane role switch standard-user`, CLI calls on this machine run as the Administrator. With no mapping configured anyone may switch (`roles-and-permissions R44`). A role mapping is a later release (`§15`).
- The harness adapter runs LLM actions as `llm`. A subagent has the role of the LLM that started it (`roles-and-permissions R42.1`); the adapter does not distinguish them in the first release.
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
- `Authorized` is an opaque value holding the permissions and the actor. Every mutating core function (write spec metadata, approve, record result, write config, plan flows, accept request) takes one as its first argument; no front end can build it. A function that needs two permissions checks the token covers both (type check plus a runtime check). Operations that need no permission (reads, validation, running tests, `request send`) take no token.
- On `deny` the message names the permission, says the action is refused, and tells the LLM not to look for another way (`steering R51`). On `request` it creates the request draft (`§8`). A refused or held action runs no part of the operation (`roles-and-permissions R50`).
- The audit writer is called by the guard for every decision (`§9`), including refusals.
- A permission shared by several commands is evaluated by the same function and therefore has one mode (`roles-and-permissions §2`).

### §7.4 Documentation

`specplane permissions` lists every permission with the mode in the active preset for each role; `specplane permissions <id>` shows its full documentation: what it allows and does not, commands, mode per default preset, the reader's own role and mode, and the complete steering including custom steering (`configuration R54`). The harness serves the same function (`§12.5`). Changing the preset changes what is shown on the next command (`configuration R54`). Validation warns when a catalog entry has no description or steering key, and fails the build in tests when a preset lacks an entry for a catalog permission it should state (`steering R51`).

### §7.5 What is not enforced

Roles are not airtight (`roles-and-permissions R55`). The first release enforces through `guard.ts` and the harness block of `§12.7`. Strict mode and bypass guards are later releases (`§15`).

## §8 Requests

Implements `requests R52`, `requests R52.1`, `requests R52.2`, `requests R52.3`, `requests R52.4`, `requests R52.5`, `plan-execution R27.5`, `plan-execution R27.5.1`, `plan-execution R27.5.2`.

- **Store.** `requests/store.ts` reads and writes `requests/<id>.json` with the schema of `architecture/file-formats §9.2`, validated with `ajv`. IDs come from the clock and four random hex digits. Writing is temp-file and rename; two writers cannot both accept a request because accept re-reads the file and refuses unless `state` is `pending` (compare-and-set).
- **Sending.** When the guard returns `request`, the front end calls `requests.create` with the guard's draft: the sender, permission, action (`command` and `params`), reason, base branch and commit, plan id, blocking flag. For a spec edit, `params.patch` is a unified diff of the proposed change against the base and `diff` is the same text rendered against the last approved version (assumption: the patch is stored so accept can apply it). The LLM-facing reply says a request was sent and that nothing was done.
- **Deny sends nothing.** A role with `deny` creates no request (`requests R52.3`). A role with `allow` creates one only when the LLM chooses to through the `request.send` action, under steering (`steering R59`); the harness records it with the permission the action would need.
- **List and show.** `specplane requests` and the harness pane list pending first, then answered. `requests show <id>` prints sender, action, reason, and for specs the diff in git diff form with colour on a terminal (`requests R52.1`, `requests R52.4`). The diff is recomputed at show time against the current approved version; a never-approved spec shows all lines as additions.
- **Accepting.** `accept <id>` runs: re-read the record, require `pending`; build a guard check with the accepting person's role and the request's permission list, requiring `allow` (a role whose mode is `request-user` or `deny` cannot accept, and the missing permission is named, `requests R52.2`); re-check the action against the current state (the same preconditions as direct execution; the base is only context); run the action once under that authority with the accepter as actor and the request id in the audit entry; set `accepted` with `answer {by, date, note}`. If the action cannot be done (plan gone, patch does not apply, content changed since a test ran) the request becomes `failed` with `error` and the user is told (`requests §2`). An LLM role never accepts: the front end for `llm` has no `accept` or `decline` action (`roles-and-permissions R57`).
- **Declining** sets `declined` and changes nothing else.
- **Blocking requests.** In a plan run `request.send` takes `blocking: bool` (`plan-execution R27.5`). A blocking request soft-stops the plan with reason `waiting for request <id>` (`§11.3`). When it is accepted or declined and the plan is stopped for that reason, the response includes `resume: <plan-id>`; the harness resumes the plan if a session is active, otherwise the plan stays stopped until `plan resume`. The answer is part of the resume context (`plan-execution R27.5.1`). Non-blocking requests only record `blocking: false`. The final review lists pending ones for the plan (`§11.6`, `plan-execution R27.5.2`).
- **Notifications.** After a request is stored, if `notifications.push` is on and the permission is in `notifications.push_permissions`, the adapter's `notify(summary)` is called with a short text and no content (`requests R52.5`). A harness without `notify` ignores it. The list and dialogue are the only places a request is answered.
- **Dialogue.** If a session is active, the adapter opens the dialogue for each new request in order; closing it leaves the request pending (`requests R52.4`).

## §9 Audit log

Implements `verification R13`, `verification R13.1`, `configuration R25.1`.

- `audit/log.ts` appends one JSON line per decision or action in the format of `architecture/file-formats §10`: time, branch (`git branch --show-current`, or the short commit when detached), actor, command, arguments, permission, outcome (`done`, `refused`, `request-sent`, `cancelled`, `failed`), reason and for changes `old` and `new`. No file content and no test output are written (`verification R13`).
- Entries are produced in three places: the guard (every decision), the command runner (`done` or `failed` after the operation, `cancelled` on interrupt), and the request code (`request` id). A guarded action therefore has at least two entries only when it ran after a request; the runner merges the guard and result for the same call into one line where it can (assumption).
- A failed append sets a flag read by the warnings collector and prints one warning at the end of the command; the action proceeds (`verification R13`). The writer never throws into the caller.
- **Retention** (`audit.retention`): at the start of each command that is not `audit`, entries older than the retention are dropped by rewriting through a temp file and rename, and one entry `audit prune` records how many and the oldest date kept (`verification R13.1`). `forever` skips it. Concurrent commands race harmlessly: the rewrite re-reads the file and keeps any line appended meanwhile (assumption: rewrite takes a `audit.lock` file created with `wx` and skips pruning if it exists).
- `specplane audit [--since <date>] [--branch <name>] [--actor <role>] [--json]` reads it. For an LLM the same read needs `info.retrieve` (`§12.1`). Lines that do not parse are skipped and counted in a warning.

## §10 Tests, results and implementation status

Implements `verification R36`, `verification R36.1`, `verification R36.2`, `verification R61`, `verification R61.1`, `verification R61.2`, `verification R61.3`, `verification R61.4`, `verification §2`, `verification §3`, `configuration R25`.

### §10.1 Declarations

`tests.ts` reads Test lines from the section index (`§4.2`) and gives each the ID `<section id>#<n>` (`architecture/file-formats §11.2`). A section with no Test line has the implicit test `<section id>#0`, kind `intelligent`. An implicit test exists for every `## R<n>` and `## §<n>` heading of a spec that declares nothing in it; a spec's own result set is the union over its sections.

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
2. Reads the committed content at HEAD. To run against it, the runner creates a temporary checkout of HEAD with `git worktree add --detach <tmp>` under the local store, runs each test there, and removes it (assumption: this makes "committed state" true when the working tree is dirty). If the working tree differs the output says the committed state was tested (`verification R36.2`, `verification §2.2`).
3. Each test starts its argv without a shell, with a clean environment plus `SPECPLANE_TEST=1`, a wall-clock limit of 120 seconds (assumption, `--timeout` overrides) and output captured. The `expect` keys are `exit`, `stdout-contains`, `stderr-contains`, `stdout-equals` (assumption). A failure summary names the failed expectation and the first lines of the difference.
4. The result per test is `passed`, `failed` or `not-run` (harness missing, no definition, interrupted). An interrupted run records nothing and the audit log gets `cancelled` (`verification §3`).
5. Output goes to the log (`§10.5`), not to the result.

### §10.3 Recording

`tests.record` writes one entry into the tested spec's `results` (`architecture/file-formats §11.1`) after the guard returns `allow` for `test.record`:

- `kind`, `outcome`, `by` (the actor), `date`, `commit` (HEAD tested), `fingerprint` (`specFingerprint` of that spec at that commit), `against` (fingerprints of the specs it was checked against: the specs it `covers` or `implements`), `summary`, optional `log`.
- Under `request-user` the test still runs and its outcome is shown; a request is created holding `{spec, test, outcome, summary, commit, fingerprint}`. On accept, the record is written only if HEAD's fingerprints still equal those in the request; otherwise nothing is recorded and the user is told why (`verification R61.2`).
- Under `deny` the outcome is shown with the note "not recorded".
- A summary that looks like a credential gives a warning but is recorded (`§6.2`).
- Recording uses the metadata write path and does not change status. Writing `results` is excluded from the fingerprint, so it is not an edit (`architecture/file-formats §4.2`).
- Override: `specplane spec override test <id> <test> passed|failed|clear` needs `override.test` and writes `override: {by, date}` into the result (`cli R17.2`, `architecture/file-formats §11.1`).

A result is **current** when its `fingerprint` and every `against` fingerprint equal the ones computed at HEAD now, else **outdated**; the effective result per test is the latest current one (`verification R61.1`, `verification §3`). Approval and mark-implemented use only current results: a current `failed` blocks them and names the test; outdated results count as none.

### §10.4 Implementation status

`implementation.ts` implements `specplane spec implement <id>` (also a harness action). Only architecture specs carry the field (`architecture/file-formats §11.3`).

1. Needs `test.record` with mode `allow` for the actor, and for the `llm` role the setting `architecture.llm_may_mark_implemented` to be on (`verification R36.1`).
2. Takes `commit = HEAD`, noting when the working tree differs from it, and runs the checks at that commit: all deterministic tests (`§10.2`), plus an intelligent verdict for every section that declares nothing or declares intelligent tests. Intelligent verdicts exist only as current results recorded through `tests.record` by an LLM in a harness; from the CLI they are reported as `needs harness`, and the command ends with the status unchanged (`verification R36.1`).
3. Writes `implementation: {status: implemented, commit, fingerprint, by, date}` only when every test and section has a current `passed`.
4. A current `failed` refuses and names it (`verification R36`).
5. Reading status: `implemented` only if the block's fingerprint equals the HEAD fingerprint and `commit` is an ancestor of HEAD (`git merge-base --is-ancestor`); otherwise the block is removed by the next writing command and meanwhile shown as unimplemented with the reason (`verification R36.2`).

### §10.5 Logs

A test run writes `<log-id>.log` according to `tests.logs`: `local` to `<store>/logs/`, `git` to `<plans.dir>/../test-logs/` with a warning printed when selected and on each write, `off` none (`architecture/file-formats §11.4`, `verification R61.4`). Retention of local logs runs with audit retention at command start and is audited. Logs are text with a header (spec, test, commit, actor) and the captured output; the intelligent session text is supplied by the harness adapter when recording.

## §11 Plans

Implements `plans R28`, `plans R28.1`, `plans R29`, `plans R29.1`, `plans R29.2`, `plans R29.3`, `plans R30`, `plans R30.1`, `plans R69`, `plans §2`, `plans §2.1`, `plans §2.2`, `plans §3.1`, `plan-execution R27`, `plan-execution R27.1`, `plan-execution R27.1.1`, `plan-execution R27.2`, `plan-execution R27.2.1`, `plan-execution R27.3`, `plan-execution R27.4`, `plan-execution R27.6`, `plan-execution R31`, `plan-execution R31.1`, `plan-execution §2`, `plan-execution §3`.

### §11.1 Parse and validate

`plan/parse.ts` reads a plan folder (active or archived) per `architecture/file-formats §5`: PLAN.md frontmatter and body, step files, `progress.yaml`, handoff entries and gap entries. `plan/validate.ts` produces findings for: ID versus folder, steps contiguous from 01 with matching `step` and `plan` fields, `implements` and `context` cites resolving, the latest handoff outcome agreeing with `done`, gap IDs counting up, reference cycles, a missing referenced plan, and the outdated-reference warning: a plan's recorded commit for a spec differs from the latest commit that changed that spec on the current branch (`git log -1 --format=%H -- <path>`), naming plan, spec and both commits (`plans R29.3`). Project without plans: nothing (`plans R69`).

### §11.2 Status and next step

`plan/next.ts` computes, from `progress.yaml` and the step list, the **next step** (lowest-numbered step not in `done`) and its readiness. A step is **waiting** when it lists a spec in `implements` whose effective status at the plan branch HEAD is not `approved` (`plans R30.1`, `plan-execution R27`); the reply names the spec. A selection (next, N steps, all remaining) is validated: it must start at the next step and a waiting step ends the selection there; a selection starting later is denied naming the next step (`plan-execution R27`). Plan status shown to users is `progress.yaml` `status`, except that `in-progress` with no live run marker is reported `stopped` with reason `session ended unexpectedly` without rewriting the file (`§11.3`, `plans R29.1`). `plan list [--live]` reads the plan folder of the checkout the command runs in; `--live` reads each running plan's own checkout through `worktrees.json` and merges, with a path git no longer lists dropped (`architecture/repository-layout §3`).

### §11.3 Start, run marker, stop, resume

- **Start** (`plan start <id> [--target <branch>] [--force-deps <ids>]`; `plan.start` permission, `plan-execution R31.1`). Order: guard; load the plan from the current checkout; check start conditions when `plans.start_conditions` is on: the plan and every spec in its `implements` entries with `mode: implements` and its `references` are effectively approved at the target tip, naming each that is not (`plan-execution R27.6`); a referenced plan must be `completed` unless named in `--force-deps`, which the handoff records (assumption, as the feature spec); a reference cycle always refuses. Then: target is `--target`, else the current branch; record `target_branch` and `start_commit`; `git worktree add -b plan/<id> <path> <target-commit>` where `<path>` is from `architecture/repository-layout §3`; record the path in `worktrees.json`; run `plans.setup_command` in the new directory, and on failure remove the worktree and branch and fail with the command's output; write `progress.yaml` with `status: in-progress` in the new worktree and commit it (`chore(specplane): start <id>`, `architecture/file-formats §8`). The main checkout is untouched. Starting writes the first run marker.
- **Run marker.** While a session works, the adapter keeps `runs/<plan-id>.json` `{session, pid, heartbeat}` updated every minute and removes it on a clean end (assumption). A status read treats a marker whose heartbeat is older than five minutes, or with a dead pid on this machine, as no run.
- **Step finished** (`plan step-done <id> --step N --outcome done|partial`, harness action `plan.step-done`): requires a handoff entry for the step with the same outcome and all sections (`architecture/file-formats §5.5`); requires a commit on the plan branch since the step began (an entry-only commit is created if there is none, `plan-execution R27.4`); for `done` appends `N` to `done` and advances `current_step`; commits `progress.yaml`. Claude Code's step command records the step itself and the agent never runs this directly (`AGENTS.md`); the function is the same.
- **Stop** (`plan stop <id> [--reason ...]`, harness `plan.softstop`): sets `status: stopped` with `stop {kind, reason, needs}` after the LLM wrote the handoff entry; commits. Kinds: `soft` (LLM or budget soft stop), `user`, `hard` (harness ended the session by force; written by the adapter, or by the next status read when it finds the marker stale after a budget hard stop was logged), `failure`. A soft stop by the LLM needs `plan.softstop` (allow in every default preset). A block is never turned into a skipped step.
- **Resume** (`plan resume <id>`; `plan.resume`). Not available for `completed` or `abandoned`. Re-creates the worktree from `plan/<id>` if gone (`git worktree add <path> plan/<id>`), clears `stop`, sets `in-progress`, commits, and returns a **resume context**: the plan's next step, handoff entries, any answers to requests that stopped it, and for a `hard` or `failure` stop or an unexpected end the session log pointer the adapter holds for `progress.yaml` `session`. After a soft stop the context has no session log (`plan-execution R27.2`). Start conditions are not rechecked. If `target_branch` no longer exists the plan stays stopped asking for a new target, set by `plan retarget <id> --target <branch>` (assumption).
- **Selection never skips**: resume continues at the first step not done.

### §11.4 Budgets

`budget.ts` stores per plan a list `{resource, soft, hard}` in `budgets.json` (assumption; `architecture/file-formats §5.4` has no field), set by `plan budget <id> --resource <name> --soft <n> --hard <n>` under `plan.budget` (`plan-execution R27.1.1`). A resource is a name the adapter reports (tokens, `5h`, `weekly`); the adapter publishes `measurable(resource)`; a budget on an unmeasurable resource is refused with the reason (`harness R35.1`). During a run the adapter calls `evaluate(plan, usage)`: at soft it tells the LLM to bring the work to a safe point, commit and write the partial handoff, then calls `plan stop --kind soft --reason "soft stop at 80% of the weekly limit"`; at hard it ends the session and records `stop.kind: hard`. No budget means no check. Budgets never span plans.

### §11.5 Create and edit (LLM)

`plan.create` writes the folder from a template: ID `<today>-<words>` (two to four lowercase words, `architecture/file-formats §5.1`), PLAN.md with `status: awaiting-review`, an empty `progress.yaml` with `status: not-started`, and step files. Needs `plan.create`; `plan.edit` for later changes, including adding or removing steps. Editing a step that has started is refused except to later steps; deviations go in the handoff. Neither approves anything (`plan-execution R31`, `plan-execution R31.1`). Plan approval is the spec approval flow of `§5.3` applied to PLAN.md.

### §11.6 Final review and finishing

- **Open.** When `done` covers every step, or on request, `plan review <id>` assembles: per step the handoff outcome and changes; open gap entries; unrun steps; pending requests whose `plan` is this plan; acceptance criteria from PLAN.md for the LLM to mark met or not with evidence (the CLI lists them and does not decide); referenced specs whose content changed on the target branch since `start_commit` (compare `specFingerprint` at `start_commit` and at the target tip, with the effective status at the tip) and, separately, specs changed on the plan branch (`plans R28.1`). The target tip seen is stored in `reviews/<plan-id>.json`. The plan stays `in-progress`.
- **Decide.** `plan finish <id> --complete | --back <reason>` needs `plan.complete` (`plan-execution R31.1`); under `request-user` a request goes to the user. `--back` sets `final_review {decision: back-in-progress, reason, by}` and leaves `in-progress`; steps may then be added. `--complete` sets `status: completed`, writes `final_review`, moves the plan folder to `<plans.dir>/archive/<id>/` and commits both as the plan branch's last commit (`chore(specplane): finish <id>`), so a merge brings the archived plan (`plans R28`, `plans R29.2`). Completion is a declaration; it is not conditional on tests.
- **Merge** is separate: `plan merge <id> --pr | --local`. `--pr` pushes nothing itself; it runs `gh pr create` when `gh` is available and otherwise prints the branch to open (`§1`). `--local` runs only in a checkout of the target branch without uncommitted changes and refuses when the target tip differs from `reviews/<plan-id>.json` until the review is shown again; it runs `git merge --no-ff plan/<id>` and on conflict stops, runs `git merge --abort`, and shows the conflicting paths. Specplane never resolves conflicts. After a merge it removes the worktree (refused if dirty unless `--force`) and deletes the branch (`plan-execution §2`, `plan-execution R27`).

### §11.7 Abandon and delete

`plan abandon <id>` (`plan.abandon`): stop the run first, then, in the checkout where the command was run, bring the plan folder from the plan branch (`git checkout plan/<id> -- <plan dir>`), set `status: abandoned`, move the folder to the archive and commit; remove the worktree unless it has uncommitted changes (then ask, or `--force`); keep the branch (`plan-execution §3`). `plan delete <id>` (`plan.delete`): stop the run, remove the folder and commit, remove the worktree under the same rule; references to it are reported missing by validation (`plans R29.2`). Both are audited.

## §12 Harness-facing actions, steering and retrieval

Implements `harness R14`, `harness R18`, `harness R19`, `harness R19.1`, `harness R19.2`, `harness R20`, `harness R20.1`, `harness R26`, `harness R26.1`, `harness R26.2`, `harness R34`, `harness R35`, `harness R35.1`, `harness R47`, `harness §2`, `steering R51`, `steering R59`, `steering R59.1`, `steering R22`, `steering R23`, `configuration R54`.

### §12.1 Actions

`harness/actions.ts` holds a registry `{id, permissions, input schema, handler}`; each handler calls the same core function as the CLI with `Actor {role: llm}` and returns a result object plus the instruction text the adapter attaches (`§12.3`). The set for the first release: `spec.retrieve`, `spec.list`, `spec.create`, `spec.edit`, `spec.delete`, `spec.approve`, `spec.meta.read`, `spec.review-context`, `spec.implement`, `validate`, `warnings`, `coverage`, `test.run`, `test.record`, `config.get`, `config.set`, `permissions.docs`, `docs.search`, `audit.read`, `request.send`, `plan.create`, `plan.edit`, `plan.next`, `plan.step-done`, `plan.softstop`, `plan.start`, `plan.resume`, `plan.abandon`, `plan.delete`, `plan.budget`, `plan.review`, `plan.finish`. Read-only actions need `info.retrieve` (viewing, review, validate, warnings, coverage, test runs, audit, docs; they have no permissions of their own, `harness R26.2`). Spec writes need `spec.create|edit|delete.<type>`; approval `spec.approve`; plan flows `§11`. There is no `request.accept` or `request.decline` and no `role.switch` action (`§8`, `§7.1`). Authorship: `spec.create` and `spec.edit` append the LLM as author with a contribution when `authorship.record_llm` is on, using the model the adapter reports and `unknown` otherwise; they never add a human (`harness R19.1`, `specifications R10`).

`spec.edit` accepts either replacement text of a section or a whole-file replacement, applies it, and when it changes content on an approved spec writes the review-state fields (`§5.4`); under `request-user` it stores a patch (`§8`) and writes nothing. `spec.create` writes frontmatter with `status: awaiting-review`, the chosen ID and cites. The harness never accepts an `approved` status or an `approval` block from the LLM in any write: such keys in supplied text are rejected (`harness R20`, `roles-and-permissions R57`).

### §12.2 User commands

Harness commands typed by the person (`/requests`, approval by ID, status panes, viewing) are implemented by the adapter running the matching core function in the user-command runner with role `standard-user` and no model call; with arguments it passes the arguments and the command's instructions to the LLM (`harness R18`). `harness R21` viewing and `harness R38` review are later release and are built on `spec.retrieve` and the diff routine of `§8` (`§15`). The runner is a small process the harness hook invokes (`specplane harness run <command> [args]`, assumption); it is not a general route to the CLI and refuses commands outside the harness command list.

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
- Documentation (`steering R22`, `steering R23`): the user documentation is markdown under `assets/docs/` with a manifest. `build-ai-docs` generates the AI-facing form deterministically from it: an always-loaded essentials file under a size limit (checked in tests) and a searchable remainder. `specplane docs [topic]` and `docs search` read the bundle offline; `docs.search` is the harness action. Generated files are never hand-edited and are rebuilt by the package build.
- `specplane permissions` output (`§7.4`) is shared by CLI and harness.

### §12.6 Setup and staleness

`harness/install.ts` installs the files of one named harness (`harness R34`: the user names it) into the places of `architecture/repository-layout §5`: owned files are written with a version header; standing instructions go to an owned file, or to the marked block in a shared file that is created if absent and changed only between its markers (`harness §2`). The standing text is fixed and short: Specplane is in use, read `.specplane/config.yaml` and resolve paths from it, look up steering (`harness §2`). A block that is unbalanced stops setup with an error. `harness` findings in validation: installed file missing, version header older than the CLI, stamp mismatch, marker problems. Two harnesses share one block (`harness §3`). Each adapter implements `capabilities()` (instructions on demand, push, subagents, viewing, usage measurement, command blocking); setup and every action state which are missing and refuse rather than substitute (`harness R35.1`).

### §12.7 Keeping the LLM off the CLI

Enforcement of `harness R47` has two parts. Core exports `isSpecplaneCommand(shellText)`, which splits the text into simple commands (handling `;`, `&&`, `|`, subshells, `env` prefixes, `sh -c`, `npx`, `bunx` and path-qualified `specplane`) and reports a match. Each adapter installs a pre-tool hook that calls it for shell tool calls and denies a match with a message pointing to the harness actions; a harness without such a hook states that it cannot block (`harness R35.1`). The check is best effort; stronger guards (environment markers, headless detection) are later release (`§15`).

## §13 Human commands

Implements `cli R16`, `cli R16.1`, `cli R17`, `cli R17.1`, `cli R17.2`, `cli R33`, `cli R33.1`, `configuration R25`, `verification R12`, `verification R13`, `verification R24`, `verification R64`.

### §13.1 Command list

| Command | Does | Permission |
|---------|------|------------|
| `init --harness <name>` | Create `.specplane/config.yaml` if asked, install the harness files (`§12.6`) | `config.change` for the file |
| `validate [<id>...] [--json]` | `§6.1` | none |
| `warnings [<id>]`, `coverage [--uncovered]` | `§6.3`, `§6.4` | none |
| `spec list`, `spec show <id>` | Effective status, authors, results, implementation | none |
| `spec approve <id>... [--yes]` | `§5.3` | `spec.approve` |
| `spec meta get <id>`, `spec meta set <id> <field> <value>` | `§13.2` | `meta.read`, `meta.write[.piece]` |
| `spec override status\|approver\|test ...` | `§13.2` | `override.*` |
| `spec reopen <id>`, `spec implement <id>` | `§5.4`, `§10.4` | `spec.edit.<type>`, `test.record` |
| `test run [<id>] [--all]` | `§10.2` | none |
| `config get [<key>]`, `config set\|unset <key> [<value>]` | `§3.2` | `config.change` for writes |
| `permissions [<id>]`, `steering <command\|permission>` | `§7.4`, `§12.4` | none |
| `role show`, `role switch <role>` | `§7.1` | none |
| `requests [list\|show <id>\|accept <id>\|decline <id>]` | `§8` | permission of the requested action |
| `audit` | `§9` | none for people |
| `plan list\|show\|next\|start\|stop\|resume\|review\|finish\|merge\|abandon\|delete\|budget\|retarget` | `§11` | the plan permissions |
| `docs [topic]`, `docs search <text>` | `§12.5` | none |
| `check ...` | `§14` | none |

Spec content is edited in an editor, not by a command. Plan metadata commands are a later release (`cli R33`, `§15`). Every command accepts `--json`, and `--dry-run` where it writes: a dry run runs the guard and all checks and prints the writes it would do (assumption).

### §13.2 Metadata

`metadata.ts` reads and writes any frontmatter field of a spec through the YAML document, with the permission per piece: `title`, `authors`, `references`, `covers` and `approval` date and commit map to `meta.write.<piece>` (`cli R17.1`); `status`, `approval.by` and results map to the three overrides. An override writes the mark of `architecture/file-formats §2.4`, and for `override status approved` computes the fingerprints from the HEAD content so later edits reopen it (`cli R17.2`). All writes record `old` and `new` in the audit log (`cli R17`). Metadata writes do not change body or review state (`specifications R11.3`) and refuse a field that is not one of those in `architecture/file-formats §2.1`. `plan meta` commands use the same code on PLAN.md (later release).

### §13.3 Output and errors

- Each command returns `{ok, data, findings, warnings}`; `text.ts` prints a short human form (what happened, then details), `json.ts` prints the object. Auto warn adds its line or field (`§6.3`).
- Exit status: 0 success; 1 validation errors or a refused action; 2 usage error; 3 not a git repository or other environment error; 4 internal error. A held action (request sent) exits 0 and says so (assumption).
- Error classes in `errors.ts`: `UsageError`, `NotARepoError`, `GitError`, `FormatError` (carries findings), `PermissionError` (names the permission), `PreconditionError` (lists every reason), `RequestStateError`. Messages state what happened, where, and what to do next.

## §14 Pre-commit and CI checks

Implements `verification R12`, `verification R32`, `verification R36.3`, `configuration R25`.

### §14.1 CI

The earlier generated-index job no longer exists. The CI recipe is a documented command, not a generated workflow: run `specplane validate --json` on the checked-out commit; a non-zero exit fails the job. It reads committed content, needs no permission, no local store and no harness, and writes nothing. `specplane test run --all` may be added by a project; the `deterministic` runnable tests execute in the same temporary checkout and the job fails on `failed`. Neither records results in CI (no role records; assumption).

### §14.2 Pre-commit hooks (later release)

- `specplane check requirement-ids --staged` (setting `pre_commit.duplicate_requirement_ids`, `verification R32`): parses requirement files from the index (`git show :<path>`), reports duplicate IDs naming both places, exits 1 on any; it runs nothing else.
- `specplane check tests --staged` (setting `pre_commit.tests`, `verification R36.3`): finds architecture specs whose files are staged, exports the index to a temporary directory (`git checkout-index --prefix`), runs their deterministic tests there, and exits 1 naming spec and test; never runs intelligent tests, never records results or sets implementation.
- **Install and remove.** `hooks.ts` manages sections in the file at `git rev-parse --git-path hooks/pre-commit`, bounded by `# specplane:begin <check>` and `# specplane:end <check>`; the file is created executable if absent. Turning a setting on inserts its section; off removes only that section and deletes the file if only the shebang remains; other lines are untouched (`verification R32`). `config set` applies it (`§3.2`); validation warns when a setting is on and its section is missing; a person may delete a section by hand without affecting others.

## §15 Later releases

Implements `roles-and-permissions R43`, `roles-and-permissions R49`, `roles-and-permissions R55.1`, `roles-and-permissions R58`, `later-releases R37`, `later-releases R39`, `later-releases R66`, `plan-execution R31.2`, `harness R21`, `harness R38`.

Not built in the first release; each has a defined attachment point:

- **Custom roles, presets, management levels, role mapping, LLM role rules** (`roles-and-permissions R43`, `roles-and-permissions R49`): `roles.ts` reads `.specplane/roles/*.yaml` and `os-users.yaml` (`architecture/file-formats §7.4`) and `guard.ts` resolves the role from them; changes are request records. Nothing else changes in `§7.3`.
- **Strict mode and bypass guards** (`roles-and-permissions R55.1`, `roles-and-permissions R58`): extra checks in the adapters (a pre-edit hook blocking spec writes, an environment marker read by `role` resolution so a recognised LLM session never runs as `standard-user`) and git hooks installed like `§14.2`.
- **Decision records, subprojects, migration** (`later-releases R37`, `later-releases R39`, `later-releases R66`): a `decisions/` module behind `decisions.enabled`; a project registry behind `subprojects` extending the resolver of `§4.3`; the migration prompt is a harness instruction (`§12.3`).
- **Parallelism** (`plan-execution R31.2`): a `step_tasks` read in `plan/next.ts` and an adapter capability; steps still run in order.
- **Viewing and review commands** (`harness R21`, `harness R38`): adapter commands on `spec.retrieve` and the diff routine.
- **Plan metadata through the CLI** and the pre-commit checks of `§14.2`.
