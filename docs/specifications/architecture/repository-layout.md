---
id: architecture/repository-layout
title: Repository layout
status: approved
author: mixed
implements: [feature/spec-system, feature/configuration, feature/plan-system, feature/decisions]
---

<!-- Plan index proposal 2026-11-02: user agreed naming/source semantics and approved the companion feature patch, now applied. Architecture revision awaits review; not implemented behavior. -->


<!-- Architecture reconciliation 2026-11-02: current feature contracts govern this draft revision. Stored lifecycle status and dependency pins are preserved; this edit is not approval or evidence of implementation. -->

<!-- Revision 2026-11-01: extension/core separation and contribution provenance agreed in conversation; existing lifecycle status is unchanged. Implementation and integration review remain pending. -->

# Repository layout

This spec defines the supported repository layout when Specplane is initialized. Plans and managed checkouts are optional; ordinary spec/code work and manual completion declarations require neither. Paths shown below are defaults, always resolved from configuration. Product documentation belongs to the installed release, not the consumer's spec roots.

---

## Top-level structure

```
<repo-root>/
  .specplane/
    config.yaml              # single config file; all policy lives here
  .git/
  docs/
    specifications/          # default base spec root
      features/
        INFO.md              # optional; free-form
        <slug>.md            # feature specs
      architecture/
        INFO.md              # optional; free-form
        <slug>.md            # architecture specs
    decisions/               # decisions.dir (default); created with the first ADR
      <NNNN>-<slug>.md       # architecture decision records
    OPEN-QUESTIONS.md        # design questions and their resolutions (optional)
  plans/
    PLANS.md                 # GENERATED; never hand-edit
    <plan-id>/
      PLAN.md
      steps/
        <NN>-<slug>.md
      HANDOFF.md             # created by first recorded step
      spec-gaps.md           # created when a step records a gap
    archive/                 # created when the first plan is archived
      <plan-id>/             # completed or abandoned plans (PLAN.md, steps/, HANDOFF.md)
  AGENTS.md                  # tool-agnostic agent workflow instructions
  README.md
```

---

## Overlay root structure

Overlay spec roots follow the same layout as the base spec root:

```
<overlay-root-path>/
  features/
    INFO.md
    <slug>.md
  architecture/
    INFO.md
    <slug>.md
```

The path is declared in `.specplane/config.yaml`. Example for the Claude harness overlay:

```
harnesses/
  claude/
    specifications/          # overlay root
      features/
        claude-integration.md
      architecture/
        claude-integration.md
    templates/               # harness files installed by `specplane init --harness claude`
    tests/                   # harness tests (hook scripts, template sync)
```

A harness directory's `templates/` and `tests/` are not part of the spec root and are ignored by spec discovery. Their contents are defined by the harness's architecture spec (for Claude Code, `claude:architecture/claude-integration`).

Codex follows the same structure under `harnesses/codex/`, with a `codex` overlay root extending `base`. Harness-specific contracts do not live in the base specification root. Each harness package contains its ecosystem manifest, complete workflow assets, applicable contract snapshots, adapter when supported, and integration tests. Claude's plugin package includes a mod for deterministic command dispatch; Codex packaging follows the verified capabilities of its target surface.

The shared core and standalone CLI remain under `packages/cli/` initially, with separate public entry points for reusable operations and the manual command interface. Extensions bundle a compatible core version and identify their core/contract compatibility. The core never imports a host adapter to choose a runtime. Package assets are not spec roots and are ignored by spec discovery. Each released core also contains `docs/manifest.json`, Markdown topics, the compact orientation and audited contract snapshots (file-formats §10). Extensions bundle that same compatible documentation and runtime inventory. A consumer does not copy Specplane's source specifications into its own roots to use product docs. Managed asset installation records docs/contract versions and digests; only explicit init/upgrade refreshes owned guidance.

---

## Generated and gitignored files

| Path | Status | Notes |
|------|--------|-------|
| `plans/PLANS.md` | Committed | Generated; conflicts always resolved by regeneration |
| `../.specplane-worktrees/` | Outside repository | Git worktrees; outside the repo; path configured in `execution.worktree_dir` |

Nothing needs to be added to `.gitignore`: worktrees live outside the main checkout (validation rejects a `worktree_dir` inside it).

Recommend adding to `.gitattributes` so forges collapse `PLANS.md` in diffs and exclude it from language statistics:

```
PLANS.md linguist-generated=true
```

---

## File naming constraints

| Pattern | Rule |
|---------|------|
| Spec slugs | Lowercase, hyphens only (`[a-z0-9-/]+`). No dots (reserved for extensions). Nested with `/`. |
| Plan IDs | `YYYY-MM-DD-[a-z0-9-]+`. Date prefix, then 2–4 word kebab slug. |
| Step filenames | `NN-[a-z0-9-]+.md`. Two-digit zero-padded integer prefix. |
| ADR filenames | `NNNN-[a-z0-9-]+.md`. Four-digit zero-padded integer prefix. |

---

## Invariants

- `.specplane/config.yaml` always exists at the repository root when Specplane is initialised. If absent, defaults apply.
- `plans/PLANS.md` describes the selected source after `specplane plan index` or CI runs, and is byte-identical for the same indexed plan/config snapshot; an unspecified target is labelled `repository default` until live resolution. Live ref/activity data is excluded.
- `plans/archive/` and the decisions directory may be absent until first used; tools create them on demand and treat absence as empty.
- No plan folder contains another plan folder; the only nested structure within `plans/` is `archive/`.
- `INFO.md` files are never parsed as specs. They are read-only documentation; one with frontmatter is a validation error.
- Spec files outside `features/` or `architecture/` within a spec root are ignored by Specplane (no error, no validation).

---

## Worktree layout

Managed worktree-backend checkouts are stored outside the repository at `<worktree_dir>/<repo-name>/<plan-id>/`:

```
../.specplane-worktrees/
  specs-framework/
    2026-10-28-plan-index-generator/   # full repo checkout on plan branch
    2026-11-01-search-indexer/
  other-project/
    2026-10-30-auth-rewrite/
```

`<repo-name>` is the basename of the **main checkout's** root directory (e.g. `specs-framework` for `/home/user/projects/specs-framework`), and a relative `worktree_dir` is resolved against that root — never against a plan worktree. See `architecture/reference-cli` § Repository roots.

Each worktree is a complete git worktree created with `git worktree add`. It shares the git object store and refs with the main checkout. Main checkout location determines worktree paths only; it does not determine a plan's integration destination. Administrative writes locate the recorded target's checkout by branch. Other ordinary Git worktrees and branches need no Specplane registration. Private leases, pending workflow journals and contribution capture live under `<git-common-dir>/specplane-runtime/`; they are recovery data, not source-of-truth completion records.
