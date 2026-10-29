---
id: architecture/reference-cli
title: "Reference CLI: module structure, parsing, git integration, validation engine, and plan flows"
status: approved
author: llm
implements: [feature/tooling, feature/plan-execution, feature/plan-index, feature/configuration]
---

# Reference CLI: module structure, parsing, git integration, validation engine, and plan flows

The reference CLI (`specplane`) is a TypeScript command-line tool distributed via npm. It is one implementation of the behaviour defined in `feature/tooling`. The language and distribution choice is recorded in `decision/0002`.

---

## Technology choices

- **Language**: TypeScript (Node.js ≥ 18). See `decision/0002`.
- **Package manager**: npm.
- **Distribution**: npm package `specplane` (OQ-1, resolved).
- **YAML parsing**: `js-yaml` (battle-tested, MIT, no dependencies).
- **Markdown parsing**: `gray-matter` for frontmatter extraction; body is treated as opaque text for most operations.
- **JSON Schema validation**: `ajv` (AJV v8) with `ajv-formats` (for the ADR `date` field).
- **Git integration**: the `git` CLI, invoked without a shell (universally available; avoids large native bindings).
- **Forge integration**: the `gh` CLI for GitHub, invoked without a shell.
- **CLI framework**: `commander` for command routing, options parsing, and help text.
- **Mermaid output**: string template (no runtime Mermaid dependency needed; the CLI emits Mermaid source).

The CLI performs only deterministic checks. It never calls an LLM; LLM review stages are run by agents (see `architecture/agent-skills` § validate).

---

## Module structure

```
src/
  cli.ts               # entry point; registers all commands via commander
  config.ts            # reads and validates .specplane/config.yaml; exports Config type
  spec/
    resolve.ts         # resolves spec IDs to file paths via config roots
    parse.ts           # reads and validates spec frontmatter
    validate.ts        # runs all spec validation checks
    leak-guard.ts      # architecture-leak heuristic checks
    pins.ts            # based_on pins: stale check, normalised hashing, frontmatter rewrite, anchors
    slug.ts            # GitHub-style heading slugs
    overlay-check.ts   # overlay contradiction heuristics
  plan/
    resolve.ts         # resolves plan IDs to folder paths (active or archived)
    parse.ts           # reads and validates PLAN.md and step frontmatter
    validate.ts        # plan- and step-level validation rules
    status.ts          # computes index and effective plan status
    graph.ts           # builds the dependency graph; detects cycles
    flows.ts           # start, finish, abandon, cleanup, archive, restack
  decisions/
    parse.ts           # reads ADR frontmatter
    validate.ts        # ADR validation rules
  git/
    exec.ts            # runs git/gh without a shell; throws GitError
    repo.ts            # repository roots (checkout root, main checkout root)
    branch.ts          # branch existence, creation, deletion, rebase
    worktree.ts        # worktree path resolution, creation, removal
    forge.ts           # optional: PR creation and open-PR detection
    blobs.ts           # blob hashes of committed files; blob contents
    commit.ts          # builds commit messages and reads trailers (file-formats §8)
  agents/
    standing.ts        # standing-instructions text and the AGENTS.md managed block
  generate/
    plans-md.ts        # generates PLANS.md
    mermaid.ts         # generates Mermaid dependency graph
  commands/
    init.ts
    spec.ts            # spec new | list | show | validate | pin
    plan.ts            # plan new | list | show | graph | start | finish | abandon | cleanup | archive
    search.ts
    validate.ts
    generate.ts
  output/
    human.ts           # human-readable output formatting
    json.ts            # JSON output formatting
  errors.ts            # typed error classes
  types.ts             # shared TypeScript types for specs, plans, steps, ADRs, config
```

---

## Repository roots (`git/repo.ts`)

Two roots are distinguished (see `feature/configuration` § Edge cases):

- `checkoutRoot()` — the root of the checkout the command runs in: `git rev-parse --show-toplevel`. Config, specs, plans, and ADRs are read relative to this root, so a command run inside a plan worktree sees that branch's files.
- `mainRoot()` — the root of the main checkout: the parent directory of `git rev-parse --path-format=absolute --git-common-dir`. Used only for `execution.worktree_dir` and `<repo-name>`, so every worktree of a repository computes the same worktree paths.

