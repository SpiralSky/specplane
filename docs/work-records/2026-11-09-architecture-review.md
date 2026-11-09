# Review of the architecture specs

Written 2026-11-09 by an independent reviewer (not the author). Scope: `architecture/file-formats`, `repository-layout`, `reference-cli`, `agent-skills` against the page (`docs/requirements/product-requirements.md`), the 11 approved feature specs, `AGENTS.md`, and `2026-11-09-architecture-rewrite-plan.md` and `2026-11-09-spec-format.md`. No spec was edited. The higher layer wins in every conflict below.

Mechanical checks (script run over all 15 specs): every cite in every `covers`, `implements` and `references` list resolves to a real heading or requirement marker; the page has 127 requirement markers with no duplicate IDs, no orphan sub-IDs and no ID both live and retired; all `§n` self-references resolve except one (`agent-skills` `§7.13`). Result: 3 blockers, 16 should-fix, 14 minor.

Coverage summary (check 1): of the feature sections, the only ones no architecture `implements` list names are the `§1`/`§2` term and edge-case sections (not behaviour), `harness R21.1`, `harness R38.1`, `later-releases R37.1`, `R39.1` to `R39.4`, `roles-and-permissions R44.1`, `R60`, `specifications R4`, `R65`, `R68` and `plans §3.2`, `§3.3`. All of these are handled in prose or deliberately left to a later release (see M1); none is a missing design except documentation (S13) and the plan CLI surface (S16). Requirements `R62` and `R63` have no feature spec by design.

## Blockers

### B1. A spec that cites a never-approved spec stays Approved

- File and section: `file-formats` §4.5 step 5; `reference-cli` §5.2 (no step covers it).
- Problem: `specifications R11` has the scenario "Given a spec was never approved, When a spec that cites it is checked, Then the citing spec is Awaiting Review". `file-formats` §4.5 step 5 says the opposite: a spec citing a never-approved spec "is still evaluated by these rules", and approval order is enforced only at approval time. A spec approved by hand or by override, or whose cited spec was reopened, therefore stays Approved.
- Fix: add a step to §4.5 and `reference-cli` §5.2: for each spec dependency (not requirement files) that has no `approval` block, add reason `outdated: <cite>` (or a distinct `unapproved-dependency: <cite>`). Do not use "dependency is effectively awaiting-review", because that would break `specifications R11.2` (a change elsewhere in the cited spec must not matter). Members of a group approved in one command all have blocks, so groups are unaffected. Add the reason to the §2.5 grammar.

### B2. Hand-approved specs (the 11 approved features) become Awaiting Review under the new algorithm

- File and section: `file-formats` §4.5 step 3 versus §2.3; `reference-cli` §5.2 step 3.
- Problem: §2.3 says approvals written by hand without `fingerprint` and `cited` "are valid while `commit` is reachable". But §4.5 step 3 and `reference-cli` §5.2 step 3 treat every dependency absent from `approval.cited` as changed. Hand approvals have no `cited`, so every cite counts as changed and all 11 approved feature specs would be reported `awaiting-review` with `outdated` on every cite the first time the CLI reads the format (rewrite step 7).
- Fix: when `approval.cited` is absent, compute each part fingerprint from the cited target as committed at `approval.commit` and compare with now (and treat a target missing at that commit as changed). Say so in §2.3, §4.5 and `reference-cli` §5.2, and add a deterministic test that a spec in the hand format stays approved until a cited part changes.

### B3. Plan budgets are kept in the local store, but the page puts them in plan metadata

- File and section: `reference-cli` §11.4 and §3.3 (`budgets.json`); `file-formats` §5.4 (no budget field).
- Problem: `R27.1` says "Hard and soft stops along with plan status should be attached to the plan metadata". The design stores budgets in `<git-common-dir>/specplane/budgets.json`, which is per machine, not on the plan branch, lost on a fresh clone and invisible to a resumed session elsewhere. The author flags it as an assumption, but it contradicts the page, so it is not a legitimate gap-filler.
- Fix: add `budget: [{resource, soft, hard}]` to `progress.yaml` (§5.4) or to PLAN.md frontmatter, write it with the plan commits, and drop `budgets.json` from `reference-cli` §3.3. Keep usage readings local; only the limits and the recorded stop belong in plan metadata.

## Should-fix

