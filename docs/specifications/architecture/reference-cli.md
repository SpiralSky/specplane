---
id: architecture/reference-cli
title: "Reference CLI: module structure, parsing, git integration, validation engine, and plan flows"
status: approved
author: llm
implements: [feature/tooling, feature/plan-execution, feature/plan-index, feature/configuration]
---

# Reference CLI: module structure, parsing, git integration, validation engine, and plan flows

The reference CLI (`specplane`) is a TypeScript command-line tool distributed via npm. It is one implementation of the behaviour defined in `feature/tooling`. The language and distribution choice is recorded in `decision/0004` (which supersedes `decision/0002`).

---

## Technology choices

- **Language**: TypeScript (Node.js ≥ 22). See `decision/0004`.
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
    gaps.ts            # parses and validates a plan's spec-gaps.md
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
  harness/             # implemented by the harness plan, not the plan-flows plan
    index.ts           # harness registry: detect, install, skillDirs, rulesFile
    claude.ts          # Claude Code harness (templates, settings merge)
  generate/
    plans-md.ts        # generates PLANS.md
    mermaid.ts         # generates Mermaid dependency graph
  commands/
    init.ts
    spec.ts            # spec new | list | show | validate | pin | approve | reopen
    plan.ts            # plan new | list | show | graph | start | finish | approve | abandon | cleanup | archive | restack
    decision.ts        # decision new | accept
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
4. Check cross-field rules (duplicate root names, undeclared or cyclic root `extends`, spec root paths, `worktree_dir` inside the main checkout); violations throw `ConfigError`. Texts are those of `feature/configuration` § Acceptance scenarios:
   - Spec root paths, checked in this order: an absolute `path`, or one that `path.resolve(root, path)` places outside `root` → "Spec root `<name>`: path `<path>` is outside the repository."; a missing path → "Spec root `<name>`: path `<path>` does not exist."; an existing non-directory → "Spec root `<name>`: path `<path>` is not a directory." Paths are checked against the checkout root, without following symlinks.
   - `worktree_dir`: only when `execution.backend` is `worktree`, a `worktree_dir` that resolves (against `mainRoot()`) to the main checkout root or a path inside it → "`execution.worktree_dir` must be outside the repository. `<worktree_dir>` resolves to `<absolute path>` inside it." With the `branch` or `external` backend the value is not checked.
   - The spec-root path checks are skipped when `loadConfig` is called with `checkSpecRoots: false`. Only `init` does this, because it creates the spec roots in step 2 and must work in a clean repository; every other caller keeps the checks.
5. Deep-merge with `DEFAULT_CONFIG` (arrays replace, objects merge).

`DEFAULT_CONFIG` is a literal copy of the defaults in the "Full schema with defaults" table of `feature/configuration`, with no value computed or invented in code. A test must parse that table (or a fixture generated from it) and assert deep equality with `DEFAULT_CONFIG`, so the two cannot drift.

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
10. Deprecated references: each `implements` or `extends` entry that resolves to a spec with `status: deprecated` → warning type `reference`, message "`<id>` references deprecated spec `<ref>`."

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

For each `SKILL.md` in a skill directory registered by an installed harness, parse the `<!-- specplane-contract: ... -->` comment; the anchor must resolve (type `skill-drift` warning otherwise) and the pin is compared against the current blob of the referenced spec exactly as for `based_on` (normalised hash; shallow-safe). Skill directories without a comment warn. The directories come from the harness registry (`src/harness/index.ts`): each harness entry exposes `skillDirs(root): string[]`, returning the skill directories it installs (for Claude Code, `.claude/skills/*`); the `skillDirs` of all installed harnesses are scanned.

---

## Architecture-leak guard (`spec/leak-guard.ts`)

`checkArchitectureLeak(body: string, allow: string[]): Warning[]`

Preprocessing: remove fenced code blocks (three or more backticks or tildes); remove Markdown link targets (`](...)`); remove every term in `allow`, where `allow` = `specs.feature.leak_guard_allow` + the built-in list of Specplane names (all config keys and frontmatter field names from `architecture/file-formats`, plus `.specplane/config.yaml`, `PLAN.md`, `PLANS.md`, `HANDOFF.md`, `AGENTS.md`, `INFO.md`). Inline code spans are kept and checked.

Heuristics (each match → warning):

