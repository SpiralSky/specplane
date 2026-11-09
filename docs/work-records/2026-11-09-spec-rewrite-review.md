# Review of the rewritten feature specs

Written 2026-11-09 by session 12, an independent reviewer who did not write the specs. Scope: the 11 specs in `docs/specifications/features/` (`specifications`, `plans`, `plan-execution`, `roles-and-permissions`, `requests`, `steering`, `harness`, `cli`, `verification`, `configuration`, `later-releases`) against `docs/requirements/product-requirements.md` (the page), `docs/work-records/2026-11-09-spec-format.md`, `docs/release-plan.md` and the HANDOFF assumptions. Nothing was edited except this record. Nothing was approved.

Method: every spec and the whole page were read in full. A script checked that every R-number on the page except `R62` and `R63` is covered by exactly one spec, that every `<slug> R<n>` or `§<n>` cite resolves to a heading, and that body cites and `references` lists agree. All sub-requirements have a heading in the spec that covers their parent. "Verified" below means I read both texts and the problem is there. "Suspected" means it depends on how a requirement is read.

Totals: 1 blocker, 9 should-fix, 8 minor.

## Findings, most severe first

### 1. Blocker. `configuration` R25.1 contradicts the page and `roles-and-permissions` on the LLM's configuration permission (verified)

`configuration` R25.1 says that "in the most restrictive preset the LLM role cannot change configuration at all". Page `R57` says changing configuration is request user for LLM roles in all default presets, and `roles-and-permissions` R57 ("Configuration. Changing configuration is request user for the LLM role", common to all four presets) agrees. The HANDOFF note for spec 10 says it was to be checked against preset contents; it does not match.

Fix: in `configuration` R25.1, replace the sentence with "In every default preset the LLM role has request user for changing configuration; the Standard User has allow (`roles-and-permissions R57`)." Keep the deny scenario as a custom-role example, not a preset one.

### 2. Should-fix. `later-releases` R39.3: subproject reference syntax is incomplete and not in the format record (verified; requested check)

`claude:R7` and `root:R7` are a new citation shape. It is not in the citation table of the format record, and it is given only for requirement IDs. There is no shape for a section of a feature or architecture spec in another subproject (`claude:harness R14`?), and a specification ID has no subproject part, so two subprojects can each have `feature/plans` with nothing to tell the citations apart. `root` collides with a subproject that is named `root`. Page `R39.3` only asks that the project be named "as well as the ID".

Fix: add one row to the citation table in the format record and one sentence to `specifications` R7 "Citing": `<project>:<cite>`, where `<cite>` is any existing shape (`claude:R7`, `claude:harness R14`, `claude:architecture/cli R16`). Reserve `root` as the root project's name and forbid it as a subproject name. State that spec IDs are unique per project and that a cite without a project means the citing spec's own project. Until the record is updated, `later-releases` R39.3 should say the syntax is an assumption.

### 3. Should-fix. `later-releases` R39.4: second bullet is invented and unclear (verified; requested check)

The page says only "Root project requirements outrank subproject requirements. Within a subproject, `R65` applies." The spec's first bullet and lead sentence match. The second bullet ("The root project's feature and architecture specifications are not outranked by a subproject's ... follows the layer order, with the root requirement still on top") can be read as saying a subproject requirement outranks a root feature spec, or the reverse. Nothing on the page says either.

Fix: delete the second bullet, or reduce it to "Conflicts between a subproject's specifications and the root project's specifications that are not both requirements are reported to the user and not resolved by Specplane (assumption)". The first bullet's "warning" and "the LLM does not implement the subproject side" is consistent with `R65` and can stay.

### 4. Should-fix. `configuration` says it lists every setting (R25) but several settings the other specs require are missing (verified)

R25 on the page: all configuration accessible in CLI and harness. `configuration` is the only spec that names settings, and it omits:

- the optional separation-check instructions of `R4`, which `specifications` R4 and `harness` R14 say are configurable and can be turned off (no key, and no default on or off);
- parallelism (`plan-execution` R31.2: "The setting is the greatest number of tasks run at once", default one);
- subprojects (`later-releases` R39: "a named location in the project (`configuration R25`)");
- the measures of strict mode (`R55.1`) and of the bypass guardrails (`R58`), each "can be turned on or off on its own";
- the identity and role-mapping settings of `R44`, `R44.1`, `R48`.

