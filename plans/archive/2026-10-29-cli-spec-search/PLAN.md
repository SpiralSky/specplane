---
id: 2026-10-29-cli-spec-search
title: CLI spec and search commands, validation hardening
status: done
specs:
  - feature/tooling
  - feature/spec-system
  - feature/spec-overlays
  - feature/spec-precedence
  - feature/decisions
  - feature/configuration
  - architecture/reference-cli
  - architecture/file-formats
depends_on:
  - 2026-10-28-reference-cli-core
---

# CLI spec and search commands, validation hardening

## Goal

Add the `spec new`, `spec list`, `spec show`, `spec validate` and `search` commands to the CLI, and close the review findings that concern the command surface, error conventions, ID pattern, and validation heuristics.

## Scope

- Architecture-spec edits: command surface for `spec` and `search` and the `init` details, one error-message pattern, stderr for human reports, an already-exists error class, `DEFAULT_CONFIG` pointer, leak-guard heuristic additions, deprecated-reference warnings, and the file-formats ID pattern.
- A written proposal file for the feature-spec findings in `tooling`, `decisions`, `configuration`, and `spec-precedence`.
- Code for the shared error/stderr conventions, `DEFAULT_CONFIG`, the ID pattern change, the new heuristics, and the new commands.
- Unit and integration tests for each.

## Non-goals

- `plan` commands and flows (`2026-10-29-cli-plan-commands`, `2026-10-29-cli-plan-flows`).
- Forge, CI, and npm publish (`2026-10-29-cli-forge-ci-publish`).
- `init --harness` (`2026-10-29-cli-claude-harness-init`).
- Applying the feature-spec proposals: that needs the user.
- No ADR commands: no spec defines any.

## Specs implemented

| Spec | Coverage |
|------|----------|
| `feature/tooling` | `spec new/list/show/validate`, `search` |
| `feature/spec-system` | ID rules used by `spec new` |
| `feature/spec-overlays` | `--root` and `<root>:<id>` handling |
| `feature/spec-precedence` | Findings recorded as proposals |
| `feature/decisions` | Findings recorded as proposals |
| `feature/configuration` | Defaults table pointer; findings as proposals |
| `architecture/reference-cli` | Command surface, error classes, leak guard, deprecated references |
| `architecture/file-formats` | ID pattern |

## Acceptance criteria

- [x] `specplane spec new feature foo --title Foo` creates a valid draft spec; a repeat exits 1 with "Spec `feature/foo` already exists."
- [x] `specplane spec list --json` and `spec show` behave as in `feature/tooling`, including ambiguous-ID errors.
- [x] `specplane search "architecture-leak"` returns the spec matches with snippets.
- [x] The leak guard warns on "JSON Schema" and on bare file names such as `config.yaml` outside the allow-list; a spec using `implements`/`extends` to a deprecated spec gets a warning.
- [x] The ID pattern rejects `a//b` and one-character slugs consistently in the schema and the code.
- [x] `plans/2026-10-29-cli-spec-search/feature-spec-proposals.md` exists and covers every feature-spec finding assigned to this plan.
- [x] `specplane validate` exits 0 on this repository; `npm test` passes.

## Risks

1. Changing the leak-guard heuristics on `main` can add warnings across existing specs: keep them warnings and review the new output.
2. Editing base specs makes overlay and skill pins stale: re-pin in the same commit.
3. Writing to stderr changes what scripts and hooks capture: check the Claude hook scripts only consume exit codes and `--json` stdout.

## Steps

1. `architecture-spec-edits`: Edit `architecture/reference-cli` and `architecture/file-formats`.
2. `feature-spec-proposals`: Write the proposal file; no feature-spec edits.
3. `errors-output-config-ids`: Implement the shared conventions.
4. `validate-heuristics`: Extend validate with the new heuristics.
5. `spec-commands`: Implement the `spec` subcommands.
6. `search-command`: Implement `specplane search`.
