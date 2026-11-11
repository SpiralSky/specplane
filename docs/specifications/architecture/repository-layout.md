---
id: architecture/repository-layout
title: Repository layout
authors:
  - llm: claude-sonnet-5-5
    contribution: drafted
implements: [specifications R7, plans §2, plans R29.2, plan-execution R27, plan-execution §2, plan-execution §3, configuration R25, harness §2]
references: [architecture/file-formats §1.1, architecture/file-formats §1.2, architecture/file-formats §5.1, architecture/file-formats §6, architecture/file-formats §6.1, architecture/file-formats §9.1, architecture/file-formats §10, architecture/file-formats §11.4, architecture/file-formats §12.1, architecture/file-formats §12.3, architecture/file-formats §12.4, architecture/file-formats §5.4, architecture/file-formats §6.2, architecture/file-formats §7.4, steering R22, architecture/reference-cli §12.5, architecture/file-formats §9.3, architecture/reference-cli §14.2, architecture/file-formats, architecture/reference-cli, architecture/file-formats §13, architecture/file-formats §13.4, architecture/reference-cli §5.5]
---

# Repository layout

This spec says where Specplane's files live in a repository, where plan checkouts are created, which files are generated or kept out of git, and how a harness installs its files without touching the project's own. File contents are in `architecture/file-formats`; how the CLI finds and checks these paths is `architecture/reference-cli`. Every path below is a default that the configuration can change (`architecture/file-formats §6.1`); tools always resolve paths from the configuration and never assume one. Details the feature specs leave open are marked "assumption".

## §1 Tracked files in the project

Implements `specifications R7`, `plans §2`, `plans R29.2`, `configuration R25`.

```
<repo-root>/
  .specplane/
    config.yaml                    configuration (architecture/file-formats §6)
  docs/
    requirements/                  paths.requirements: requirement files (central file: paths.requirements_index)
    specifications/
      features/<slug>.md           paths.features: feature specs
      architecture/<slug>.md       paths.architecture: architecture specs
    plans/                         plans.dir
      <plan-id>/                   one folder per plan (architecture/file-formats §5.1)
      archive/<plan-id>/           completed and abandoned plans
      <shared-file>.md             shared plan files (architecture/file-formats §12.3)
    test-logs/<log-id>.log         paths.test_logs, only when tests.logs is git (architecture/file-formats §11.4)
  AGENTS.md, CLAUDE.md, ...        project instruction files; see §5
```

- **Config location.** `.specplane/config.yaml` is at the repository root, is tracked in git, and is the only file in `.specplane/` in the first release (later releases add `roles/*.yaml`, `architecture/file-formats §7.4`). It may be absent; defaults then apply (`architecture/file-formats §6`).
- **Spec roots.** There is one requirements directory, whose central file is found by the rule of `architecture/file-formats §1.2`, and one directory per spec layer, each from `paths.*`. A spec lives directly in its layer directory (`architecture/file-formats §1.1`). The old `spec_roots` list and overlay roots no longer exist; a spec of a subproject lives in that subproject's own layout (later release, `architecture/file-formats §12.4`).
- **Documentation files.** `INFO.md` in a layer directory is documentation and never a spec (`architecture/file-formats §1.1`). Markdown files elsewhere in a spec layer directory, or nested in subfolders, are not specs and are ignored (assumption).
- **Plans.** Plan folders sit directly in `plans.dir`, archived plans in `plans.dir/archive/`. A plan's move to the archive is part of its last commit on the plan branch (`architecture/file-formats §5.1`). No plan folder contains another; the only folder in `plans.dir` that is not a plan is `archive/`. Shared plan files sit directly in `plans.dir` and are cited by path (`architecture/file-formats §12.3`). There is no generated index file of plans; plan lists are computed on demand.
- **Created on demand.** `archive/` and `test-logs/` do not exist until first needed; absence means empty. Tools create them when they first write to them.
- **User documentation.** Specplane's own source repository keeps its user documentation as markdown under `docs/user/` (assumption: the page, `steering R22`, requires it in the repository's docs and from the CLI); the package build copies it to `assets/docs/` (`architecture/reference-cli §12.5`). This is not a path of a project that uses Specplane, which reads the documentation through `specplane docs`.
- **Defaults.** The default paths are the ones in `architecture/file-formats §6.1`. A configured path must be repository-relative, inside the repository and, for `plans.dir` and `paths.*`, must not overlap another configured directory (assumption).

## §2 Local state

Implements `configuration R25`, `plan-execution R27`.