1. **Paths**: `(?<![\w/])(?:\.{1,2}/|/)?[\w.-]+(?:/[\w.-]+)+\.[a-z0-9]{1,5}\b` (at least one `/` and an extension, e.g. `src/foo.ts`, `/src/foo.ts`, `./a/b.py`), plus `(?<![\w/])\.?/?[\w.-]+/[\w./-]*/(?=\s|$|[`)])` for directory paths ending in `/`.
2. **Technology names**: case-insensitive whole-word match against a built-in list (TypeScript, JavaScript, Python, Go, Rust, Java, C++, C#, Ruby, PHP, SQLite, PostgreSQL, MySQL, MongoDB, Redis, React, Vue, Angular, Express, FastAPI, Django, Next.js, npm, pip, cargo, Docker, Kubernetes, JSON Schema).
3. **Code identifiers**: `\b[a-z]+(?:[A-Z][a-z0-9]+)+\b` (camelCase), `\b(?:[A-Z][a-z0-9]+){2,}\b` (PascalCase with two or more words), `\b[a-z0-9]+(?:_[a-z0-9]+)+\b` (snake_case), `\$\w+`, and `\w+\(\)`.
4. **Bare file names**: `(?<![\w/.-])[\w-]+(?:\.[\w-]+)*\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php|json|yaml|yml|toml|sh|sql|html|css)\b` (names like `foo.ts` or `config.yaml` with no `/`), type `path`. Exclusions, applied after the allow-list removal: matches inside a Markdown link text or target; the Specplane file names in the built-in allow list; and names ending in `.md`, which are documentation, not code. Heuristic 1 takes precedence, so a match is not reported twice.
5. **Schema syntax**: lines matching `^\s*(?:type|\$ref|properties|required):` outside code blocks.

Each warning includes `type` (`path`, `tech_name`, `identifier`, `schema_syntax`), `line`, `match`, `message`.

---

## Plan parsing and validation (`plan/parse.ts`, `plan/validate.ts`)

`listPlans(config, root): PlanRecord[]` — every `<plans.dir>/<id>/PLAN.md` and `<plans.dir>/archive/<id>/PLAN.md`; `archived` is set accordingly.

`parsePlan(planDir)` validates PLAN.md against `architecture/file-formats` §2.1 and checks `id` equals the folder name. `parseStep(stepFile)` validates against §3.1 and checks `step` equals the numeric filename prefix and `plan` equals the plan ID.

`validatePlans(plans, specs, adrs, config): ValidationReport`

- `in_progress`/`review` stored while `status_source: git` → warning.
- Dangling `depends_on` → error; dependency on an `abandoned` plan → error; cycles (via `graph.ts`) → error.
- `specs` entries resolve (no root context) → error if not; deprecated → warning.
- Steps: contiguous numbering from 1; `context` references (`spec` with anchor, `decision`, `file`) per §3.2; HANDOFF.md outcomes per §3.2 and §4.1. `handoffOutcomes(file)` returns, per step number, the outcomes of its sections in file order; only the last one is compared with the step's `status` (latest entry wins). A `skipped`/`blocked` step without a section, or any step whose latest section's `**Outcome**` differs from its `status`, is an error: "Step <n> is `<status>` but the latest HANDOFF.md `## Step NN` section has `**Outcome**: <outcome>`." (or, with no section, the existing "has no `## Step NN` section" text). Earlier sections are not checked.
- `spec-gaps.md` (`plan/gaps.ts`): when `<plan dir>/spec-gaps.md` exists, `parseGaps(file): GapEntry[]` reads each `## G<n>: <case>` heading and its `**Field**: value` lines (`{ n, caseTitle, kind, step, case, resolution, targets, status, line }`). Checks per `architecture/file-formats` §4.2, all errors except unresolved targets: a heading that is not `G<n>: …` ("`spec-gaps.md`: heading `<heading>` must be `## G<n>: <case>`."), duplicate or descending numbers ("`spec-gaps.md`: entry G<n> is duplicated or out of order."), a missing field ("`spec-gaps.md`: G<n> has no `**<Field>**`."), a `Kind` or `Status` outside its set, a `Step` that is not a step of the plan; a `Target spec` ID that does not resolve (without root context) is a warning. A `feature-spec-proposals.md` is ignored.

---

## ADR validation (`decisions/`)

`listAdrs(config, root)` reads `<decisions.dir>/NNNN-*.md` (absent directory = no ADRs). `validateAdrs` applies `architecture/file-formats` §6.2 with its message texts: ID–filename match (error), duplicate numbers (error), `superseded` without `superseded_by` (error), `superseded_by` naming an unknown ADR (error), `superseded_by` on a non-`superseded` ADR (warning), supersession cycles (error), unresolved `related_specs` (warning). Cycle detection follows `superseded_by` from each ADR in number order, marking visited ADRs; a revisit within the current chain reports the chain from the ADR where it re-enters, rotated to start at the lowest-numbered ADR in the cycle, so each cycle is reported once.

---

## Plan status (`plan/status.ts`)

`getIndexStatus(plan, plansById, config): IndexStatus` — used by `generate`. Reads only committed files:

1. If stored status is not `ready`: return it.
2. If `dependency_mode: wait_for_merge` and any `depends_on` plan is not `done`: return `blocked`.
3. If `dependency_mode: stack` and two or more `depends_on` plans are not `done`: return `blocked` (`feature/plan-status`). A plan with at most one such dependency is not `blocked` in stack mode.
4. Return `ready`.

`blockedReason(plan, plansById, config): string | null` gives the text shown with a `blocked` status: in stack mode "Cannot stack on more than one unmerged dependency: `<a>`, `<b>`." (dependency IDs in backticks, in `depends_on` order), the same text the start flow's stacking check throws; in wait-for-merge mode `null` (the dependencies are listed instead). `plan list` prints it after a `blocked` status, and the start flow throws it.

`getEffectiveStatus(plan, plansById, config, git): EffectiveStatus` — used by `plan list`, `plan show`, and `generate --print --live`:

1. Compute the index status. If it is not `ready`, return it.
2. If `status_source: frontmatter`: return `ready`.
3. If branch `plan/<id>` exists locally or as `refs/remotes/origin/plan/<id>`: if the forge reports an open PR for it, return `review`; otherwise return `in_progress`.
4. Return `ready`.

Remote branches are read from already-fetched remote-tracking refs; status queries never touch the network except for the forge PR lookup.

### Plan next (`plan/next.ts`)

`planNext(id, config, root): PlanNext` resolves what should happen next for a plan and whether an agent may start it unattended. It is read-only: it reads files, runs read-only git queries (`worktree list`, `rev-list`, `status --porcelain`, `show`), and never fetches, writes, commits, or spawns anything, so two runs in a row leave `git status` and the worktree unchanged. It is harness-neutral (no harness names in its output); a harness maps `action` to its own spawn mechanism. `computeNext(input): PlanNext` is the pure core.

Files are read from the plan's own checkout (`checkout`, as in § Plan activity) when it has one, else from the invoking checkout. The next step is the lowest-numbered step whose status is not `done` or `skipped`, so an earlier `pending` or `blocked` step wins over a later one (the `plan-step` ordering rule); `reason` says so when a later step is already past `pending`. Effective status comes from `getEffectiveStatus`.

`--json` prints exactly one object on stdout:

| Field | Value |
|-------|-------|
| `plan`, `title` | plan ID and title |
| `effectiveStatus` | as § Plan status |
| `step` | `{ number, title, status, file }` (`file` is repository-relative), or `null` when no step remains |
| `context` | one `{ kind, id, path, anchor }` per `context` item of `step`: `kind` is `spec`, `decision`, or `file`; `path` is repository-relative or `null` when unresolved; `anchor` is the heading anchor or `null` |
| `checkout` | as § Plan activity |
| `blocked` | the `BLOCKED:` lines of HANDOFF.md when `step` is `blocked`, else `[]` |
| `openGaps` | `{ id, kind, summary }` for each `spec-gaps.md` entry whose status is `open` |
| `warnings` | unresolved context items and skipped (unparsable) step files; never errors |
| `attention` | derived, never stored: `{ kind, message }` objects, at most one per `kind`, from the closed set below |
| `action` | exactly one of `spawn_step`, `ask_human`, `finish`, `restack`, `none` |
| `reason` | one sentence explaining `action` |

`attention` kinds: `blocked` (the next step is `blocked`), `gap_decision` (an `open` `spec-gaps.md` entry of kind `proposal` or `assumption`), `finish_ready` (the plan is started and every step is `done` or `skipped`), `restack` (the plan is stacked and its base plan is now `done` on the default branch, as the resume notice of § Start), `diverged` (the local branch and `origin/plan/<id>` each have commits the other lacks), `dirty` (the plan checkout has uncommitted changes).

`action`, first match wins: the plan is `done` or `abandoned`, a `draft`, `blocked` by dependencies, or not started (no branch): `none`. Otherwise `diverged` or `dirty`: `ask_human`; `blocked` or `gap_decision`: `ask_human`; `restack`: `restack`; `finish_ready`: `finish`; a remaining step: `spawn_step`; no steps: `none`. `blocked` and `gap_decision` therefore always take precedence over `spawn_step`.

Human output prints the same fields as labelled lines. `plan next` never fetches; `--no-fetch` is accepted for symmetry with `plan list --live` and changes nothing.

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
- `cliTrailers(workflow, planId): Trailers` — `Specplane-Workflow` and, when `planId` is non-empty, `Specplane-Plan` (`architecture/file-formats` §8.2 requires the plan trailer only when the commit is in a plan; the approval commands have none), plus `Specplane-Agent` from `$SPECPLANE_AGENT` and `Specplane-Session` from `$SPECPLANE_SESSION` when set and non-empty. Harnesses set these variables for agent sessions (for Claude Code, see `claude:architecture/claude-integration` § Session context); a human running the CLI by hand gets neither.
- `readTrailers(ref): Map<string, string>` — `git log -1 --format=%(trailers:only,unfold) <ref>`, parsed with `git interpret-trailers --parse` semantics (last value wins for repeated keys).
- `findLatest(branch, workflow): sha | null` — `git log --format=%H%x00%(trailers:key=Specplane-Workflow,valueonly) <branch>`, first match.

Every commit made by `plan/flows.ts` goes through `formatMessage`; empty commits use `git commit-tree -F -` with the message on stdin.

---

## Plan flows (`plan/flows.ts`)

These implement `feature/plan-execution`. Every flow validates everything it needs before its first write, so a failed check leaves no partial state.

### Start

1. `git fetch origin <default>` (skipped when there is no remote, or with `--no-fetch`, which uses the local refs as they are).
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
2. Run `test_command` (shell, `cwd` = checkout); present acceptance criteria and the open `spec-gaps.md` entries (`parseGaps`, `**Status**: open`), one line each: `G<n> (<kind>, <target specs>): <case>`, under the heading "Open spec gaps:". Open entries never stop the flow; with none, the heading is omitted.
3. Frontmatter mode: claim `review`.
4. Fetch (skipped with `--no-fetch`; pushes and pull requests in step 6 are unaffected); if stacked, `rebaseOnto(<default>, <latest marker sha>, 'plan/<id>')`; else `git rebase <default>`. A conflict throws `RebaseConflictError` (the rebase is aborted, leaving the branch unchanged). Re-run tests if the rebase applied new commits.
5. Final commit: set `status: done`; if `archive_done`, `git mv <plans.dir>/<id> <plans.dir>/archive/<id>`; commit `chore(specplane): finish <id>` (`Specplane-Workflow: finish`).
6. `pull_request`: `git push -u origin plan/<id>`, then `createPR` (or print instructions when it returns `null`). `local_merge`: ask for confirmation, then in the main checkout `git merge --no-ff plan/<id>`.
7. After a local merge, run cleanup.