### S1. The two specs disagree on overridden approvals
- `file-formats` §2.4 says an overridden approval "is not checked against the fingerprint on the first calculation after it is written". `reference-cli` §5.2 item 6 says this wording is replaced (the override writes real fingerprints). A stateless calculation cannot know "first calculation", so the `file-formats` text is unimplementable.
- Fix: rewrite §2.4 to the `reference-cli` behaviour (override writes `fingerprint` and `cited` from HEAD content) and delete the "first calculation" sentence; drop the "assumption: replaces" note in `reference-cli` §5.2.

### S2. A plan's commit pins are part of its fingerprint but described as a metadata edit
- `file-formats` §5.2: the plan fingerprint is `spec-v2` over the frontmatter minus `status`, `approval`, `authors`, `review-reason`, so `implements[].commit` is content; yet "updating the pin is a metadata edit". Updating a pin after checking what changed (`plans R29.3`) would return the plan to `awaiting-review` and block `plan start` (`plan-execution R27.6`).
- Fix: exclude `implements[].commit` from the plan fingerprint (or store pins in `progress.yaml`), and state it in §5.2.

### S3. `plan/<id>` and `file:<path>` cites are outside the cite grammar
- `file-formats` §3.1 grammar allows only `feature`/`architecture` layers and `FILE#req`. §5.1 and §5.2 use `plan/<id>`, §12.3 and `reference-cli` §4.3 use `file:<path>`, and step `context` uses `{file: ...}` maps. `file` also matches the `project ":"` prefix rule (`NAME`), so `file:docs/x.md` parses as project `file`.
- Fix: add `plan` to `layer` (or a `plan-ref` production), add `file ":" PATH` as a production with `file` reserved as a project name (extend the `root` restriction in `later-releases R39.3` handling), and use the same shape in step `context`.

### S4. Test logs in git have four different locations
- `file-formats` §11.4: `<plans.dir>/../test-logs/`; `repository-layout` §1 tree: `docs/test-logs/` (sibling of `plans/`); `repository-layout` §4 table: `<plans.dir>/test-logs/*.log`; `reference-cli` §10.5 follows §11.4. §4 also contradicts its own §1 rule that `archive/` is the only non-plan folder in `plans.dir`. Deriving the path from `plans.dir` is also wrong because plans are optional (`R69`).
- Fix: add `paths.test_logs` (default `docs/test-logs`) to `file-formats` §6/§6.1 and use it in all four places.

### S5. Local store inventory differs between specs
- `file-formats` §9.1 and `repository-layout` §2 list `requests/`, `audit.jsonl`, `logs/`, `worktrees.json`, `trusted-rules.json`, `os-users.yaml`. `reference-cli` §3.3 adds `runs/`, `reviews/`, `sessions/`, `role.json` (and `budgets.json`, see B3) "not in that table". `repository-layout` §7 invariant lists only three places the tool writes.
- Fix: move the five files into `file-formats` §9.1 with their formats (run marker, review record, session delivery record, role switch), mention them in `repository-layout` §2, and delete the assumption note in `reference-cli` §3.3.

### S6. Request record: single permission, list, and a fourth state
- `file-formats` §9.2 has one `"permission"` string; `reference-cli` §7.3 says a command may need several permissions and §8 accepts with "the request's permission list". `reference-cli` §8 stores `params.patch`, which the §9.2 schema lacks. `file-formats` §9.2 and `reference-cli` §8 add state `failed` (citing `requests §2`), but `requests` only has accepted and declined and says that an impossible action is reported and "does nothing".
- Fix: make `permission` a list (`permissions`), add `params.patch` to the schema, and either mark `failed` as an assumption beyond `requests` (and say the request stays pending or is marked answered) or drop it.

### S7. The preset example does not match `roles-and-permissions R57`
- `file-formats` §7.2: the `llm` entry lists only spec create/edit/delete, `spec.approve`, `config.change`, `info.retrieve`, `test.record`, `meta.read`, `plan.softstop`. Per R57 the LLM also needs `plan.create`/`plan.edit` (allow in presets 1, 3, 4; request-user in 2), `plan.start`/`resume`/`abandon`/`complete`/`delete`/`budget` request-user, `decision.retrieve` allow and add/edit/delete request-user. The text calls these "common to the four presets", but with `default_mode: deny` the shown file would deny them.
- Fix: give the complete `llm` block, or a table per preset with every permission, and make `reference-cli` §7.4 test that presets state them.