Outside a git repository both throw `NotARepoError`.

The default branch is `origin/HEAD` if set, otherwise `main`, otherwise `master`.

---

## Config loading (`config.ts`)

`loadConfig(root: string): { config: Config, warnings: Warning[] }`

1. Read `<checkoutRoot>/.specplane/config.yaml` if it exists; otherwise use `DEFAULT_CONFIG` and emit the "No `.specplane/config.yaml` found; using defaults." warning.
2. Validate against the JSON Schema in `architecture/file-formats` §7.1 with AJV (`allErrors: true`).
3. Map violations per §7.2: `additionalProperties` violations become "Unknown config key" warnings and the keys are dropped; all other violations throw `ConfigError`.
4. Check cross-field rules (duplicate root names, undeclared or cyclic root `extends`, `worktree_dir` inside the main checkout); violations throw `ConfigError`.
5. Deep-merge with `DEFAULT_CONFIG` (arrays replace, objects merge).

Malformed YAML throws `ConfigError`. The CLI catches `ConfigError` at the command level, prints it to stderr, and exits 1.

---

## Spec resolution (`spec/resolve.ts`)

`resolveSpecId(id: string, config: Config, fromRoot?: string): ResolvedSpec` → `{ root, id, path }`

Type directory mapping (never computed by pluralising): `feature` → `features/`, `architecture` → `architecture/`. Path: `<root.path>/<typeDir>/<slug>.md`.

1. Strip any `#anchor` (handled by callers that need it).
2. Qualified ID (`<root>:<type>/<slug>`): unknown root → `UnknownRootError`; otherwise look in that root only.
3. Unqualified with `fromRoot` (references inside a spec): search `fromRoot`, then each root along its `extends` chain; return the first hit.
4. Unqualified without `fromRoot` (plans, steps, ADRs, CLI arguments): search all roots; one hit → return it; several → `AmbiguousIdError` listing the roots.
5. No hit → `SpecNotFoundError`.

Shadowing is prevented by validation (see below), so step 3 never has to choose between two hits.

`findHeading(body: string, anchor: string): Section | null` implements the step-context anchor rule from `architecture/file-formats` §3.2.

---

## Spec parsing (`spec/parse.ts`)

`parseSpec(filePath: string): { frontmatter: SpecFrontmatter, body: string }`

1. Read the file.
2. Extract frontmatter with `gray-matter`. A file without a frontmatter block throws `FrontmatterMissingError`; YAML that fails to parse throws `FrontmatterError`.
3. Validate against the common frontmatter schema, then the type-specific addition (feature or architecture), using AJV.
4. Return the typed frontmatter and body.

`INFO.md` files (exact, case-sensitive name) at `features/INFO.md` or `architecture/INFO.md` are not parsed as specs. One that starts with a `---` frontmatter block is an error (type `schema`; message in `feature/spec-system` Scenario 7, OQ-10).

---

## Spec validation (`spec/validate.ts`)

`validateSpec(spec, filePath, root, config): ValidationResult`