Section §2 says later-release settings "can be written already" but names none of them.

Fix: add rows for each (`harness.separation_check` default on or off to be decided, `plans.parallelism` default 1, `projects`/`subprojects`, `strict_mode.*`, `bypass_guards.*`, role mapping), marked later release where `docs/release-plan.md` says so. Alternatively cut the "lists every setting" claim and say each spec names its own settings.

### 5. Should-fix. Step status `skipped` and a "recorded decision to skip" weaken page R27 (verified)

Page `R27`: "the harness should deny a selection that skips a step that has not been completed". `plans` §3.1, `plans` R29.1, `plan-execution` R27 ("A step is skipped only by a recorded decision with a reason"), R27.2 and R27.3 keep a `skipped` status and a user decision that records it. The conflict record, item 27, lists the old `skipped` status and `--step N --force` as wrong under the page. The spec denies the selection but keeps the same escape hatch, with no permission that says who may record a skip.

Fix: either remove `skipped` (a step is not started or done; a step the user no longer wants is removed by editing the plan, which is a plan edit under `R31.1`), or keep it and state in `plan-execution` R27 that it is an assumption, that it needs the plan-edit permission, and that the final review lists skipped steps (it already does). I recommend removal: it is the simpler reading of the page.

### 6. Should-fix. `roles-and-permissions` permission list is incomplete against R50, and its "Requests" row contradicts `requests` R52.2 (verified for both; the first is partly an interpretation)

(a) `R50`: "Every command should have granular permissions". The table has none for running tests, validating, listing warnings, reading the audit log, marking an architecture spec implemented, or switching to Administrator. Other specs say several of these need none (`verification` §2.2 "Running a test does not need a permission", `configuration` R25.1 "Reading configuration needs no permission"). That may be a defensible reading, but it is stated nowhere as a deliberate exception to `R50`.

(b) The table row "Requests | Sending a request and accepting one" implies an accept permission. `requests` R52.2 says: "The permission of the role to accept is the permission to do the action, not a separate 'accept requests' permission".

Fix: (a) add a short list to `roles-and-permissions` R50 of commands that are read-only and need no permission (validate, warnings, audit read, test run), and name the permission used to mark implemented (`verification` R36.1 uses the record-a-test-result permission, which should be said here). (b) Change the row to "Sending a request: always allowed to the LLM role; accepting uses the permission of the requested action (`R52.2`)".

### 7. Should-fix. "Exactly one" coverage is invented and contradicts `R64` in `verification` (verified)

`specifications` R5 says "A requirement is covered by exactly one feature spec". The format record says the same. The page never says that, and `R64` says "which specifications cover each requirement" (plural). `verification` R64 first says a requirement covered by several specs is shown with all of them, then in the same bullet says "where the rules say each is covered by exactly one specification, more than one is reported (`specifications R9`)", citing a section about dependencies. `R64` also defines coverage "using their references (`R9`)", while `verification` R64 also counts `covers`; the two are not the same thing (a spec that merely cites `R7` references it).

Fix: delete the "exactly one" sentence from `specifications` R5 (or label it a project convention the validator checks only if the user enables it) and delete the last sentence of the "Several covers" bullet. Say once, in `verification` R64, whether coverage is read from `covers`, from any reference, or both; I suggest `covers` plus citations, since that is what `R64` literally says ("using their references").

### 8. Should-fix. `steering` R22 lists documentation notes that no requirement calls for (verified)

R22 says the notes are included "because other requirements call for them". Two are not on the page: "the choice of model for author and reviewer is the user's, with a note to avoid the same model for both", and "with a git server, give an LLM its own bot account and keep human tokens out of its reach". Searching the page for "bot account", "reviewer" and "same model" finds nothing. They look carried over from old documentation. The last bullet ("A feature is documented before the release that ships it is called complete") is also invented.

Fix: delete the two notes and the last bullet, or move them to a section that covers no requirement (`§`) and mark them as assumptions.