State that is not project content lives under the git common directory, in `<git-common-dir>/specplane/`, as defined in `architecture/file-formats §9.1`: requests, the audit log (`architecture/file-formats §10`), local test logs (`architecture/file-formats §11.4`), the plan-to-worktree map `worktrees.json`, and the run markers, final-review records, instruction-delivery records and role switch of `architecture/file-formats §9.3`, plus a `tmp/` folder for temporary checkouts.

- The git common directory is the main repository's `.git` (found with `git rev-parse --git-common-dir`), so the main checkout and every plan worktree resolve to the same store.
- Nothing here is committed or listed by `git status`, because it is inside the git directory. No `.gitignore` entry is needed for it.
- Approval, status, test and implementation records are not local state and not files: they are git notes under `refs/notes/specplane` in the repository's object store, shared by every worktree and synced by `specplane sync` (`architecture/file-formats §13`). They are never in spec files.
- It is recoverable data. Deleting it loses requests, audit history and local logs, but not the project or any plan record. A missing directory or file is treated as empty and created at the next write.
- Writes use a temp file in the same directory and a rename, so a reader never sees a partial file (assumption). `audit.jsonl` is append-only except for retention pruning (`architecture/file-formats §10`).
- Git operations on the main checkout, such as switching branches or `git gc`, do not touch it. Cloning or copying the repository does not carry it (assumption); the project still works, with empty local state.

## §3 Plan checkouts

Implements `plan-execution R27`, `plan-execution §2`, `plan-execution §3`.

A plan run happens in a separate git worktree on branch `plan/<plan-id>`, so the directory the user works in is never switched (`plan-execution R27`).

```
<plans.worktree_dir>/
  <project-folder>/
    <plan-id>/                full checkout on branch plan/<plan-id>
```

- **Location.** `plans.worktree_dir` defaults to `../specplane-plans`, next to the project (assumption, matching `architecture/file-formats §6`). A relative value is resolved against the main checkout's root, never against a plan worktree. `<project-folder>` is the base name of the main checkout's root directory, so sibling projects do not clash; the default for a project in `/home/u/specplane` is `/home/u/specplane-plans/specplane/<plan-id>`.
- **Outside the project.** A `worktree_dir` that resolves inside the main checkout is a malformed setting and is reported (`architecture/file-formats §6.2`). This keeps plan checkouts out of the project's file listing and out of spec discovery.
- **Creation.** Starting a plan runs `git worktree add -b plan/<plan-id> <path> <target-commit>`, with the commit recorded as the plan's start (`architecture/file-formats §5.4`). The path is recorded in `worktrees.json` (`§2`) after the add succeeds. The setup command (`plans.setup_command`) then runs once in the new directory; if it fails, the worktree and the branch are removed and the start fails (`plan-execution R27`).
- **Untracked files.** A worktree contains only tracked files; ignored and untracked files of the main checkout are absent. Steps do not assume them (`plan-execution R27`).
- **Which checkout holds which file.** The plan folder is tracked and changes on the plan branch, so the copy in the plan worktree is the live one while the plan runs. Local state is shared (`§2`). `.specplane/config.yaml` is read from the checkout the command runs in.
- **Finding a plan's checkout.** The recorded path in `worktrees.json` is checked against `git worktree list --porcelain`; git's list wins when they disagree, and an entry whose directory is gone is dropped (assumption).
- **Removal.** After the plan's branch is merged, or the plan is abandoned or deleted, `git worktree remove` deletes the directory. It is refused while the worktree has uncommitted changes unless the user says to force it (`plan-execution §3`). The branch is deleted after a merge and kept after abandonment (`plan-execution §2`, `plan-execution §3`). Empty `<project-folder>` directories are removed with the last plan checkout (assumption).
- **No registration for other worktrees.** Other worktrees and branches the user creates are ordinary git and need no Specplane record.

## §4 Generated and ignored files

Implements `plan-execution R27`, `configuration R25`.

| Path | Tracked | Written by |
|------|---------|------------|
| `<git-common-dir>/specplane/**` | no (inside the git directory) | CLI and harness actions (`§2`) |
| `<plans.worktree_dir>/**` | no (outside the repository) | plan start and cleanup (`§3`) |
| `refs/notes/specplane` | no file; a git ref, synced by `specplane sync` (`architecture/file-formats §13.4`) | approve, reopen, override, test and implement commands (`architecture/reference-cli §5.5`) |
| `<paths.test_logs>/*.log` | yes, only with `tests.logs: git` | test runs (`architecture/file-formats §11.4`) |
| harness block and files | yes | harness setup (`§5`) |