### Cleanup, abandon, archive

- `cleanup(id)`: remove the worktree (or switch the branch-backend checkout back to the default branch); delete `plan/<id>` only if the plan's `PLAN.md` on the default branch has `status: done`. Each part is skipped if already done.
- `abandon(id, { deleteBranch, force })`: fails with `PlanStateError` ("Cannot abandon plan: `<id>` is `<status>`.") when the stored status on the default branch is `done` or `abandoned`; any other stored status (`draft`, `ready`, and in frontmatter mode `in_progress`/`review`) may be abandoned. Otherwise edit `PLAN.md` on the default branch to `abandoned`, `git mv` to archive if `archive_done`, commit `chore(specplane): abandon <id>` (`Specplane-Workflow: abandon`) in the main checkout (same preconditions as a claim commit); remove the worktree; delete the branch only if requested.
- `archive(id)`: for a `done` or `abandoned` plan not yet archived, `git mv` it to the archive and commit `chore(specplane): archive <id>` (`Specplane-Workflow: archive`) in the current checkout.

### Restack

`restack(id)`: find the newest marker commit on `plan/<id>` (`findLatest('plan/<id>', 'stack')`), take its `Specplane-Stack-Base` trailer as `upstream`, and call `rebaseOnto(newBase, upstream, 'plan/<id>')`, where `newBase` is the default branch if the base plan is done, else `plan/<base-id>`. After the rebase it appends an empty marker commit: `chore(specplane): stack <id> on <base-id>` with a `Specplane-Stack-Base` trailer recording the new base tip while still stacked, or `chore(specplane): unstack <id> from <base-id>` without that trailer once the base plan is done. Output: "Restacked <id> onto <newBase>", plus " (no longer stacked)" in the latter case; "<id> is already on the tip of <newBase>" when there is nothing to replay (outcome `current`, nothing changes).

Errors, checked before any write: an unknown ID → `PlanNotFoundError`; no stack marker → `PlanStateError` ("Cannot restack: `<id>` is not stacked."); a marker without a base plan, a base plan with no branch that is not done, `plan/<id>` not checked out, or a dirty working tree → `PlanStateError` with the texts in `plan/flows.ts`. A conflict while replaying fails with `RebaseConflictError` listing the conflicting files and leaves the checkout mid-rebase for the human to resolve (`feature/tooling`); unlike the finish flow, the rebase is not aborted.

`restack(id, { dryRun: true })` runs the same checks, computes `newBase` and `upstream` the same way, and changes nothing. Output: "Would restack <id> onto <newBase>" (plus " (no longer stacked)" when the base is done), followed by one line per commit that would be replayed, oldest first: `<short sha> <subject>` for each commit of `git rev-list --reverse <upstream>..plan/<id>` that is not a stack marker.