### S8. Whether reads need a permission is stated three ways
- `reference-cli` §7.3: operations that need no permission include "reads, validation, running tests"; §13.1 lists `validate`, `warnings`, `test run`, `audit` as "none". `reference-cli` §12.1, `file-formats` §7.1 and `roles-and-permissions` say read-only checks use `info.retrieve` and that test runs need it (`verification §2.2`).
- Fix: in §7.3 say those operations are guarded by `info.retrieve` without needing an `Authorized` token; in §13.1 write `info.retrieve` instead of "none".

### S9. Harness action registry is missing actions the contracts use
- `reference-cli` §12.1 has no `plan.list` (used in `agent-skills` §7.7), no merge action (`agent-skills` §7.6 step 5 tells the LLM to offer `plan merge`, a CLI command, while §8 says contracts never name CLI commands), and no `harness.report-warning` (used in `reference-cli` §6.1).
- Fix: add `plan.list` and `warnings.report`, and decide merge: either an action (`plan.merge`, guarded by `plan.complete`) or reword §7.6 so the LLM tells the user to run the human command (and drop §8's "never name" claim for that case).

### S10. Dangling section reference and a leftover status word in `agent-skills`
- `agent-skills` §6 cites `§7.13` (does not exist; decision-new is in §7.11). §1 "No approval" lists `approved`, `ready` or `completed`: `ready` is the removed plan status.
- Fix: change to `§7.11`; replace the list with `approved` and the plan `completed`/`abandoned` declarations.

### S11. Committing of Specplane-written metadata is unspecified; approval commit is invented
- `reference-cli` §5.3 step 6 makes `specplane spec approve` create a commit (`docs(specs): approve <id>`, `--no-commit`). `cli R16` does not say the command commits and the step is not marked "assumption". Elsewhere writes to `results`, `implementation`, metadata, review state, config and `spec reopen` (`§10.3`, `§10.4`, `§13.2`, `§5.4`) never say whether they commit. Under `R40` uncommitted changes are ignored, so an uncommitted result or `implementation` block has no effect and an LLM `spec.edit` (changing content, writing `review-reason`) leaves the repo dirty.
- Fix: add one rule in `reference-cli` §3 or §13.3: which commands commit (name them, with the workflow and message from `file-formats` §8) and which leave the change in the working tree, and mark the approval commit "assumption".

### S12. The central requirements file cannot be identified
- `file-formats` §1.2 and `reference-cli` §4.4 say the parser reads "the requirement files named in the central file", but nothing says which file is central (the page, `R2`, only says one central file exists). `paths.requirements` is a directory.
- Fix: add a rule (for example a setting `paths.requirements_index`, default: the only file in the directory, else the file named `index.md`/`README.md`, else error) and a validation finding for zero or several candidates.

### S13. Required user-documentation content and location are not designed
- `steering R22` requires user docs "in the repository's docs and from the CLI" and notes for `R16` group approval, `R20.1` (allow approves without confirmation), `R13.1` (retention default), `R61.4` (logs in git warning), `R35.1` (per-harness support). `repository-layout` has no docs folder and `reference-cli` §12.5 puts docs only in package `assets/docs/` with a manifest; no section lists the mandatory notes or tests that they exist (`steering R22` has an intelligent test over commands and keys).
- Fix: add to `repository-layout` §1 where user docs live in the repository (and that `build-docs` copies them to `assets/docs/`), and to `reference-cli` §12.5 a manifest of required topics including the five notes, plus a deterministic test that every catalog permission, command and configuration key appears with its default.

### S14. `architecture/INFO.md` is stale (and `features/INFO.md` is partly stale)
- `architecture/INFO.md` lists specs with statuses `review` and `approved`, an `architecture/ci` spec, old feature IDs (`feature/spec-system`, `plan-steps`, `spec-overlays`, ...), harness overlay roots and `claude:architecture/claude-integration`. The set is now four `awaiting-review` specs and `ci` was deleted. `features/INFO.md` says all specs "are `awaiting-review`" (they are approved) and cites `specplane spec approve` while `reference-cli` §13.1 uses the same command, so only the status sentence is wrong.
- Fix: rewrite `architecture/INFO.md` from the rewrite plan; fix the status sentence in `features/INFO.md`.

### S15. Layout invariants and `.specplane/` contents conflict with other sections
- `repository-layout` §7 says Specplane writes only inside the repository, `plans.worktree_dir`, or `<git-common-dir>/specplane/`. `reference-cli` §14.2 writes `git rev-parse --git-path hooks/pre-commit` (outside, possibly via `core.hooksPath`) and exports the index to a temporary directory; §10.2 uses a detached worktree "under the local store" (fine) but `check tests` does not. `repository-layout` §1 says `config.yaml` "is the only file in `.specplane/`", while `file-formats` §7.4 puts `roles/*.yaml` there (later release). `repository-layout` §5 "Opt out" says a `harness` setting forbids the block, but `file-formats` §6 has no such key (same dangling idea in `agent-skills` §2).
- Fix: add the hooks path and a system temp directory to the invariant, qualify "only file" as "in the first release", and define `harness.install_block: on|off` in `file-formats` §6/§6.1 and `configuration` by reference.

### S16. The human CLI plan lifecycle is not stated by the feature specs
- `reference-cli` §13.1: `plan start|stop|resume|review|finish|merge|abandon|delete|budget|retarget`. `plan-execution R31` says plans are managed through the harness and `cli R33` limits the CLI to plan metadata (a later release). `R47` keeps the LLM off the CLI, so the commands are for people, but the feature layer never says a person can start, stop or finish a plan from the CLI. `plan retarget`, `--force-deps`, `merge --pr|--local` are marked assumption only in part.
- Fix: mark the human plan commands as an assumption beyond `cli R33` (or have the harness user-command runner be the only front end in the first release), and list `plan retarget` explicitly as assumption in §13.1.

## Minor

- **M1. Some implemented sections only appear in `references`, not `implements`.** `specifications R4`, `R65`, `R68` (`agent-skills` §3/§4, `reference-cli` §6.1), `roles-and-permissions R44.1`, `R60`, `later-releases R37.1`, `R39.1` to `R39.4`, `harness R21.1`, `R38.1`, `plans §3.2`, `§3.3`. Add them to `implements` (or add a one-line "left to a later release" note in `reference-cli` §15).
- **M2. Frontmatter hygiene.** `file-formats` lists but never cites in the body `cli R17`, `plan-execution R27.1`, `R1`, `R9` (warning by its own §2.1); its §3.2 example spans `R52.3` and `steering R59` are cites by its own rule but are not listed. `repository-layout` lists `architecture/file-formats §1.2` and `§12.3` that appear only unbackticked or inside a code block. Remove or cite.
- **M3. Section "Implements" lines name cites that the frontmatter files under `references`** (`file-formats` §2.3, §2.4, §5.4, §5.5: `cli R16`, `cli R17.2`, `plan-execution R27`, `R27.2`, `R27.4`). `agent-skills` frontmatter `implements` has 11 entries no section's "Implements" line states. Align the two.
- **M4. Requirement range wording.** `file-formats` §1.2 says a requirement's text "runs to the next marker or heading" and also "includes its sub-requirements". Say: to the next marker of equal or shallower depth, or the next heading.
- **M5. Override mark has two shapes.** `approval.override: true` versus `override: {by, date}` in results (§2.4, §11.1). Use the map in both.
- **M6. File names versus the naming rule.** `repository-layout` §6 says created files use lower-case names, but `PLAN.md`, `HANDOFF.md`, `INFO.md` are upper case; its 200-character limit on plan paths has no matching rule in `file-formats` §5.1.
- **M7. `requirement/<file-stem>` IDs** (`file-formats` §1.2) are missing from §1.1, the §3.1 grammar layers and the §12.1 table.
- **M8. Unmarked user-visible text.** `reference-cli` §6.3 (`N warnings; run ...` line) and §13.3 exit codes 2 to 4 are not marked assumption (`R24.1` only requires the count).
- **M9. Over-broad "Implements" on §1 and §2 of `reference-cli`** (`cli R16`, `harness R34`); name the sections they really implement.
- **M10. `plan.create` commit.** `file-formats` §8 defines `docs(<slug>): create plan`, but `reference-cli` §11.5 does not say `plan.create` commits.
- **M11. `progress.yaml` stores both `done` and `current_step`.** `current_step` is derivable (lowest step not done); say it is derived and ignored on read, or drop it.
- **M12. Audit of reads.** `R13` says all actions; `reference-cli` §9 audits guard decisions and the command runner, but §7.3 says reads take no token. State that the runner audits every command, reads included.
- **M13. `role.json` Administrator switch is local file state** that a CLI run by an LLM in a shell would also honour. Acceptable under `R55` (not airtight) but note it in §7.5, or tie the switch to a person's terminal.
- **M14. `plan-step` session start** (`agent-skills` §7.5, §7.4): the user must open a session in the worktree. `R27` says "start a plan run through the harness"; say whether the adapter can open that session (capability) or mark the manual step as assumption.

## What checked out

- Frontmatter: no unresolved cite, no duplicate list entries, `covers` equals the set of `R` headings in all 11 feature specs, every architecture `implements` item points to a real feature heading.
- Statuses: only `awaiting-review` and `approved` appear for specs; plan execution statuses match `R29.1`; reason names (`never-approved`, `edited`, `outdated: <cite>`) agree between `file-formats` §2.5 and `reference-cli` §5.2.
- Config keys: every key used in `reference-cli`, `agent-skills` and `repository-layout` exists in `file-formats` §6, and the feature keys all appear there (extras `paths.*`, `plans.dir` are marked assumption).
- Removed concepts: no draft or review spec status, overlays, pins, `PLANS.md` generation, leak guard, `llm_role` or authorship policy is used as live behaviour. They appear only in deletion lists and "reported as unknown" lists (`file-formats` §6.2, §8; `reference-cli` §2), apart from S10 and S14.
- Fingerprint design (check 6): the two-fingerprint scheme (whole spec `spec-v2`, cited part `sec-v1`) is implementable: it needs only the committed blobs, survives rebase and squash because it never depends on commit hashes (apart from the hand format, B2), group approval is consistent (members' bodies do not change when approval blocks are written), and it matches `R11`, `R11.2` and `R11.3` except B1 and the two points below. Two things to decide while fixing: (a) `spec-v2` counts `title`, `covers`, `implements`, `references` as content, while the page calls dependencies metadata (`R9`, `R11.3`); a reordered `references` list alone makes a spec Awaiting Review. Either exclude those three keys (adding a reference is still caught by "absent from `cited` counts as changed") or state the choice as an assumption. (b) `approval.commit` records the last content commit, not "the commit it was set on" (`R11`); the rewrite record explains why, and it is sound, but `file-formats` §2.3 should say it in one line.

## Resolution

Written 2026-11-09 by the author of the architecture specs. All 33 findings were applied by editing the four architecture specs (and the two `INFO.md` files for S14); no feature spec, the requirements page or any status was changed, and nothing was approved. Frontmatter `implements` and `references` of the four specs were regenerated from the body cites and the sections' "Implements" lines, and a script confirmed that every cite in the frontmatter and body resolves and that the two lists match the body (M2, M3). Result: 27 fixed, 0 declined, 6 decisions (B2, S9, S11, S12, S13, S16; each is also applied in the specs and explained below), 33 in all.

| ID | Outcome | Where |
|----|---------|-------|
| B1 | fixed | `file-formats` §4.5 step 4 and §2.5 (`unapproved-dependency: <cite>`); `reference-cli` §5.2 step 5 |
| B2 | decision | `file-formats` §2.3, §4.5 step 3; `reference-cli` §5.2 step 3 and a deterministic test (see D1) |
| B3 | fixed | `budget` moved to `progress.yaml` (`file-formats` §5.4); `budgets.json` dropped (`reference-cli` §3.3, §11.4) |
| S1 | fixed | `file-formats` §2.4 rewritten; assumption note removed from `reference-cli` §5.2 |
| S2 | fixed | `file-formats` §5.2 (`plan-v1`, pins excluded); `reference-cli` §5.1 |
| S3 | fixed | `file-formats` §3.1 grammar (`plan-ref`, `file-ref`, reserved `file`), §3.4, §5.3 `context` as cite strings |
| S4 | fixed | new `paths.test_logs` (`file-formats` §6, §6.1, §11.4); `repository-layout` §1, §4; `reference-cli` §10.5 |
| S5 | fixed | `file-formats` §9.1 and new §9.3 hold the five files and formats; `repository-layout` §2; `reference-cli` §3.3 |
| S6 | fixed | `file-formats` §9.2: `permissions` list, `params.patch`, `failed` marked as an assumption beyond `requests §2` |
| S7 | fixed | `file-formats` §7.2: complete LLM block for preset 1 and a table for presets 2 to 4; `reference-cli` §7.4 test |
| S8 | fixed | `reference-cli` §7.3 and §13.1 (`info.retrieve`) |
| S9 | decision | `plan.list`, `plan.merge`, `warnings.report` added (`reference-cli` §12.1); see D2 |
| S10 | fixed | `agent-skills` §6 (`§7.11`) and §1 "No approval" |
| S11 | decision | new `reference-cli` §13.4; approval commit marked assumption (§5.3); see D3 |
| S12 | decision | `file-formats` §1.2, `paths.requirements_index`; `reference-cli` §4.4; see D4 |
| S13 | decision | `repository-layout` §1 (`docs/user/`); `reference-cli` §12.5 manifest and test; see D5 |
| S14 | fixed | `architecture/INFO.md` rewritten; one sentence in `features/INFO.md` (documentation, not a spec) |
| S15 | fixed | `repository-layout` §1, §7 (hooks path, `tmp/` instead of a system temp directory), `harness.install_block` (`file-formats` §6, §6.1; `agent-skills` §2) |
| S16 | decision | `reference-cli` §13.1: human plan commands, `plan retarget` and `--force-deps` marked as assumptions; see D6 |
| M1 | fixed | named sections moved into `implements` (`agent-skills` §3, §4, §7; `reference-cli` §15 line) |
| M2 | fixed | unused references removed; unlisted cites made to resolve; body cites added in `repository-layout` |
| M3 | fixed | frontmatter regenerated from the section "Implements" lines; `agent-skills` §2 and §7 lines extended |
| M4 | fixed | `file-formats` §1.2 range wording |
| M5 | fixed | override mark is one map (`file-formats` §2, §2.4) |
| M6 | fixed | `repository-layout` §6 states the fixed upper-case names; plan ID limited to 64 characters (`file-formats` §5.1) |
| M7 | fixed | `requirement/<file-stem>` in `file-formats` §1.1, §3.1, §12.1 |
| M8 | fixed | `reference-cli` §6.3 and §13.3 marked as assumptions |
| M9 | fixed | `reference-cli` §1 and §2 now implement only `harness R34` |
| M10 | fixed | `plan.create` and `plan.edit` commit (`reference-cli` §11.5, `file-formats` §8) |
| M11 | fixed | `current_step` declared derived (`file-formats` §5.4) |
| M12 | fixed | runner audits every command, reads included (`file-formats` §10, `reference-cli` §7.3, §9) |
| M13 | fixed | noted in `reference-cli` §7.5 |
| M14 | fixed | `agent-skills` §7.4, §7.5: manual session start marked as an assumption, capability `session opening` |

Declined: none.

The two points of the fingerprint check (check 6): (a) kept `title`, `covers`, `implements` and `references` in the `spec-v2` content and stated this as a decision in `file-formats` §4.2 (see D7); (b) the one-line explanation that `approval.commit` is the last content commit was added to `file-formats` §2.3.

### Decisions

- **D1 (B2). First-check rule for hand approvals.** The 11 hand-approved feature specs have no `approval.cited` map, and adding one would edit approved feature specs. Instead, when `cited` is absent the CLI compares each cited part as committed at `approval.commit` with now (a target missing at that commit counts as changed), so the specs stay approved until a cited part really changes, and the next CLI approval writes `fingerprint` and `cited`. This is stricter than "valid if the spec's own fingerprint matches" because it still honours `specifications R11.2`; a hand approval has no stored fingerprint either, so the fingerprint is also compared at `approval.commit`. If the commit is not reachable, the spec is awaiting-review with a warning.
- **D2 (S9).** Merging is the harness action `plan.merge`, guarded by `plan.complete`, rather than a rewording that sends the LLM to a CLI command, because `harness R47` keeps the LLM off the CLI. No new permission was added.
- **D3 (S11).** Specplane commits its own metadata-only writes (approve, reopen, override, metadata set, recorded results, implementation status, plan commands) and leaves spec content and configuration edits in the working tree; a metadata write on a file with other uncommitted changes is written but not committed. The page does not say approval commits, so it is marked as an assumption.
- **D4 (S12).** The central requirements file comes from the new `paths.requirements_index`, else the only file, else `index.md`, else `README.md`.
- **D5 (S13).** User documentation lives in Specplane's own repository under `docs/user/`, is copied to `assets/docs/` by the build, and is read in projects through `specplane docs`; the manifest names the five mandatory notes and a deterministic test requires every permission, command and configuration key with its default.
- **D6 (S16).** The human plan commands are kept as an assumption beyond `cli R33` rather than removed, so a person without a harness can run the same functions.
- **D7 (fingerprint).** `title`, `covers`, `implements` and `references` stay in the content fingerprint, even though the page calls dependencies metadata; reordering a list is an edit. Dropping them would let a changed dependency list go unnoticed.