1. ID matches path-derived ID.
2. If `allow_architecture: true`, `architecture_reason` must be non-empty.
3. Architecture spec: all `implements` IDs resolve (`fromRoot` = the spec's root).
4. `supersedes` IDs resolve.
5. `extends`: error if the spec's root is standalone; the referenced spec must resolve within the root's extends chain.
6. Shadowing: error if the spec's ID also exists in any root of its root's extends chain.
7. Authorship consistency (warnings) per `feature/spec-policies` §1.
8. `extends` is a string or list; each entry is checked as in 5. `based_on` keys must appear in `extends` or `implements` (error otherwise). Pins are checked per § Base pins.
9. Anchors: for each ID carrying `#<slug>`, the slug must match a heading slug in the referenced spec → warning type `anchor`.

`validateSpecs(config, root): ValidationReport` runs `validateSpec` on every spec in every root, then:

- **Ordering policy**: if `specs.architecture.require_approved_features`, each `approved` architecture spec whose `implements` contains a non-approved spec → error "Cannot approve `<arch>`: `<feature>` is `<status>`, not `<approved>`."
- **Leak guard**: on feature specs when `specs.feature.forbid_architecture` and the spec does not set `allow_architecture`.
- **Overlay contradiction heuristics** (`spec/overlay-check.ts`): for each spec with `extends`, compare sentences containing "must not"/"never"/"may not" in either spec against sentences in the other that share at least two significant nouns; each match is a warning "may contradict". No LLM is involved.

---

## Base pins (`spec/pins.ts`, `git/blobs.ts`, `spec/slug.ts`)

`git/blobs.ts`:

- `committedBlob(path, ref = 'HEAD'): string | null` — `git rev-parse <ref>:<path>`; null if the path is not committed.
- `hasUncommittedChanges(path): boolean` — `git status --porcelain -- <path>`.
- `readBlob(hash): string | null` — `git cat-file -p <hash>`; null if the object is missing (shallow clone).

`spec/slug.ts`: `slugify(heading)` follows GitHub: lowercase, remove characters other than letters, digits, spaces, hyphens, and underscores, spaces to hyphens; `headingSlugs(markdown)` returns the slugs of a document with `-1`, `-2` suffixes for duplicates. Fenced code blocks are skipped.

`spec/pins.ts`:

- `normalisedHash(text)` — hash of the spec text with frontmatter `status:` and `author:` lines removed, so changes that only touch those keys are not base changes.
- `checkPins(spec, config): Finding[]` — for each `based_on` entry, compare the pin with the current committed blob. If equal, fine. Otherwise read both blobs: if the pinned object is missing, warn without a diff (the hash comparison itself never needs history); if both normalise to the same hash, ignore. Else emit `base-changed` with the message in `architecture/file-formats` §1.5. Missing pins follow `specs.pin_bases`.
- `approveGuard`: a spec with a stale pin that is `approved` → error "Cannot approve `<id>`: base `<ref>` changed since it was pinned."
- `writePins(file, pins)` — rewrites only the `based_on` key in the frontmatter, preserving other formatting and key order; inserts the key after `extends`/`implements` when absent.

Uncommitted edits to a base are compared as-is for the check (working tree) but `spec pin` refuses them.

### `spec pin`

- `specplane spec pin <id> [<ref-id>...]` — set pins for all of the spec's `extends` and `implements` entries, or only the listed ones, to `committedBlob` of each referenced file (abbreviated to 7+ characters, longer if ambiguous). Errors if a referenced file has uncommitted changes ("commit or stash changes to `<path>` first"). Prints `pinned <ref> <hash>` per entry.
- `specplane spec pin --check` — runs the pin checks only; exit 1 if any pin is stale or missing under `require`.

## Skill contract drift (`spec/skill-drift.ts`)

For each `SKILL.md` in a skill directory registered by an installed harness, parse the `<!-- specplane-contract: ... -->` comment; the anchor must resolve (type `skill-drift` warning otherwise) and the pin is compared against the current blob of the referenced spec exactly as for `based_on` (normalised hash; shallow-safe). Skill directories without a comment warn.

---

## Architecture-leak guard (`spec/leak-guard.ts`)

`checkArchitectureLeak(body: string, allow: string[]): Warning[]`

Preprocessing: remove fenced code blocks (three or more backticks or tildes); remove Markdown link targets (`](...)`); remove every term in `allow`, where `allow` = `specs.feature.leak_guard_allow` + the built-in list of Specplane names (all config keys and frontmatter field names from `architecture/file-formats`, plus `.specplane/config.yaml`, `PLAN.md`, `PLANS.md`, `HANDOFF.md`, `AGENTS.md`, `INFO.md`). Inline code spans are kept and checked.

Heuristics (each match → warning):

1. **Paths**: `(?<![\w/])(?:\.{1,2}/|/)?[\w.-]+(?:/[\w.-]+)+\.[a-z0-9]{1,5}\b` (at least one `/` and an extension, e.g. `src/foo.ts`, `/src/foo.ts`, `./a/b.py`), plus `(?<![\w/])\.?/?[\w.-]+/[\w./-]*/(?=\s|$|[`)])` for directory paths ending in `/`.
2. **Technology names**: case-insensitive whole-word match against a built-in list (TypeScript, JavaScript, Python, Go, Rust, Java, C++, C#, Ruby, PHP, SQLite, PostgreSQL, MySQL, MongoDB, Redis, React, Vue, Angular, Express, FastAPI, Django, Next.js, npm, pip, cargo, Docker, Kubernetes).
3. **Code identifiers**: `\b[a-z]+(?:[A-Z][a-z0-9]+)+\b` (camelCase), `\b(?:[A-Z][a-z0-9]+){2,}\b` (PascalCase with two or more words), `\b[a-z0-9]+(?:_[a-z0-9]+)+\b` (snake_case), `\$\w+`, and `\w+\(\)`.
4. **Schema syntax**: lines matching `^\s*(?:type|\$ref|properties|required):` outside code blocks.

Each warning includes `type` (`path`, `tech_name`, `identifier`, `schema_syntax`), `line`, `match`, `message`.

---

## Plan parsing and validation (`plan/parse.ts`, `plan/validate.ts`)

`listPlans(config, root): PlanRecord[]` — every `<plans.dir>/<id>/PLAN.md` and `<plans.dir>/archive/<id>/PLAN.md`; `archived` is set accordingly.

`parsePlan(planDir)` validates PLAN.md against `architecture/file-formats` §2.1 and checks `id` equals the folder name. `parseStep(stepFile)` validates against §3.1 and checks `step` equals the numeric filename prefix and `plan` equals the plan ID.

`validatePlans(plans, specs, adrs, config): ValidationReport`

- `in_progress`/`review` stored while `status_source: git` → warning.
- Dangling `depends_on` → error; dependency on an `abandoned` plan → error; cycles (via `graph.ts`) → error.
- `specs` entries resolve (no root context) → error if not; deprecated → warning.
- Steps: contiguous numbering from 1; `context` references (`spec` with anchor, `decision`, `file`) per §3.2; `skipped`/`blocked` steps have a HANDOFF.md section with the matching `**Outcome**`.

---

## ADR validation (`decisions/`)

`listAdrs(config, root)` reads `<decisions.dir>/NNNN-*.md` (absent directory = no ADRs). `validateAdrs` applies `architecture/file-formats` §6.2: ID–filename match, duplicate numbers (error), `superseded_by` consistency (error), unresolved `related_specs` (warning).

---

## Plan status (`plan/status.ts`)

`getIndexStatus(plan, plansById, config): IndexStatus` — used by `generate`. Reads only committed files:

1. If stored status is not `ready`: return it.
2. If `dependency_mode: wait_for_merge` and any `depends_on` plan is not `done`: return `blocked`.
3. Return `ready`.

`getEffectiveStatus(plan, plansById, config, git): EffectiveStatus` — used by `plan list`, `plan show`, and `generate --print --live`:

1. Compute the index status. If it is not `ready`, return it.
2. If `status_source: frontmatter`: return `ready`.
3. If branch `plan/<id>` exists locally or as `refs/remotes/origin/plan/<id>`: if the forge reports an open PR for it, return `review`; otherwise return `in_progress`.
4. Return `ready`.

Remote branches are read from already-fetched remote-tracking refs; status queries never touch the network except for the forge PR lookup.

---

## Dependency graph (`plan/graph.ts`)

`buildGraph(plans: PlanRecord[]): DirectedGraph` — adjacency list from `depends_on` links.

`detectCycle(graph): string[] | null` — depth-first search with three-colour marking (white/grey/black). Returns the cycle path if found, or `null`.

`toMermaid(graph, statuses: Map<string, Status>): string` — emits Mermaid per `architecture/file-formats` §5.2 (node key `p_<id with - → _>`, label = slug, deterministic ordering, all `classDef` lines).

---

## PLANS.md generation (`generate/plans-md.ts`)

`generatePlansMd(config, root, { live: boolean }): string` builds the file in `architecture/file-formats` §5.1 using index statuses (or effective statuses when `live`). `specplane generate` writes `<plans.dir>/PLANS.md` only when the content differs. Freshness validation compares the committed file with `generatePlansMd(..., { live: false })` byte-for-byte.

---

## Git and forge integration (`git/`)

### `exec.ts`

All git and gh calls go through `run(cmd: 'git' | 'gh', args: string[], opts: { cwd: string }): string`, implemented with `child_process.execFileSync` and an argument array — never a shell string — so plan titles, PR bodies, and paths cannot inject shell syntax. A non-zero exit throws `GitError` with the command and stderr.

### `branch.ts`

- `branchExists(name)` — `git show-ref --verify --quiet refs/heads/<name>`
- `remoteBranchExists(name)` — `git show-ref --verify --quiet refs/remotes/origin/<name>`
- `createBranch(name, from)` — `git branch <name> <from>` (does not switch any checkout)
- `deleteBranch(name)` — `git branch -D <name>`; callers check the deletion precondition (plan `done` on the default branch)
- `rebaseOnto(newBase, upstream, branch)` — `git rebase --onto <newBase> <upstream> <branch>`; on conflict, runs `git rebase --abort` and throws `RebaseConflictError`

### `worktree.ts`

- `worktreePath(planId, config)` — `resolve(mainRoot(), config.execution.worktree_dir, basename(mainRoot()), planId)`
- `createWorktree(planId, branch, config)` — `git worktree add <path> <branch>`; returns the path. Reuses an existing worktree for the same branch.
- `removeWorktree(planId, config, { force })` — `git worktree remove <path>`; adds `--force` only when `force` is set. Without it, a dirty worktree makes git fail and the error is reported, so uncommitted work is never discarded silently.

### `forge.ts`

Selected by `plans.forge`. With `auto`, GitHub is used when the `origin` remote points to GitHub and `gh` is on `PATH`; otherwise forge calls return `null`. With `github`, unavailability throws `ForgeError`. With `none`, all calls return `null`.

- `createPR(branch, base, title, body): string | null` — `gh pr create --head <branch> --base <base> --title <title> --body <body>`; returns the PR URL.
- `getOpenPR(branch): string | null` — `gh pr list --head <branch> --state open --json url`.

### `commit.ts`

Implements `architecture/file-formats` §8.

- `formatMessage({ type, scope, summary, body?, trailers }): string` — subject, optional body, then one trailer paragraph in §8.2 order. Throws `CommitFormatError` if the subject exceeds 72 characters (the caller shortens the summary, never the plan ID in trailers), except for CLI housekeeping subjects (`chore(specplane): …`), which are exempt (§8.1).
- `cliTrailers(workflow, planId): Trailers` — `Specplane-Workflow` and `Specplane-Plan`, plus `Specplane-Agent` from `$SPECPLANE_AGENT` and `Specplane-Session` from `$SPECPLANE_SESSION` when set and non-empty. Harnesses set these variables for agent sessions (for Claude Code, see `claude:architecture/claude-integration` § Session context); a human running the CLI by hand gets neither.
- `readTrailers(ref): Map<string, string>` — `git log -1 --format=%(trailers:only,unfold) <ref>`, parsed with `git interpret-trailers --parse` semantics (last value wins for repeated keys).
- `findLatest(branch, workflow): sha | null` — `git log --format=%H%x00%(trailers:key=Specplane-Workflow,valueonly) <branch>`, first match.

Every commit made by `plan/flows.ts` goes through `formatMessage`; empty commits use `git commit-tree -F -` with the message on stdin.

---

## Plan flows (`plan/flows.ts`)

These implement `feature/plan-execution`. Every flow validates everything it needs before its first write, so a failed check leaves no partial state.

### Start

1. `git fetch origin <default>` (skipped when there is no remote).
2. Load the plan from the default branch's tip (`git show <default>:<path>`), so the main checkout's working state does not matter. First start = `!branchExists('plan/<id>') && !remoteBranchExists('plan/<id>')`.
3. First start: check dependencies (wait-for-merge, or the stacking rule) and `require_approved_specs`, resolving each spec without root context.
4. Frontmatter mode, first start: claim commit (see below) setting `in_progress`.
5. First start: `createBranch('plan/<id>', base)`, where `base` is the default branch tip, or the tip of `plan/<base-id>` when stacking. When stacking, the marker commit is created without touching any checkout: `git commit-tree <base>^{tree} -p <base> -F -` with message `chore(specplane): stack <id> on <base-id>` and trailers `Specplane-Workflow: stack`, `Specplane-Plan: <id>`, `Specplane-Stack-Base: <base sha>`, and the new branch points at that commit instead. On resume, a remote-only branch is first tracked locally (`git branch --track plan/<id> origin/plan/<id>`).
6. Check out per backend. Worktree: `createWorktree`, then run `setup_hook` via the user's shell (`sh -c` / `cmd /c`) with `cwd` = the worktree; on failure `removeWorktree(..., { force: true })` (the worktree is fresh, so nothing is lost) and throw `SetupHookError`. Branch: require `git status --porcelain` to be empty, then `git switch plan/<id>`.

### Claim commits (frontmatter mode)

A claim commit must land on the default branch without disturbing anyone's checkout. It is made in the main checkout and requires that checkout to be on the default branch with no changes to the plan's `PLAN.md`; otherwise the flow stops with instructions. It edits only the `status:` line, commits `chore(specplane): claim <id> <status>` (`Specplane-Workflow: claim`), and pushes when a remote exists.

### Finish

Runs in the plan's checkout. Steps follow `feature/plan-execution` § Finish flow:

1. Check the branch, a clean `git status --porcelain`, all steps `done`/`skipped`, and (when stacked) the base plan is `done` on the default branch.
2. Run `test_command` (shell, `cwd` = checkout); present acceptance criteria.
3. Frontmatter mode: claim `review`.
4. Fetch; if stacked, `rebaseOnto(<default>, <latest marker sha>, 'plan/<id>')`; else `git rebase <default>`. A conflict throws `RebaseConflictError` (the rebase is aborted, leaving the branch unchanged). Re-run tests if the rebase applied new commits.
5. Final commit: set `status: done`; if `archive_done`, `git mv <plans.dir>/<id> <plans.dir>/archive/<id>`; commit `chore(specplane): finish <id>` (`Specplane-Workflow: finish`).
6. `pull_request`: `git push -u origin plan/<id>`, then `createPR` (or print instructions when it returns `null`). `local_merge`: ask for confirmation, then in the main checkout `git merge --no-ff plan/<id>`.
7. After a local merge, run cleanup.

### Cleanup, abandon, archive

- `cleanup(id)`: remove the worktree (or switch the branch-backend checkout back to the default branch); delete `plan/<id>` only if the plan's `PLAN.md` on the default branch has `status: done`. Each part is skipped if already done.
- `abandon(id, { deleteBranch, force })`: edit `PLAN.md` on the default branch to `abandoned`, `git mv` to archive if `archive_done`, commit `chore(specplane): abandon <id>` (`Specplane-Workflow: abandon`) in the main checkout (same preconditions as a claim commit); remove the worktree; delete the branch only if requested.
- `archive(id)`: for a `done` or `abandoned` plan not yet archived, `git mv` it to the archive and commit `chore(specplane): archive <id>` (`Specplane-Workflow: archive`) in the current checkout.

### Restack

`restack(id)`: find the newest marker commit on `plan/<id>` (`findLatest('plan/<id>', 'stack')`), take its `Specplane-Stack-Base` trailer as `upstream`, and call `rebaseOnto(newBase, upstream, 'plan/<id>')`, where `newBase` is the default branch if the base plan is done, else `plan/<base-id>`. In the latter case, append a new marker recording the new base tip.

### Plan activity (`plan list --json`)

Harness live views (for example `claude:architecture/claude-integration` § Live view) read plan activity from `specplane plan list --json --live` instead of parsing git themselves. Each plan object adds:

| Field | Source |
|-------|--------|
| `branch` | `plan/<id>` if it exists locally or on `origin`, else `null` |
| `checkout` | worktree path from `git worktree list --porcelain`, else `null` (branch-only, remote-only, or external) |
| `steps` | `{ total, done, skipped, blocked, next }` from the step files at the branch tip (`git show <branch>:<path>`), else from the default branch; `next` is `{ number, title, status }` or `null` |
| `blocked_issues` | `BLOCKED:` lines from HANDOFF.md at the branch tip |
| `last_step_commit` | newest commit on the branch with `Specplane-Workflow: step`: `{ sha, time, step, agent, session }` from its trailers, else `null` |
| `ahead_of_remote` | commits on the local branch not on `origin/plan/<id>` (`null` without a remote branch) |

`--live` fetches `origin` at most once per invocation (`git fetch --quiet origin 'refs/heads/plan/*:refs/remotes/origin/plan/*'`), skipped with `--no-fetch` or when there is no remote. Without `--live`, these fields come from local refs only.

## Standing instructions (`agents/standing.ts`)

Implements `architecture/agent-skills` § Standing instructions.

- `STANDING_VERSION = 'v1'` and `standingText(workflowsLine)`: the canonical text; the base uses the harness-neutral Workflows line.
- `upsertBlock(content: string | null): { content, action: 'created' | 'appended' | 'updated' | 'unchanged' | 'malformed' }`: markers are matched as `<!-- specplane:begin v<N>` … `-->` and `<!-- specplane:end -->` on their own lines. Line endings in the existing file are preserved.
- `init` writes `AGENTS.md` through `upsertBlock` and reports `Created`, `Updated` (appended or replaced), `Unchanged`, or `Skipped AGENTS.md (malformed specplane block; fix the markers by hand)`.
- `validate` warns (type `freshness`) when no file in the repository root delivers the block (`AGENTS.md`, or a harness file registered by an installed harness), when a block's version is older than `STANDING_VERSION`, when its text differs from `standingText` (with the harness's Workflows line), or when it is malformed. Message: `Specplane standing instructions in <file> are missing or out of date; run specplane init.`

---

## Validation output format

### Human-readable

```
Checking feature/spec-system... OK
Checking feature/plan-system... 1 warning
  [warning] feature/plan-system:42: Possible architecture detail (tech_name): "TypeScript"
