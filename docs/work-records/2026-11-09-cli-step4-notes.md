# CLI step 4 notes: configuration

Written 2026-11-09. Scope: the new configuration of `configuration` R25/R25.1/R54 (`file-formats` §6, `reference-cli` §3.2, §7.4, §13.1).

## Code

`config.ts` (settings table with kinds and defaults, `parseConfig`, `loadSettings`, validation findings), `config-edit.ts` (textual edit that keeps comments, order and other keys), `config-ops.ts` (`config get|list|set|unset`, guarded by `config.change`, audited with old and new), `commands/config.ts` (CLI), `perm/catalog.ts` and `perm/docs.ts` (R54 documentation, `specplane permissions [<id>]`), `spec/paths.ts` now reads through `loadSettings`. Tests: `config.test.ts` (23).

## Deviations and assumptions

- **Old loader kept as `legacy-config.ts`.** The old plan, execution and decision code (about 60 files, 40 test files) still needs the old `Config` shape (`execution.backend`, `plans.merge`, `spec_roots`, ...). `legacy-config.ts` is the old loader, renamed, and skips the keys the new configuration owns. It is removed with that code in the plans step (`reference-cli` §11). The old keys are no longer read by the new loader (reported as unknown with a "retired model" note). `specplane init` still writes the old default file (`DEFAULT_CONFIG_YAML`); it is replaced with the harness step. The old `DEFAULT_CONFIG` equality test was removed with the old defaults; `config.test.ts` checks the new defaults against `configuration` and `file-formats` §6.1.
- **Policy-guard hook.** `.claude/hooks/specplane-policy-guard.sh` read `specs.<type>.llm_role`. The block is removed from `.specplane/config.yaml`; the hook template now defaults feature specs to `draft` (was `assist`), so with no `specs:` key the LLM edits feature and architecture specs without a prompt, matching the user's 2026-11-09 decision. A user who adds a `specs:` block gets the old behaviour back from the hook, but the new loader reports that key as unknown.
- **Finding severity.** Unknown settings are warnings; malformed values and invalid YAML are errors. Either way the default applies and commands still run (R25 validation).
- **`config set` is not committed** (`reference-cli` §13.4); it takes effect from the next command. Under `request-user` the guard refuses with "requests are not available yet" (requests are a later step). Side effects (pre-commit hooks, steering regeneration) are not implemented: pre-commit settings are later releases, steering is a later step; the command prints a note for the preset change.
- **`roles.os_user_mapping`** is kept locally (`file-formats` §7.4); in `config.yaml` it is reported as a warning and ignored.
- **Dynamic settings** (`strict_mode.<measure>`, `bypass_guards.<measure>`, `harness.instructions.<command>`) are accepted under any measure name. The spec names the strict mode measures only in prose.
- **Overlap check.** `paths.requirements`, `paths.features`, `paths.architecture` and `plans.dir` must not contain each other (`reference-cli` §3.2 assumption); the offending set key is malformed and its default applies.
- **Permission docs.** The catalog descriptions, "does not allow" texts and command lists are mine (no spec text exists). The steering key is `steering.<permission id>`; the generated steering text itself is not available until the steering step, so `permissions <id>` names the key. `permissions` is always read by anyone (no permission), as `file-formats` §13.1 says; `reference-cli` §7.3 says reads are guarded by `info.retrieve`, but R54 says documentation reading needs none, so R54 is followed.
- **Harness side of R25/R54** (reading and changing from the harness, the "same names and modes in CLI and harness" test) is not done; only the CLI half exists.
- **Administrator-only** operations: none in configuration; `config.change` is allow for the Standard User in every default preset.