### 9. Should-fix. Several cross-spec cites resolve but point to the wrong section, so `R11.2` outdating would track the wrong thing (verified)

- `harness` R19: "an edit to an approved specification makes it Awaiting Review (`specifications R9`)". R9 is dependencies; the rule is `specifications R11.3`.
- `harness` R19.2: "Plan steps that write specifications follow these permissions too (`plans R28`)" should be `plans R30.1`. Same section: defaults "in the default presets (`roles-and-permissions R50`)" should be `R57`; `harness` R26.2 repeats the R50 for the default LLM role's allow.
- `verification` R12: "requirement identifiers are unique and not reused (`specifications R4`)". R4 is the feature and architecture separation; it should be `specifications R1`. `later-releases` also lists the unused reference `specifications R4`.
- `verification` R12: "A project without requirements, plans or decision records validates without complaints (`specifications §2`)". Should be `specifications R68` for requirements.
- `verification` R24: "plans that reference an older version of a specification (`plans R28`)" should be `plans R29.3`.
- `verification` R64 cites `specifications R9` for "exactly one" (see finding 7).
- `configuration` R25.1: "an LLM can therefore not widen its own permissions unless its preset allows changing configuration (`R47`)". `R47` is CLI separation; the useful cite is `roles-and-permissions R55`.

Fix: correct each cite and update the `references` lists.

### 10. Should-fix. Dropping old decision records and overlays resolves two open product questions inside the specs (verified; requested checks 4 and 5)

`later-releases` R37 says taking old ADRs into the feature "is optional" and that they are "never approved by an LLM"; R39 says overlays "are not part of Specplane any more"; R66 treats old ADRs, overlay roots and per-type LLM role settings as migration inputs. This is a coherent reading of the page: `R37` describes only user decision records, `R39` only subprojects, and the page says it replaces existing specs where they differ. Conflict record questions 4 and 5 were marked as needing the user's product decision, and the specs answer both. The only place this is flagged is the HANDOFF assumptions from spec 11; the spec itself presents it as settled. What is lost: ADR numbering and supersession, ADR validation, "never deleted" (the page gives records a delete permission, so this is intended), and the old record workflow (`/decision-new`, `decisions.dir`, ADR status `accepted`). Nothing from those is cited by the new specs.

Fix: add one sentence to `later-releases` R37 and R39 that this is an assumption pending the user's answer to conflict questions 4 and 5, and list both in the review summary for the user. No content change is needed otherwise.

### 11. Should-fix (outside the 11 specs, but blocks step 13). 79 references to removed specs remain in architecture and harness specs (verified by search)

Search for `feature/(decisions|spec-overlays|spec-system|tooling|spec-policies|agent-integration|plan-system|plan-steps|plan-status|spec-precedence|plan-index)` finds 79 hits under `docs/specifications/architecture` and `harnesses/*/specifications` (for example `implements` and `based_on` in `file-formats.md` and `reference-cli.md`). `.specplane/config.yaml` also still lists `features/overlays/extension.md`. Approving or validating under the new rules will report all of these as references to specs that do not exist (`R9`, `R11.2`).

Fix: part of step 13, or a separate step: update `implements` and `based_on` in the architecture specs to the new feature slugs and sections, and clean the config.

### 12. Minor. Preset contents beyond the page; one may be at odds with Preset 2 (suspected)

Page `R57` Preset 2: "disables all LLM editing permissions over all specifications while only enabling read-only permissions and other miscellaneous permissions to the LLM". `roles-and-permissions` R57 applies one common list to all four presets, which gives the LLM in Full Manual Editing: create and edit plans allowed, and request user for starting plans, budgets and decision record changes. Plans are not specifications, so this is probably "miscellaneous", but a plan can contain steps that write specifications, and a user choosing "Full Manual Editing" may not expect an LLM that can create and edit plans. The HANDOFF flags the plan and decision record defaults as the author's choice; the spec itself does not.

Fix: either make plan create and edit request user in Preset 2, or say in R57 that the common list is a choice beyond the page and that it applies to Preset 2 too.