- **Nothing generated is tracked.** Specplane does not commit a generated index or summary. Everything tracked in `.specplane/`, `docs/` and the harness files is either written by a person or by an explicit command the user ran.
- **Records are not files.** Specplane never writes a tracked file for them and creates no branch commit when it records one.
- **No `.gitignore` edits.** The first release adds nothing to `.gitignore` or `.gitattributes`, because local state and worktrees are outside the working tree.
- **Plan folders are normal files.** They are ordinary markdown and YAML, edited by tools and by people alike; they are not generated, so a merge conflict in one is resolved by hand like any other file.

## §5 Harness-installed files

Implements `harness §2`.

A harness setup installs only what its harness needs. The files fall in three groups, and each is changed only the way its group allows.

- **Owned files.** Files Specplane owns outright, such as a rules file, a skill or command folder, or a hook script in the harness's own directory (for example `.claude/`). Setup creates or replaces them; each carries a header naming the Specplane version that wrote it (assumption). A project may commit them or ignore them, as it chooses.
- **Marked block in a shared file.** Where the harness has no place Specplane owns, standing instructions go in one block inside a shared instruction file such as `AGENTS.md`. The block is bounded by two comment lines (assumption, the form used by the current installer):

  ```
  <!-- specplane:begin v<N> — managed by `specplane init`; edits inside this block are overwritten -->
  ...
  <!-- specplane:end -->
  ```

  Setup adds the block once, at the end of the file if there is none, and later updates replace only the text between the markers. Text outside the markers is never read for changes, reordered or rewritten. The file is created if absent. If a begin marker has no end marker, or the markers appear more than once, setup stops with an error naming the file and changes nothing.
- **Opt out.** A project may forbid the block with `harness.install_block: off` (assumption, `architecture/file-formats §6.1`). Its maintainers' own files, such as a hand-written `CLAUDE.md` that Specplane never ships, are then left alone.
- **Two harnesses.** Two harnesses installed in one project share one block per file; the text is the same and neither setup removes the other's files (`harness §2`).
- **Staleness.** The version in the begin marker, compared to the installed Specplane, is how a missing or older delivery is detected and warned about (`harness §2`).
- **Not spec roots.** Harness directories are not spec roots and are ignored by spec discovery.

## §6 File naming constraints

Implements `specifications R7`, `plans §2`.

The identifier forms are in `architecture/file-formats §12.1`; this section only adds what is about the file system.

- Names of files Specplane creates from an identifier (specs, steps, requests, logs) use lower-case ASCII letters, digits and hyphens, with `.md`, `.yaml`, `.json`, `.jsonl` or `.log` as the only extensions; no spaces, no dots in a slug, no leading hyphen (`architecture/file-formats §1.1`). The fixed names `PLAN.md`, `HANDOFF.md`, `INFO.md` and the instruction files (`AGENTS.md`, `CLAUDE.md`) are the exception and keep their upper-case form.
- A plan folder name is its plan ID, a step file is `NN-<slug>.md`, a log is `<log-id>.log`; the names are derived from the ID and may not be renamed by hand (`architecture/file-formats §12.1`).
- Names compare byte for byte, but two names that differ only in case are a collision and reported, since the project may be used on a case-insensitive file system (assumption).
- Total path length of a plan checkout file stays under 200 characters (assumption). A plan ID is limited to 64 characters (`architecture/file-formats §5.1`), and plan creation also rejects an ID whose longest checkout path, with the configured `plans.worktree_dir`, would exceed the limit, so the checkout path works on all platforms.
- A symbolic link in a spec layer directory, plan folder or the `.specplane/` folder is not followed and is reported (assumption).

## §7 Invariants

Implements `specifications R7`, `plan-execution R27`.

- Paths come only from the configuration or the defaults; no tool hard-codes a location.
- Every path Specplane writes is inside the repository, inside `plans.worktree_dir`, or inside `<git-common-dir>/specplane/`, with two further exceptions, the ref `refs/notes/specplane` and the pre-commit hook file: the hook file at `git rev-parse --git-path hooks/pre-commit`, which may lie outside the working tree when `core.hooksPath` is set (`architecture/reference-cli §14.2`, later release). Temporary checkouts go under `<git-common-dir>/specplane/tmp/`, not a system temp directory. It writes nowhere else.
- The main checkout's branch and files are unchanged by starting, running or removing a plan.
- A plan has at most one worktree, and a worktree belongs to exactly one plan; two runs never share one (`plan-execution R27`).
- Local state is never committed. Tracked files never contain absolute paths, user names or machine-specific values that Specplane wrote (assumption).
- Missing optional locations (`archive/`, `test-logs/`, local store, the config file) mean empty or default, never an error.
- Edits by Specplane to a shared instruction file change only the marked block (`§5`).
