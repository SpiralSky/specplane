---
id: 2026-10-29-cli-claude-harness-init
title: CLI init --harness claude, harness registry, and skill findings
status: ready
specs:
  - claude:feature/claude-integration
  - claude:architecture/claude-integration
  - feature/agent-integration
  - feature/tooling
  - architecture/agent-skills
  - architecture/reference-cli
depends_on:
  - 2026-10-28-reference-cli-core
---

# CLI init --harness claude, harness registry, and skill findings

## Goal

Implement `specplane init --harness claude`: the harness registry, template bundling, installation and settings merge, the real skill-directory registry that replaces the core plan's stand-in, and freshness checks. Also close the agent-skills and claude-architecture review findings and update the skill templates accordingly.

## Scope

- Architecture edits to `architecture/agent-skills`, `claude:architecture/claude-integration`, and `architecture/reference-cli`.
- Skill template updates and dogfood copies for the agent-skills findings.
- `src/harness/index.ts`, `src/harness/claude.ts`, template bundling in the build.
- `skillDirs()` replacement and the rules-file freshness check.
- End-to-end tests and dogfood verification.

## Non-goals

- The optional plugin (`2026-10-29-claude-plugin-hardening`).
- Other harnesses.
- Editing `CLAUDE.md`: Specplane never does.

## Specs implemented

| Spec | Coverage |
|------|----------|
| `claude:feature/claude-integration` | Init behaviour, standing instructions, slash commands |
| `claude:architecture/claude-integration` | CLI implementation, settings merge, testing |
| `feature/agent-integration` | Standing instructions |
| `feature/tooling` | `init --harness` |
| `architecture/agent-skills` | Contracts, drift |
| `architecture/reference-cli` | Standing instructions, harness registry |

## Acceptance criteria

- [ ] `specplane init --harness claude` in an empty git repository writes every file in `claude:architecture/claude-integration` § Files produced, hooks are mode 0755, and settings are merged without removing existing entries.
- [ ] Re-running `init` reports `Skipped`/`Unchanged` for identical files and `Updated` for differing Specplane-owned ones; `CLAUDE.md` is never touched.
- [ ] An unknown harness name exits 1 listing known names; with `.claude/` present, `init` detects the harness without the flag.
- [ ] Skill drift and standing-instruction freshness use the registry; the stand-in `skillDirs()` is gone.
- [ ] `specplane validate` warns when `.claude/rules/specplane.md` differs from the bundled template.
- [ ] The updated skill templates and `.claude/` copies pass `harnesses/claude/tests/check-sync.sh` and `hooks.test.sh`.
- [ ] `npm test` passes; running `init --harness claude` in this repository changes nothing.

## Risks

1. Template bundling paths break when the package is installed globally: test against `npm pack` output.
2. Settings merge can clobber user settings: cover each merge case with a test.
3. Editing approved architecture specs makes skill contract markers stale: re-pin in the same commit.

## Steps

1. `architecture-spec-edits`: Edit three architecture specs.
2. `skill-template-updates`: Apply the agent-skills edits to the skills.
3. `harness-registry-and-bundling`: Implement the registry and the init flag.
4. `claude-install-and-settings-merge`: Implement `src/harness/claude.ts`.
5. `skilldirs-and-freshness`: Finish the validate integration.
6. `e2e-and-dogfood`: Verify end to end.