### 13. Minor. Behaviour invented beyond the page, not marked as assumptions, some of it architecture-like (verified)

- `plan-execution` R27: where the worktree is placed (next to the project, project folder name in the path), the setup command, handling of untracked files, and in §2 the merge policy (pull request or local merge, always a merge commit, conflicts never resolved automatically). The page says only that plans run in a separate worktree and branch and that a final review decides completion.
- `plans` §2: which files make up a plan folder (plan file, step files, handoff, gaps file). Needed as a user-facing record, but names are file layout and belong in an architecture spec (`R4`).
- `harness` §2: a marked block in a shared instruction file (`AGENTS.md`, `CLAUDE.md`). The repo's own `CLAUDE.md` says Specplane never writes one. The page has no such requirement; it is old agent-integration text.
- `harness` R34 "the user names the harness at setup; Specplane never picks one from installed files".
- `specifications` R65: same-layer contradictions are not implemented (page `R65` says nothing about same-layer; `steering` repeats it).
- `cli` R17.1: "the more permissive mode wins; deny on the general permission does not remove a granular allow".
- `cli` R16: the user must confirm group approval (the page only says warn and list).

None contradicts the page. Fix: add an "Assumptions" bullet list to each spec (or mark with "(assumption)") for the items that are product behaviour, and move file-layout detail to an architecture spec. For `cli` R16, make the confirmation skippable by a flag so that scripted approval still works.

### 14. Minor. `R62.1` to `R62.5` are covered by no spec and not declared requirement-only (verified)

The page's `R62` and `R63` are requirement-only, per the task, but `R62.1` to `R62.5` are sub-requirements with their own IDs and appear in no `covers` list. `R62.1` states behaviour (limits apply only to an agent's actions on Specplane itself). `verification` R64 exempts "a requirement that is requirement-only by the owner's choice (`R62`, `R63`)" but gives no way to say so.

Fix: say in `specifications` R64/R5 that sub-requirements of `R62` and `R63` are requirement-only, or add `R62.1` to `roles-and-permissions` R55 (where its behaviour already sits). Also decide how a user marks a requirement as requirement-only.

### 15. Minor. Format conformance (verified)

- Several specs use unnumbered `###` headings (`specifications`: "Citing", "Metadata for all layers"; `roles-and-permissions`: "How a permission applies", "Permission kinds"; `steering`: three headings and "Scenarios"; `configuration`: "Settings", "Validation"). The format record says non-requirement material goes under `§<n>` headings so that every part can be cited.
- Illustrative citations in backticks would be reported by the validator the specs describe: `R41` (retired) and `R1.1` and `b R7`/`b R9` in `specifications`, `R9` in `cli`, `R14` in `verification`. Same for unused references: `cli` `R11`, `harness` `R37.1`, `roles-and-permissions` `R27.1` and `later-releases R37.1`.
- Frontmatter key order differs: the format record's example has `references` before `covers`, `later-releases` follows it, and the other ten put `covers` first.

Fix: number or merge the subsections, write example cites without backticks or in an excluded form, and prune the references lists.

### 16. Minor. Leftover old concepts in behaviour text (verified)

`configuration` R25 names "the per-type LLM role and authorship policy, the architecture-leak guard, overlay roots, the plan status source and the plan dependency mode" as removed settings, and `later-releases` R39 describes "old overlay roots". These describe history, not behaviour. R66 may name old formats because migration reads them; that is fine. No `draft`, `review`, `deprecated` status, `PLANS.md`, `llm_role` as a live setting or `leak guard` as a live feature remains.

Fix: delete the two sentences from `configuration` R25 and `later-releases` R39; keep the R66 line.

### 17. Minor. Smaller inconsistencies (verified)

