# Second check of the rewritten feature specs (session 15)

Written 2026-11-09 by session 15, which wrote and approved none of the 11 specs. Nothing in the specs, the page, config, hooks or CLI was edited.

## Verdict: pass with notes

No blocker. Approval records are intact, all cites and coverage resolve, and the review's blocker and should-fix items 2 to 9 are really fixed in the current text. I found 1 should-fix, 4 minor and 2 notes; none contradicts the page outright.

## Findings

1. **Should-fix. `plans` §3.1 / R30.1 and `plan-execution` R27: "continue with later steps" can skip a step.**
   `plans` (step dependency bullet) and `plan-execution` R27 ("Steps that implement an unapproved specification") say that a step waiting for approval is held "while later work that does not depend on the specification continues". But `plans` §3.1 says steps "run in order" and "the next step is the lowest-numbered step that is not done", `plan-execution` R27 requires the first step of any selection to be the next step, and `plan-execution` R27.2 says a resume "does not skip steps". Page `R27` says the harness denies a selection that skips an uncompleted step; page `R30.1` only says the implementing step "cannot run until it is Approved". Running a later step while an earlier one is held is exactly the skip that R27 denies.
   Fix: say that the plan stops at the held step (soft stop, naming the approval it waits for, `plan-execution R27.3`), and that only work inside the same step that does not depend on the specification may continue. Remove "later steps" from both places.

2. **Minor. `plan-execution` R27.6 and `plans` line 48: plan-to-plan start rule is not on the page and is miscited.**
   Page `R27.6` is about Approved status of the plan and the specifications it references. The spec adds "a plan that references another plan does not start before that plan is completed", a "start anyway" override, and "plan dependencies and cycles are still checked" with the check off, with no assumption label. `plans` cites this rule as `plan-execution R27` although it lives in R27.6. The override is also close to the skip the page denies.
   Fix: label it an assumption (or drop it), and correct the cite to `plan-execution R27.6`.

3. **Minor. `roles-and-permissions` R57 scenario (Full Manual Editing) vs `requests` R52.3.**
   The scenario says the step stops "with a soft stop or sends a request". `requests` R52.3 says deny cannot send a request for that action. The only sensible request there is to change the preset, which is a different permission.
   Fix: reword to "stops with a soft stop, naming the denied permission".

4. **Minor. `covers` granularity is inconsistent.**
   `cli`, `requests`, `harness`, `verification`, `configuration`, `roles-and-permissions` and `later-releases` list sub-requirement IDs in `covers`. `plans` (R28, R29, R30), `plan-execution` (R27, R31) and `specifications` (R10, R11) list only the parent, while the body has `###` sections for R10.1, R11.1 to R11.4, R27.1 to R27.6, R28.1, R29.1 to R29.3, R30.1, R31.1, R31.2. Coverage by sub-requirement works only if a parent counts for its children, which no spec states.
   Fix: list the sub-IDs in those three `covers` lists, or state in `specifications` R5 that covering a requirement covers its sub-requirements.

5. **Minor. `later-releases` R37 and R37.1: leftover and unclear wording.**
   R37 says old records are "never approved by an LLM", which is an old-decision-record rule, not a page rule (the page says nothing about approving records). R37.1 says that with retrieve at deny "records exist only if the user asks", which does not say what happens.
   Fix: drop "never approved by an LLM"; reword to "the LLM is not shown records and does not say whether any exist".

6. **Note. `configuration` Validation heading** cites `(verification R12, R12)`, the same requirement twice. Cosmetic.

7. **Note. Approval was given by an LLM, not a human.**
   All 11 records say so (`approval.by.llm`, `delegated-by: spiralsky`), which is honest and matches the format record. The page R11 says approval is by a role with the permission, and the project's CLAUDE.md says approvals stay with the user. Under the hand-edit workflow the status says "approved" with no human review behind it. The user may want to re-approve through the CLI once it reads the new format. `requests` has `approval.commit` 54df3f9 (the earlier commit that last changed it) and the other ten have 9d26072; both are correct.

## Verified clean

1. **Approval integrity (script).** All 11 specs have `status: approved` and an approval block with `by`, `llm`, `delegated-by`, `date`, `commit` and `note`. Every `approval.commit` exists and contains the file. The body at that commit equals the current body byte for byte for all 11, and the front matter minus `status`, `approval` and `authors` also matches. The only commit after the approval commit that touches any spec is `2f88617` (the approval edit); no content changed after approval. `git status` shows only `problems.md` and `docs/codex-vs-claude-usage-analysis.md` untracked.
2. **Cites and coverage (script).** Every `<slug> R<n>` and `<slug> §<n>` cite in backticks resolves to a heading in the named spec. Every bare `R<n>` is either the spec's own heading or one of the page's 127 IDs. Each `references` list equals the set of cites in the body, excluding what the spec covers itself (the `R7` example in `later-releases` R39.3 sits inside a larger cite, and `specifications R7` is in the list). Of the 127 page IDs, all are covered by exactly one spec's `covers` or by a `###` section under a covered parent, except `R62` to `R62.5` and `R63`, which are requirement-only as the format record allows. No duplicate covers, no cover of a retired ID, no cover of a non-page ID.
3. **Review fixes.**
   - Blocker (`configuration` R25.1): request user for the LLM in every preset; deny is only a custom-role example; agrees with page R57 and `roles-and-permissions` R57.
   - Item 2: `<project>:<cite>` syntax, `root` reserved, labelled assumption (`later-releases` R39.3).
   - Item 3: second bullet of R39.4 gone; only the page rule plus a root-wins warning remain.
   - Item 4: `configuration` R25 now lists separation check, parallelism, subprojects, strict mode, bypass guards, role mapping and LLM rules.
   - Item 5: `skipped` removed from `plans` and `plan-execution`. Finding 1 above is a remaining way round it.
   - Item 6: the Requests row no longer implies an accept permission; read-only checks and "mark implemented" are stated.
   - Item 7: "exactly one" is gone; `verification` R64 says coverage is `covers` plus citations.
   - Item 8: the bot-account, model-choice and documented-before-release notes are gone from `steering` R22.
   - Item 9: `harness` cites R11.3, `plans R30.1`, `roles-and-permissions R57`; `verification` cites `specifications R1`, `R68` and `plans R29.3`.
   - No new contradiction found between `roles-and-permissions`, `configuration`, `plan-execution`, `requests` and `later-releases` on the LLM's approval, configuration, soft stop, plan permissions and decision-record permissions, apart from findings 1 to 3.
4. **Page conflicts.** I re-read the whole page. Presets, protected overrides (Administrator only), levels 10/5/special, R44 mapping and switching, R48 storage and trust, R52 request rules, R16 group approval, R20 and R20.1, R21.1 and R38.1 reuse of R26, R27.1 to R27.5 budgeting, resume and requests, R36 and R61 test and implementation rules, R39 subproject rules and R66 migration are all present and consistent in the specs. No omissions found beyond findings 1 to 3.
5. **Residue.** Searching all 11 specs for `llm_role`, leak guard, overlays, `PLANS.md`, `skipped`, draft and review statuses, `authorship` policy, ADR, `decisions.dir`, `spec_roots` found only: the two labelled overlay-as-assumption notes in `later-releases`, "no skipped status" statements in `plans` and `plan-execution`, and the legitimate `authorship.record_llm` setting (page R10). No draft or review status, no `llm_role`, no leak guard, no PLANS.md.