Checking architecture/reference-cli... OK

Summary: 3 files checked, 0 errors, 1 warning
```

### JSON (`--json`)

```json
{
  "valid": true,
  "errors": [],
  "warnings": [
    {
      "file": "docs/specifications/features/plan-system.md",
      "spec": "feature/plan-system",
      "line": 42,
      "message": "Possible architecture detail (tech_name): \"TypeScript\"",
      "severity": "warning",
      "type": "tech_name"
    }
  ]
}
```

Every finding has `file`, `message`, `severity`, and `type`; `spec` (or `plan`, `adr`) and `line` are present when applicable. `type` values: `config`, `schema`, `id`, `reference`, `authorship`, `ordering`, `path`, `tech_name`, `identifier`, `schema_syntax`, `overlay`, `base-changed`, `pin`, `anchor`, `skill-drift`, `plan`, `step`, `adr`, `freshness`.

Exit code is `0` when `valid: true` (warnings do not affect exit code). Exit code `1` when `valid: false`.

---

## Error classes (`errors.ts`)

| Class | Message pattern | Exit code |
|-------|----------------|-----------|
| `ConfigError` | "Config key `<key>`: <reason>" | 1 |
| `UnknownRootError` | "Unknown root `<name>`" | 1 |
| `SpecNotFoundError` | "Spec `<id>` not found" | 1 |
| `AmbiguousIdError` | "Ambiguous ID `<id>`: found in roots `<a>`, `<b>`. Use `<root>:<id>`." | 1 |
| `FrontmatterError` | "`<file>`: <schema violation>" | 1 |
| `FrontmatterMissingError` | "`<file>`: no frontmatter block found" | 1 |
| `PlanNotFoundError` | "Plan `<id>` not found" | 1 |
| `PlanStateError` | "Cannot <action> plan `<id>`: <reason>" (e.g. step not done, dependency not done) | 1 |
| `DependencyCycleError` | "Dependency cycle: `<a>` → `<b>` → `<a>`" | 1 |
| `SetupHookError` | "Setup hook failed: `<cmd>` exited with code <n>. Worktree removed." | 1 |
| `RebaseConflictError` | "Rebase of `plan/<id>` onto `<base>` has conflicts; resolve manually." | 1 |
| `ForgeError` | "Forge operation failed: <reason>" | 2 |
| `GitError` | "Git command failed: `<cmd>`: <stderr>" | 2 |
| `NotARepoError` | "Not in a git repository" | 1 |
