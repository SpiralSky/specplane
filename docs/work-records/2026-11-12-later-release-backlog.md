# Later-release backlog (2026-11-12)

Source: the requirements coverage review of 2026-11-12. First-release requirements had no gaps. The requirements page has no "later release" carve-out and wins over `docs/release-plan.md`, so all eight items below are in scope. The user owns `docs/requirements/product-requirements.md`; do not edit it. Everything else is the agent's call.

Order (one subagent per unit, in order; each unit updates specs, code, tests and user docs, runs `npm test`, hooks tests, check-sync and validate, and commits):

- [x] V1 Subprojects: R39, R39.1-R39.4 (see V1 notes)
- [ ] V2 Decision records: R37, R37.1 (`/decision-new`, permissions, storage)
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
