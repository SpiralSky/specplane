# Spec gaps — 2026-10-29-feature-spec-alignment

## G1: Spec root path that is not a directory

**Kind**: assumption
**Step**: 01
**Case**: `feature/configuration` makes a spec root `path` that is not a directory a validation error but gives no message text (Scenario 7 covers only a missing path).
**Resolution**: `architecture/reference-cli` § Config loading uses "Spec root `<name>`: path `<path>` is not a directory.", following the Scenario 7 pattern.
**Target spec**: `feature/configuration`
**Status**: open
