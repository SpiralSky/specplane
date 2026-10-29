# Spec gaps — 2026-10-29-assist-and-approve

## G1: `--dry-run` on the approval commands

**Kind**: assumption
**Step**: 01
**Case**: `feature/tooling` names no `--dry-run` flag for `spec approve`, `spec reopen`, `plan approve`, or `decision accept`, but this plan's steps 03 and 04 require one for each.
**Resolution**: Specified `--dry-run` in `architecture/reference-cli` § Spec approval and decision commands as a shared behaviour: it prints the planned change and commit subject per ID and changes nothing. Implemented in steps 03 and 04.
**Target spec**: `feature/tooling`
**Status**: open

## G2: `plan approve` regenerates PLANS.md in the same commit

**Kind**: assumption
**Step**: 01
**Case**: `feature/tooling` § `specplane plan approve` says it "sets `status: ready` and commits the change"; it does not say whether the generated index is updated in that commit or left to CI.
**Resolution**: Specified that `plan approve` regenerates PLANS.md as `generate` does and commits both files, so `PLANS.md` never shows a stale stored status between the approval and CI. Implemented in step 04.
**Target spec**: `feature/tooling`
**Status**: open
