# CLI step 1 notes: read the new spec format and validate

Written 2026-11-09. Step 1 of making the CLI follow the approved architecture specs (`architecture/file-formats`, `architecture/reference-cli`). Scope: read the new format, cites, fingerprints, effective status, and `specplane validate`. Not done here: approval command, plans, requests, permissions, coverage, the rest of the target module layout.

## What was added

New code in `packages/cli/src`: `spec/frontmatter.ts`, `sections.ts`, `cites.ts`, `requirements.ts`, `fingerprint.ts`, `project.ts` (snapshot and cite resolution), `status.ts` (effective status including the hand-format rule of `file-formats` §4.5), `source.ts` (worktree or committed reads), `paths.ts` (the few configuration keys the reader needs), and `verify/validate.ts` (rules and report). `specplane validate [ids...] [--json]` now runs only these rules. Tests: `spec/format.test.ts`, `verify/validate.test.ts`.

## Dropped or stubbed

- Old `runValidate` (specs, ADRs, plans, freshness, PLANS.md, skill drift) is gone from `commands/validate.ts`. `checkFreshness` and `checkPlansMd` stay exported only because other code and tests use them; they are not called by validate.
- Tests deleted or trimmed because they asserted dropped behaviour: `validate.test.ts` and `spec/pins.test.ts` (deleted); the skill-drift test and `validate` assertions in `harness/codex.test.ts`; the `validate` assertions in `harness/release-evidence.test.ts` and `commands/plan.test.ts`; the PLANS.md-freshness-through-validate assertions in `generate/index-command.test.ts`; the two "stale manual completion ... drift" tests in `harness/claude-consumer.test.ts` and `harness/codex-consumer.test.ts`. `integration.test.ts` "validate exits 0" now asserts no format or requirement errors and only the five known example cites.
- Known failing test, not from this step: `config.test.ts` "DEFAULT_CONFIG equals the defaults table in feature/configuration" fails at HEAD already (the configuration spec was rewritten; the old config loader still has the old defaults). The packed tarball and the Claude/Codex consumer tests can time out under load.
- Old modules (`spec/parse.ts`, `spec/validate.ts`, pins, leak guard, overlays, plans, decisions, `PLANS.md` generation) are still compiled and used by other commands, but `validate` no longer calls them. They are not removed in this step.
- `.specplane/config.yaml` rewritten to the §6 shape (`paths`, `plans.dir: plans`). A `specs.<type>.llm_role: draft` block is kept only because the installed `.claude/hooks/specplane-policy-guard.sh` reads it; validate reports it as an unknown setting (warning).

## Decisions where the specs were silent (assumptions)

- A bare whole-spec span (for example `` `plans` ``) counts as a cite only when a spec with that slug exists, so words such as `approved` are not cites. A whole-spec cite used in the body but not listed gives a warning, not an error (§3.1 says "avoid"; the approved specs use them in prose).
- Cites with a project prefix other than `root` are parsed, reported with a warning "resolved in a later release", and not required in `references`. `root:<cite>` is compared as `<cite>`.
- `<project>:` needs no space after the colon, so `outdated: plans R28` is not a cite. A `file:` path containing `<` or `>` is a placeholder, not a cite.
- Self-cite exemption uses the innermost section containing the span.
- Format findings come from the working tree; each is tagged `worktree` when the file differs from HEAD. Status comes from HEAD only.
- Effective status warnings: stored `approved` with computed `awaiting-review` is a warning (§2.2). Awaiting-review specs that were never approved are not warned about.
- When the approval commit is missing in a hand-format approval, only `edited` plus a warning is reported (no per-cite `outdated`).

## Remaining `specplane validate` output on this repository

No errors from the 4 architecture specs and 11 feature specs except the 5 example cites below (9 error lines). These are illustrative cites written in backticks inside spec text. The specs are approved and were not edited; fixing them means rewording the example (or listing it) and re-approving.

| Spec | Line | Cite | Problem |
|------|------|------|---------|
| `architecture/file-formats` | 160 | `file:docs/x.md` | file does not exist; not in references |
| `feature/specifications` | 98 | `architecture/cli R16` | no such spec; not in references |
| `feature/specifications` | 178 | `b R7`, `b R9` | scenario example, no spec `b`; not in references |
| `feature/later-releases` | 88 | `root:R7` | scenario example; `R7` is not in references |

Warnings: 11 whole-spec cites not listed in references (prose mentions of `plans`, `harness`, `roles-and-permissions`, `verification`, `feature/cli`, `feature/plans`, and the other architecture specs); 4 subproject cites (`claude:R7`, `claude:harness R14`, in two specs) resolved in a later release; the unknown `specs` config key; and five feature specs whose stored status is `approved` but whose cited parts changed after the hand approval, so their effective status is `awaiting-review` with `outdated:` reasons: `cli`, `harness`, `requests`, `steering`, `verification` (cited parts of `roles-and-permissions R57`, `R50`, `configuration R25`, `plans R30`, `R30.1`, `steering R59`, `later-releases R37`, `R37.1` changed). This is the strict R11.2 cascade that the handoff says was not applied; re-approving through the CLI (later step) clears it. The other 6 feature specs and the 4 architecture specs are effectively `approved`.

## Not scanned

`harnesses/claude/specifications` and `harnesses/codex/specifications` are not read: they are subprojects (a later release) and still use the old format (`author`, `extends`, `based_on`, `status: approved` without an approval block, cites to removed specs such as `feature/agent-integration`, `feature/plan-steps`, `feature/spec-policies`). They will report format and cite errors once subprojects are read. Not fixed.

## Spec observations

- `architecture/reference-cli` §4.3 says the reference check is "a subset" and listed-but-unused is a warning; `file-formats` §2.1 also says covers and implements are not flagged when unused. Implemented that way.
- `file-formats` §3.1 makes a bare slug a valid whole-spec cite, which collides with ordinary code spans such as `` `plans` `` or `` `approved` ``; the existence rule above is the workaround. A spec-level rule (for example "only `spec:`-prefixed whole-spec cites") would remove the guess.