- `verification` §1 and R12 say validation reads working-tree files and "checks the committed content as well as the working tree"; `R40` says uncommitted changes are ignored. The "says which one a finding came from" clause softens this, but §1 should say that status and outdated checks use committed content only.
- `verification` R12 lists "an approved specification whose content changed since approval" as a finding; by `R11.3` such a specification is no longer Approved.
- `verification` R24.1: "When there are no warnings it says so briefly or is left out; this is the same in both cases of the setting being on" is unclear. Say which.
- `steering` R59 "Contradictions" covers only same-layer conflicts; add the `R65` rule that a cross-layer conflict is resolved by following the higher layer and reporting it.
- `specifications` §1 omits that the page describes feature specs as "with minimal architecture included" (conflict question 10); `R4` in the same spec says "should ideally not appear". Harmless, but say that exceptions are the user's call, which R4 already does.
- `roles-and-permissions` R56 and the common preset list rely on a configuration setting for the active preset, but `R25` is Phase 2 in `docs/release-plan.md` while presets are Phase 1. Note the dependency in `configuration`.
- `later-releases` R66 says migration writes specifications "each tracing to requirements", which is wrong for a project with no requirements (`R68`), and its test is marked deterministic although the migration is LLM-driven; make it a `Test (intelligent)`.

## Checks you asked for

- **Later-releases subproject syntax and `R39.4`:** see findings 2 and 3.
- **Dropping ADR content (conflict questions 4 and 5):** see finding 10. Acceptable reading of the page, but an unflagged assumption.
- **Decision-record preset defaults vs `roles-and-permissions`:** consistent. `later-releases` R37.1 (LLM retrieve allow; add, edit, delete request user; user all four) matches `roles-and-permissions` R57 and the table row. Only finding 12 applies to Preset 2.
- **`configuration` R25.1 vs `roles-and-permissions` preset contents:** contradicts, see finding 1. Every other default in `configuration` (`plans.start_conditions` on, `notifications.push` off, `authorship.record_llm` on, `permissions.preset` first preset, `architecture.llm_may_mark_implemented` on, `tests.logs` local) agrees with the page and the other specs.

## Other checks, no findings

- **Page R-number coverage:** every R-number except `R62` and `R63` is covered by exactly one spec; no `covers` entry is missing from the page. Every `<slug> R<n>` and `§<n>` cite resolves.
- **Release-phase marking:** matches `docs/release-plan.md`. Later releases are marked for `R21`, `R38`, `R37`, `R39`, `R43`, `R48`, `R49`, `R56` (creating, editing, deleting), role mappings in `R44` and `R44.1`, `R55.1`, `R58`, `R36.3`, `R32`, `R31.2`, `R33`, `R66`; `R22`, `R23` are Phase 2 in `steering`; requests are Phase 1.
- **Permission defaults per preset:** `roles-and-permissions` R57 matches page `R57` for all four presets (approval and configuration request user for the LLM role, protected overrides for nobody but the Administrator, soft stop allowed, test records allowed). `cli` R16.1, `harness` R20.1, `requests` R52.2 and R52.3, `plan-execution` R31.1 and R27.3 and `steering` agree with it.
- **Soft stop and start conditions:** `plans` R29.1, `plan-execution` R27.1, R27.3, R27.5.1 and `steering` agree; start conditions in `plan-execution` R27.6 and `configuration` agree and match page `R27.6`.
- **Approval and status vs `cli` R16, test records vs `verification` R61:** consistent with page `R16`, `R20`, `R61.1` to `R61.4`; a failed test blocks approval and implemented status without changing status; `R61.2` allow for LLM roles matches `roles-and-permissions`.

## Verdict

The set is close to the page and internally consistent in most places: coverage is complete, cites resolve, preset defaults and release phases agree. It should not be approved as is. Finding 1 is a direct contradiction of page `R57` and must be fixed. Findings 2 to 10 are fixable by editing a sentence or a row each; findings 2, 4 and 10 may need a user answer or a decision on the format record. Finding 11 is outside the 11 specs but will make validation fail once these are approved. After those fixes the remaining items are minor.

## Resolution

Written by session 13 on 2026-11-09. Each finding was checked against the page before changing anything; none of the findings was wrong. After the edits, a script (cite and coverage check) found: every `<slug> R<n>` and `<slug> §<n>` cite resolves to a heading, every bare `R<n>` exists on the page, every page R-number except `R62` and `R63` (and their sub-requirements) is covered, and each `references` list equals the set of cites in the body, excluding cites of what the spec itself covers.

