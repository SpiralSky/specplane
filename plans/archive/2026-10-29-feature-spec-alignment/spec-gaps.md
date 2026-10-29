# Spec gaps — 2026-10-29-feature-spec-alignment

## G1: Spec root path that is not a directory

**Kind**: assumption
**Step**: 01
**Case**: `feature/configuration` makes a spec root `path` that is not a directory a validation error but gives no message text (Scenario 7 covers only a missing path).
**Resolution**: `architecture/reference-cli` § Config loading uses "Spec root `<name>`: path `<path>` is not a directory.", following the Scenario 7 pattern.
**Target spec**: `feature/configuration`
**Status**: applied

## G2: `init` on a repository whose spec roots do not exist yet

**Kind**: assumption
**Step**: 02
**Case**: `architecture/reference-cli` config loading requires every `spec_roots[].path` to exist, but `init` is the command that creates those directories and must work in a clean repository (`feature/tooling` Scenario 1).
**Resolution**: `loadConfig` takes an internal `checkSpecRoots: false` option that only `init` uses; every other caller keeps the check. `init` then creates the base root through its normal `INFO.md` scaffolding.
**Target spec**: `architecture/reference-cli`
**Status**: applied

## G3: Cross-field config errors use the feature texts verbatim

**Kind**: assumption
**Step**: 02
**Case**: `feature/configuration` fixes whole-sentence texts for cross-field errors (Scenarios 5–8), while the `ConfigError` pattern in `architecture/reference-cli` § Error classes prefixes `Config key `<key>`:`.
**Resolution**: `ConfigError` accepts a `null` key and then uses the reason as the whole message, so cross-field errors match the feature texts exactly; JSON-schema violations keep the `Config key` prefix. The duplicate-root message was also aligned to feature Scenario 5.
**Target spec**: `architecture/reference-cli`
**Status**: applied

## G4: No branch cleanup after a plan is already abandoned

**Kind**: gap
**Step**: 03
**Case**: `feature/plan-status` says abandoning a plan whose stored status is `abandoned` fails, but `feature/plan-execution` § Abandoning a plan keeps `plan/<id>` unless deletion is requested, and `plan cleanup` only deletes the branch of a plan that is `done` on the default branch. After the first successful abandon there is therefore no CLI route to delete the branch or a leftover worktree.
**Resolution**: implemented the spec texts as written: a second `plan abandon` fails with "Cannot abandon plan: `<id>` is `abandoned`." (including `--delete-branch`). Deleting an abandoned plan's branch is left to `git branch -D`, as the specs do not define a command for it.
**Target spec**: `feature/plan-status`, `feature/plan-execution`, `feature/tooling`
**Status**: rejected