Restack triggers (a restack is the only operation that rewrites a stacked plan's history, so each trigger is explicit or part of a flow the user started):

1. **Explicit**: `specplane plan restack <id> [--dry-run]` (`feature/tooling` § `specplane plan restack`).
2. **Finish step 4**: the finish flow restacks a stacked plan automatically (see Finish).
3. **Resume (message only)**: when `plan start <id>` resumes a stacked plan whose base plan is now done on the default branch, it prints "Base plan `<base-id>` has merged; run `specplane plan restack <id>`." and continues. Resume never rewrites history.

### Plan activity (`plan list --json`)

Harness live views (for example `claude:architecture/claude-integration` § Live view) read plan activity from `specplane plan list --json --live` instead of parsing git themselves. Each plan object adds:

| Field | Source |
|-------|--------|
| `branch` | `plan/<id>` if it exists locally or on `origin`, else `null` |
| `backend` | `execution.backend` from config: `worktree`, `branch`, or `external` |
| `where` | `local` when `plan/<id>` exists as a local branch; `remote` when it exists only as `refs/remotes/origin/plan/<id>`; `none` when neither exists (not started) |
| `checkout` | path of the worktree whose checked-out branch is `refs/heads/plan/<id>`, from `git worktree list --porcelain`, else `null`. For the `worktree` backend this is the plan's worktree; for the `branch` backend it is the main checkout's root while that checkout is on `plan/<id>`, and `null` otherwise; always `null` when `where` is not `local` and for the `external` backend |
| `steps` | `{ total, done, skipped, blocked, next }` from the step files at the branch tip (`git show <branch>:<path>`), else from the default branch; `next` is `{ number, title, status }` or `null` |
| `blocked_issues` | `BLOCKED:` lines from HANDOFF.md at the branch tip |
| `last_step_commit` | newest commit on the branch with `Specplane-Workflow: step`: `{ sha, time, step, agent, session }` from its trailers, else `null` |
| `ahead_of_remote` | commits on the local branch not on `origin/plan/<id>` (`null` without a remote branch) |

`--live` fetches `origin` at most once per invocation (`git fetch --quiet origin 'refs/heads/plan/*:refs/remotes/origin/plan/*'`), skipped with `--no-fetch` or when there is no remote. Without `--live`, these fields come from local refs only.

## Plan commands (`commands/plan.ts`)

Read-side plan commands; the registration pattern is that of the spec commands below. Handlers load config through `loadConfig`, read plans from the checkout root through `plan/resolve.ts` and `plan/parse.ts` (active and `archive/`), and surface config warnings on stderr. Texts and options are those of `feature/tooling` § `specplane plan`. Start, finish, abandon, cleanup, and archive are specified under § Plan flows.

### `plan new`

Inputs: `--id`, `--title`, `--specs` and `--depends-on` (comma-separated). Without `--id`, the ID is `<today as YYYY-MM-DD>-<slug>`, where the slug is prompted for (a TTY is required, otherwise the command fails with "Plan ID needed: pass `--id`."). The ID must match the pattern in `architecture/file-formats` §1.1. Checks, in order: ID format, existence in `plans.dir` or its `archive/` (`AlreadyExistsError`: "Plan `<id>` already exists. Choose a different slug."), then each `--specs` ID resolves and each `--depends-on` ID is an existing plan (`SpecNotFoundError` or `PlanNotFoundError`). The title is prompted for when absent and a TTY is attached; otherwise it defaults to the slug with hyphens replaced by spaces and the first letter capitalised. Writes `<plans.dir>/<id>/PLAN.md` with `status: draft`, the given `specs` and `depends_on`, and the body headings of `architecture/file-formats` §4, plus an empty `steps/` directory (containing `.gitkeep`). It then prints `Created <path>` on stdout. Exit codes: 0 success, 1 any error above.

### `plan list`

Inputs: `--status`, `--json`, `--live`, `--no-fetch`. Computes `getEffectiveStatus` for every plan (active and archived; an unparsable plan is skipped and reported on stderr) and sorts rows by ID descending. `--status` filters on the effective status. Human output is aligned columns `id`, `title`, effective status; with `--live` a second line per plan with activity (step progress, next step, `where`, the `checkout` path for the `worktree` backend and blank otherwise, blockers). `--json` prints an array of `{id, title, stored_status, effective_status, depends_on, specs, archived}`, and with `--live` each object also carries the fields of § Plan activity. `--live` also lists plans whose branch exists only on the remote and not on the default branch, with `stored_status` taken from `PLAN.md` at the branch tip. Exit 0, or 1 for a `--status` value that is not a plan status. With `--live`, when a remote is configured and the fetch fails, one line `notice: could not fetch origin; showing local refs` goes to stderr and the command continues from local refs with exit 0; `--no-fetch` prints nothing.

### `plan next <id>`

Inputs: `--json`, `--no-fetch`. Runs `planNext` (§ Plan next) and prints either the JSON object or the human summary. Errors: `PlanNotFoundError`, or the parse error of an invalid `PLAN.md`. Exit 0, or 1 on an error.

### `plan step-done <id>`

Inputs: `--outcome done|blocked|skipped` and `--summary <text>` (required); `--type <type>` (Conventional Commits type, default `feat`); repeatable `--changed <path>:<reason>` (order kept), `--deviation <text>`, `--open-issue <text>`, `--gap <G<n>>` and `--trailer <Key: value>` (harness attribution such as `Co-Authored-By`, written after the Specplane trailers); `--next-knows <text>`; `--step <NN>` (default: the lowest step that is not `done` or `skipped`); `--force`. `stepDone` (`plan/step-done.ts`) builds the `architecture/file-formats` §4.1 section (all subsections, `None.` for empty ones; for `skipped`, "What changed" is `None.`), appends it to `<plans.dir>/<id>/HANDOFF.md`, sets the step's frontmatter `status` to the outcome, stages the plan folder, and commits per §8: `<type>(<slug>): <summary>`, a bullet list of the `--changed` entries, then `Specplane-Workflow: step`, `Specplane-Plan`, `Specplane-Step`, `Specplane-Agent` and `Specplane-Session` (each only when `$SPECPLANE_AGENT` / `$SPECPLANE_SESSION` is non-empty), then the `--trailer` lines. Anything already staged goes into the same commit, so the agent stages the step's own work first. "Gaps found in specs" lists each `--gap` entry of `spec-gaps.md` as `- G<n> (<kind>): <case>. See `spec-gaps.md`.`.

Every refusal happens before the first write and exits 1 with the exact fix: the step is already `done` or `skipped`; the step is `blocked` and the outcome is not `blocked` (unless `--force` overrides the blocker guard; the earlier `blocked` section stays); `--outcome blocked` without an `--open-issue` starting `BLOCKED:`; `--outcome skipped` without a `--deviation`; a `--gap` ID with no `spec-gaps.md` entry; HANDOFF.md already has a section for a later step than the one being appended; a malformed `--changed` or `--trailer`; a subject over 72 characters. The HANDOFF section and the status are written together; if the commit fails both files are restored. The command never pushes: `plan-step` step 10 stays with the agent. Prints the short commit hash and the HANDOFF path.

### `plan start <id>`

Inputs: `--no-fetch`, `--json`. Runs `startPlan` (§ Plan flows) and prints: `Started|Resumed <id>`, `Backend: <backend> (checkout created|resumed|not needed)`, the worktree path or branch, the next step, and one closing line: for `worktree`, `Open a session: cd <checkout> && claude`; for `branch`, `Open a session: claude`; for `external`, that the environment runs the finish flow itself and `specplane plan finish` must not be run locally. `--json` prints the `StartResult` object with `checkout` (the worktree path or `null`) and `nextCommand` (the same command string, `null` for `external`), so skills render the command instead of composing it. Notices still go to stderr.

### `plan show <id>`

Resolves `id` through `plan/resolve.ts` (active or archived) and prints its `PLAN.md` unchanged to stdout. Errors: `PlanNotFoundError`. Exit 0 or 1.

### `plan graph`

Builds the graph with `buildGraph` over all active plans and prints `toMermaid` output (the block of `architecture/file-formats` §5.2, without the surrounding PLANS.md prose) to stdout, with effective statuses for the node classes. A dependency cycle throws `DependencyCycleError`. Exit 0, or 1 on a cycle.

---

## Spec, search, and init commands (`commands/spec.ts`, `commands/search.ts`, `commands/init.ts`)

Each command module exports a function that registers its subcommands with commander and handlers that take parsed options and return a result object; `output/human.ts` and `output/json.ts` render it. Handlers load config through `loadConfig` and surface its warnings on stderr. Texts and options are those of `feature/tooling`.

### `spec new <type> <slug>`

Inputs: `type` (`feature` or `architecture`), `slug`, `--root` (default `base`), `--title`, `--implements`, `--extends` (comma-separated). Resolves the root path through `spec/resolve.ts`; the file is `<root-path>/features/<slug>.md` or `<root-path>/architecture/<slug>.md` (the ID is `<type>/<slug>`). Order of checks: type (`Unknown spec type `<type>`: expected `feature` or `architecture`.`), root (`UnknownRootError`), slug is kebab-case and the ID matches the pattern in `architecture/file-formats` §1.1, existence in the root and its extends chain (`AlreadyExistsError`: "Spec `<type>/<slug>` already exists."), then for architecture specs `--implements` ("Architecture spec needs `--implements`." when absent and no TTY or still empty after prompting). The title is prompted for when absent and a TTY is attached; without a TTY it defaults to the slug with hyphens replaced by spaces and the first letter capitalised. The file is written with `status: draft`, `author: user`, the given `implements` and `extends`, and a body of the title heading plus the empty section headings of the `architecture/file-formats` §1.3 (`Rules`, `Acceptance scenarios`, `Edge cases`) or §1.4 (`Components`, `Data structures`, `Error handling`) template; the command takes no body content (authorship stays with `llm_role`); the command then prints `Created <path>` on stdout. Exit codes: 0 success, 1 any error above.

### `spec list`

Inputs: `--status`, `--type`, `--root`, `--json`. Reads every spec in every root (or the named one) through `spec/parse.ts`; a spec with invalid frontmatter is skipped from the list and reported on stderr. Rows are sorted by ID, then root. Human output is one row per spec in aligned columns `id`, `title`, `status`; `--json` prints an array of `{id, title, status, author, root}` on stdout. Exit 0, or 1 for `UnknownRootError`.

### `spec show <id>`

Resolves `id` (optionally `<root>:<id>` or `--root`) through `spec/resolve.ts` and prints the file unchanged to stdout. Errors: `SpecNotFoundError`, `AmbiguousIdError`, `UnknownRootError`. Exit 0 or 1.

### `spec validate [<id>...]`

Runs `validateSpec` on the named specs, or `validateSpecs` when none are named, and produces the report described in § Validation output format (human to stderr by default, `--json` on stdout). It does not run plan, ADR, freshness, or skill-drift checks; those belong to `validate`. Exit 0 when `valid`, otherwise 1; an unknown ID is a `SpecNotFoundError` (exit 1).

### `search <text>`

Module `commands/search.ts`. Inputs: `text`, `--kind spec|plan`, `--status`, `--root`, `--json`. (`--kind`, not `--type`, so it does not clash with `spec list --type feature|architecture`; `feature/tooling`.) Candidate files are the spec files of the selected roots and the `PLAN.md` and step files under `plans.dir` (including `archive/`). The match is a case-insensitive literal substring test per line, with no regular-expression interpretation of `text`. `--status` and `--root` filter on frontmatter (a plan's status is its stored status); `--root` implies `--kind spec`. Output: one block per file, in path order, giving the ID (or plan ID and step) and, per matching line, `<line>: <trimmed line>`; at most 3 snippets per file. `--json` prints an array of `{id, kind, path, root, status, matches: [{line, text}]}`. No matches: empty output (or `[]`) and exit 0. Exit 1 only for errors (an empty `text`, unknown root).

### `init`

Module `commands/init.ts`; `--harness <name>` selects an entry in the harness registry. Steps, in order, each reporting one line on stdout and never overwriting:

1. `.specplane/config.yaml`: written from `DEFAULT_CONFIG` when absent (`Created .specplane/config.yaml`), otherwise `Skipped .specplane/config.yaml (exists)`. Later steps use the paths of the config now on disk.
2. `INFO.md` in each of `<spec_roots[].path>/features/` and `<spec_roots[].path>/architecture/` for the base root only: `Created <path>` or `Skipped <path> (exists)`.
3. `<plans.dir>/.gitkeep` when `<plans.dir>` is missing or empty: `Created`; otherwise nothing is reported.
4. `AGENTS.md` through `upsertBlock`: `Created AGENTS.md`, `Updated AGENTS.md (appended Specplane block)`, `Updated AGENTS.md`, `Unchanged AGENTS.md`, or the malformed-block `Skipped` line (§ Standing instructions).
5. The named or detected harness's files, each reported as `Created`, `Updated`, `Unchanged`, or `Skipped` by the harness module.

Idempotence: a second run on an unchanged repository creates nothing and reports only `Skipped`/`Unchanged` lines, and exits 0. `init` outside a git repository throws `NotARepoError` (exit 1) and writes nothing.

---

## Spec approval and decision commands (`commands/spec.ts`, `commands/decision.ts`)

These implement `feature/tooling` § `specplane spec approve`, § `specplane spec reopen`, § `specplane plan approve`, and § `specplane decision`. They share the refusals and the commit format:

- Every refusal prints its one-sentence reason to stderr, exits 1, and stops the run; specs, plans, or ADRs changed earlier in the same run keep their new status.
- Each successful change is committed through `formatMessage` with `Specplane-Workflow: approve` (`architecture/file-formats` §8.3), the CLI trailers from `cliTrailers` (no `Specplane-Plan`), and the subject `feature/tooling` gives. The status line is rewritten in place, as `writePins` rewrites `based_on`, so no other frontmatter or body byte changes.
- Validation errors found by the command's own checks are printed as the report of § Validation output format and the command exits 1 without committing.
- `--dry-run` prints, per ID, the change it would make and the commit subject, then changes and commits nothing.

### `spec approve <id>...`

Inputs: one or more spec IDs, `--dry-run`. Per ID, in the order given:

1. Resolve the ID (`spec/resolve.ts`); an unknown ID is `SpecNotFoundError`.
2. The status must be `draft` or `review`, else `SpecStateError` with the text in `feature/tooling`.
3. The file must be committed (`hasUncommittedChanges`) → `UncommittedChangesError`.
4. Under `specs.architecture.require_approved_features`, an architecture spec whose `implements` names a spec that is not `approved` → `ApprovalRefusedError`.
5. For an extending overlay, re-pin its bases (`committedBlob` of each, written with `writePins`) when every base is `approved` and committed; a base that is not approved, or a stale pin whose base has uncommitted changes, → `ApprovalRefusedError` with the corresponding `feature/tooling` text. The new pins go in the same commit.
6. Write `status: approved`, stage the spec and any re-pinned `based_on`, and commit `docs(specs): approve <id>`.
7. Print `approved <id> <short sha>`.

### `spec reopen <id>`

Inputs: one spec ID, `--dry-run`.

1. Resolve the ID; an unknown ID is `SpecNotFoundError`.
2. The status must be `approved`, else `SpecStateError` with the text in `feature/tooling`.
3. The file must be committed → `UncommittedChangesError`.
4. Write `status: review` and commit `docs(specs): reopen <id>`.
5. Compute the direct dependants that can no longer stay approved: approved architecture specs whose `implements` contains the ID, and overlays (`extends` or `based_on`) naming it. The check is not transitive: a dependant of a dependant is reported when that dependant is reopened, not now. Nothing else changes.
6. Print `reopened <id> <short sha>`, then one line per dependant: `<dep-id> <dep-status> — reopen with: specplane spec reopen <dep-id>`.

### `plan approve <id>...`

Inputs: one or more plan IDs, `--dry-run`. Per ID, in the order given: resolve (`plan/resolve.ts`; unknown → `PlanNotFoundError`); the stored status must be `draft` (`PlanStateError`); the plan folder must be committed (`UncommittedChangesError`); each spec the plan names must satisfy `plans.require_approved_specs` (`ApprovalRefusedError`); then `status: ready` is written to `PLAN.md`, PLANS.md is regenerated as `generate` does, and both are committed as `docs(<plan-id>): approve plan`. Prints `approved <id> <short sha>`.

### `decision new <title>`

Inputs: `title`. The slug is `slugify(title)` (`spec/slug.ts`). The number is the highest existing `NNNN` in `<decisions.dir>` plus one, starting at `0001`. The file `<decisions.dir>/<NNNN>-<slug>.md` is written with `id: decision/<NNNN>`, the title, `status: proposed`, `date` (today, `YYYY-MM-DD`), and the body headings of `feature/decisions#adr-body-structure` with empty sections; an existing file is `AlreadyExistsError` with the text in `feature/tooling`. Because the number is the highest existing plus one, the target path is new by construction: the existing-file check is a defensive guard that the numbering rule makes unreachable, kept so the command can never overwrite an ADR. Prints the path on stdout. Exit 0 or 1.

### `decision accept <id>...`

Inputs: one or more ADR IDs, `--dry-run`. Per ID, in the order given: resolve (`decisions/parse.ts`; unknown → `DecisionNotFoundError`); the status must be `proposed` (`DecisionStateError`); the file must be committed (`UncommittedChangesError`); then `status: accepted` and a commit `docs(decisions): accept <id>`. `validateAdrs` errors for that ADR refuse the acceptance. Prints `accepted <id> <short sha>`.

---

## Standing instructions (`agents/standing.ts`)

Implements `architecture/agent-skills` § Standing instructions.

- `STANDING_VERSION = 'v1'` and `standingText(workflowsLine)`: the canonical text; the base uses the harness-neutral Workflows line.
- `upsertBlock(content: string | null): { content, action: 'created' | 'appended' | 'updated' | 'unchanged' | 'malformed' }`: markers are matched as `<!-- specplane:begin v<N>` … `-->` and `<!-- specplane:end -->` on their own lines. Line endings in the existing file are preserved.
- `init` writes `AGENTS.md` through `upsertBlock` and reports `Created`, `Updated` (appended or replaced), `Unchanged`, or `Skipped AGENTS.md (malformed specplane block; fix the markers by hand)`.
- `validate` warns (type `freshness`) when no file in the repository root delivers the block (`AGENTS.md`, or a harness file registered by an installed harness), when a block's version is older than `STANDING_VERSION`, when its text differs from `standingText` (with the harness's Workflows line), or when it is malformed. Message: `Specplane standing instructions in <file> are missing or out of date; run specplane init.`
- A harness registers its standing-instructions file as `rulesFile` (for Claude Code, `.claude/rules/specplane.md`). Its freshness check is a byte-compare with the bundled template; a difference is a `freshness` warning with the same message.

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
| `UnknownRootError` | "Unknown root `<name>`." | 1 |
| `SpecNotFoundError` | "Spec `<id>` not found." | 1 |
| `AlreadyExistsError` | "Spec `<id>` already exists." or "Plan `<id>` already exists. Choose a different slug." | 1 |
| `AmbiguousIdError` | "Ambiguous ID `<id>`: found in roots `<a>`, `<b>`. Use `<root>:<id>`." | 1 |
| `FrontmatterError` | "`<file>`: <schema violation>" | 1 |
| `FrontmatterMissingError` | "`<file>`: no frontmatter block found" | 1 |
| `PlanNotFoundError` | "Plan `<id>` not found." | 1 |
| `SpecStateError` | "Spec `<id>` is `<status>`; only `draft` or `review` specs can be approved." or "Spec `<id>` is `<status>`, not `approved`." | 1 |
| `ApprovalRefusedError` | "Cannot approve `<id>`: `<spec-id>` is `<status>`, not `approved`." or "Cannot approve `<id>`: base `<base-id>` is `<status>`." or "Cannot approve `<id>`: base `<base-id>` changed since it was pinned." | 1 |
| `DecisionNotFoundError` | "Decision `<id>` not found." | 1 |
| `DecisionStateError` | "Decision `<id>` is `<status>`; only `proposed` decisions can be accepted." | 1 |
| `UncommittedChangesError` | "Commit or stash changes to `<path>` first." | 1 |
| `PlanStateError` | "Cannot <action>: <reason>." with the texts of `feature/plan-execution`, e.g. "Cannot start plan: `<id>` is `<status>`, not `ready`.", "Cannot start plan: dependency `<id>` is not done.", "Cannot stack on more than one unmerged dependency: `<a>`, `<b>`.", "Cannot finish: step <NN> is `<status>`.", "Cannot restack: `<id>` is not stacked."; also "Plan `<id>` is `<status>`; only `draft` plans can be approved." | 1 |
| `DependencyCycleError` | "Dependency cycle: `<a>` → `<b>` → `<a>`" | 1 |
| `SetupHookError` | "Setup hook failed: `<cmd>` exited with code <n>. Worktree removed." | 1 |
| `RebaseConflictError` | "Rebase of `plan/<id>` onto `<base>` has conflicts; resolve manually." | 1 |
| `ForgeError` | "Forge operation failed: <reason>" | 2 |
| `GitError` | "Git command failed: `<cmd>`: <stderr>" | 2 |
| `NotARepoError` | "Not in a git repository" | 1 |

Message pattern: every error message is one sentence ending in a full stop (git stderr and `<cmd>` excerpts excepted), with the entity in backticks. Where `feature/tooling` or `feature/plan-execution` gives a text, the class uses it verbatim; the feature text wins over this table (`feature/spec-precedence`). For cross-field config rules whose text `feature/configuration` fixes as a whole sentence, `ConfigError` takes a `null` key and uses the reason as the whole message; JSON-schema violations keep the "Config key `<key>`: <reason>" prefix. `AlreadyExistsError` is thrown by `spec new` and `plan new` before anything is written.

Output streams: human-readable reports, progress lines, warnings, and errors go to stderr; data goes to stdout: `--json` output, `spec show`, `plan graph`, `--print` output, and the one-line summaries that `feature/tooling` says commands print for the files they change. Errors are printed as the message alone, prefixed by nothing, and the process exits with the class's exit code.
