# Later-release backlog (2026-11-12)

Source: the requirements coverage review of 2026-11-12. First-release requirements had no gaps. The requirements page has no "later release" carve-out and wins over `docs/release-plan.md`, so all eight items below are in scope. The user owns `docs/requirements/product-requirements.md`; do not edit it. Everything else is the agent's call.

Order (one subagent per unit, in order; each unit updates specs, code, tests and user docs, runs `npm test`, hooks tests, check-sync and validate, and commits):

- [x] V1 Subprojects: R39, R39.1-R39.4 (see V1 notes)
  - [x] V1b Subproject approval, records and coverage (see V1b notes)
- [x] V2 Decision records: R37, R37.1 (`/decision-new`, permissions, storage)
- [ ] V3 Project migration: R66
- [ ] V4 Spec review command: R38
- [ ] V5 Custom roles and role management: R43, R48, R49, R60, role mappings in R44 and R44.1
- [ ] V6 Role permission bypass guards: R58
- [ ] V7 Strict mode: R55.1 (and R32, R36.3 if the review found them unbuilt)
- [ ] V8 Plan parallelism: R31.2

Record decisions and results per unit below.

## V1 notes (Subprojects)

Decisions (agent's call): `subprojects` is a list of `{name, path}` items (name kebab-case, unique, not `root` or `file`; paths inside the repo and not nested in each other). A subproject folder has `requirements/`, `features/` and `architecture/`; plans stay in the root. `Project` now carries `name`, `root` and `subprojects`; `resolveCite` resolves `<name>:<cite>`, `root:<cite>` and plain cites (own project; a subproject with no requirement files uses the root's for requirement cites). An undeclared name is a resolution error; the `later-release` resolution code is gone. Validation runs the `requirements`, `spec-format` and `cites` families inside each subproject; findings carry `project` and the text report prints per-project counts. New `subprojects` family: missing folder (error) and a precedence warning for R39.4. R65 applies in a subproject because the same layer checks run there.

Gaps: R39.4 contradiction detection is only the visible case (same title as a root requirement, different text); real contradictions need review. Approval status, notes-store records, tests records and coverage are not extended to subproject specs (a cite target in a subproject has no `specId`, so dependent specs are outdated by text change but not held by the dependency's approval). `citeKey` still treats `root:X` and `X` as equal inside a subproject. Validation scoped by spec ID skips subprojects. This repository declares no subprojects; the two `claude:R7` example cites in the specs were reworded so they are no longer cites.

## V1b notes (Subproject approval, records and coverage)

Decisions (agent's call): a subproject spec's ID is `<name>:<layer>/<slug>` (also `<name>:requirement/<stem>`); root IDs stay plain and `root:<id>` is accepted. The frontmatter `id` in a subproject stays the local `<layer>/<slug>`. `SpecDoc` carries `project` and the qualified `id`; `Project.specs` stays keyed by the local ID, and `allSpecs`, `findDoc` and `projectOf` (in `spec/project.ts`) give the root-wide view. `resolveCite` now returns the qualified `specId` for subproject targets, so approval dependencies, approval groups, `cited` fingerprints, test `against` maps and retrieval follow cites into subprojects; a spec's own cites resolve in its own project. Coverage works over all projects (items `<name>:R<n>` and `<name>:feature/<slug>`); a cite covers the item in the project it points into. `validate <ids>` now includes subprojects. `citeKey(s, inSubproject)` keeps `root:X` and `X` apart inside a subproject (cite rules use it). Specs and `docs/user/configuration.md` updated; end-to-end test in `spec/subproject-approval.test.ts`.

Follow-up done: `spec/write.ts` accepts qualified IDs (`splitSpecWriteId`; create/edit/delete in the subproject folder, undeclared project refused) and a bare slug that matches several specs raises `AmbiguousSpecError` (`findSpecId`, `spec show`). Gaps: a subproject folder is created on first write if missing (validation then reports nothing wrong). Plans that cite subproject specs use the qualified IDs but plan finish/run were not exercised on a subproject fixture.

## V2 notes (Decision records)

Decisions (agent's call): a record is `.specplane/decisions/D<n>.md` (outside the spec folders, so the old ADRs in `docs/decisions` are untouched and not imported), frontmatter `id`, `title`, `date`, optional `concerns` and `authors`, body sections Decision, Context, optional Reasons (`file-formats` §14). Approval is a notes record with subject `decision/D<n>` and fingerprint `decision-v1` (authors excluded), by ID through `spec approve` / `decision approve` under `spec.approve`; the LLM therefore only requests it. This refines `later-releases R37`, which said records are not approved. Permissions and preset modes already existed; only the "later release" labels went. `decisions.enabled` is a first-release setting (default off); with it off every write, read and the validation family refuse or skip. Harness: actions `decision.add|retrieve|edit|delete` (40 actions), request actions `decision add|edit|delete`, command `/decision-new` (contract, Claude skill, plugin command, Codex contract). Retrieval ranks by the number of query words found; no stemming.

Gaps: `decision.retrieve` under `request-user` is held as a harness read like other reads; a deleted record's approval note is left in the store; no import of old ADRs; `decision-new` without arguments only explains (needs a model turn); the Claude and Codex commands were not run live; approval of mixed spec and decision IDs is refused rather than split; `concerns` accepts any cite shape but is only checked, not fingerprinted.