| # | Result | What was done |
|---|--------|---------------|
| 1 | Fixed | `configuration` R25.1 now says request user for the LLM role in every default preset; the deny scenario is a custom-role example. The `R47` cite became `roles-and-permissions R55`. |
| 2 | Fixed | Syntax `<project>:<cite>` added to the format record's citation table, `specifications` R7 "Citing" and `later-releases` R39.3. `root` is reserved and spec IDs are unique per project. Marked as an assumption. `subprojects` setting added to `configuration` R25 (later release). |
| 3 | Fixed | The invented second bullet of `later-releases` R39.4 is deleted. |
| 4 | Fixed | `configuration` R25 gained `harness.separation_check`, `plans.parallelism`, `subprojects`, `strict_mode.*`, `bypass_guards.*`, `roles.os_user_mapping`, `roles.llm_rules` (later-release ones marked), plus `coverage.requirement_only`. Defaults for the separation check (`on`) and bypass guards (`on`) are assumptions. A note was added that presets are Phase 1 while configuration is Phase 2 (minor 17). |
| 5 | Fixed | The `skipped` step status and the decision to skip are removed from `plans` and `plan-execution`; a step the user no longer wants is removed by editing the plan. Page R27's denial has no exception. The `steering` scenario that skipped a step now continues unblocked work or soft stops. |
| 6 | Fixed | The Requests row no longer implies an accept permission. Rows added for read-only checks (information retrieval) and for marking implemented (record-a-test-result permission, plus `architecture.llm_may_mark_implemented`). A note says switching to the Administrator is a role change under R44. Page R50 says every command has granular permissions; the specs now say explicitly which commands use an existing permission rather than own one. |
| 7 | Fixed | "Exactly one" is removed from `specifications` R5 and `verification` R64, and from the format record. `verification` R64 now says coverage is read from `covers` plus citations. Several covers are allowed and not a warning. |
| 8 | Fixed | The bot-account, model-choice and "documented before release" notes are removed from `steering` R22. |
| 9 | Fixed | Cites corrected in `harness` (R11.3, plans R30.1, roles-and-permissions R57), `verification` (specifications R1, R68, plans R29.3) and `configuration`; all `references` lists regenerated from the body. |
| 10 | Fixed | The ADR and overlay drops are labelled as assumptions awaiting the user's confirmation, citing conflict questions 4 and 5, in `later-releases` R37 and R39. |
| 11 | Deferred | Not edited by instruction (architecture specs and `.specplane/config.yaml`). Recorded in HANDOFF as the next task, "rewrite architecture specs from the feature specs". |
| 12 | Fixed | `roles-and-permissions` R57: creating and editing plans is request user in preset 2, labelled an assumption. |
| 13 | Fixed | Assumption labels added: `plan-execution` R27 worktree location and merge policy, `plans` §2 file layout, `harness` marked block and "user names the harness", `specifications` R65 same-layer rule, `cli` R17.1 combination rule. `cli` R16 confirmation can be given in advance by a flag. File-layout detail was not moved out of `plans` §2; it moves with the architecture rewrite. |
| 14 | Fixed | `specifications` R5 states that requirement-only is the owner's choice; `R62` and `R63` with sub-requirements are never reported by coverage, and other requirements are listed in `coverage.requirement_only`. |
| 15 | Partly fixed | Illustrative cites no longer use backticks, unused references are pruned, and the format record's example now has `covers` before `references` (as ten specs do). Left: unnumbered `###` subsections ("Citing", "Metadata for all layers", "How a permission applies", "Permission kinds", "Settings", "Validation", steering's three headings). They sit under a requirement's section and belong to it, so they are citable through it. |
| 16 | Fixed | The history sentence in `configuration` R25 is deleted. The overlay sentence in `later-releases` R39 became the assumption note from finding 10. |
| 17 | Fixed | `verification` §1 and R12 now say status and outdated checks use committed content; the "approved spec whose content changed" item is dropped; R24.1 says what is shown with no warnings; `steering` R59 gained the cross-layer rule; R66 tracing depends on the project having requirements and its test is `Test (intelligent)`. Left: `specifications` §1 does not mention the page's "minimal architecture" wording; R4 already makes exceptions the user's call. |
