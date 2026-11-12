# Later-release backlog (2026-11-12)

Source: the requirements coverage review of 2026-11-12. First-release requirements had no gaps. The requirements page has no "later release" carve-out and wins over `docs/release-plan.md`, so all eight items below are in scope. The user owns `docs/requirements/product-requirements.md`; do not edit it. Everything else is the agent's call.

Order (one subagent per unit, in order; each unit updates specs, code, tests and user docs, runs `npm test`, hooks tests, check-sync and validate, and commits):

- [ ] V1 Subprojects: R39, R39.1-R39.4
- [ ] V2 Decision records: R37, R37.1 (`/decision-new`, permissions, storage)
- [ ] V3 Project migration: R66
- [ ] V4 Spec review command: R38
- [ ] V5 Custom roles and role management: R43, R48, R49, R60, role mappings in R44 and R44.1
- [ ] V6 Role permission bypass guards: R58
- [ ] V7 Strict mode: R55.1 (and R32, R36.3 if the review found them unbuilt)
- [ ] V8 Plan parallelism: R31.2

Record decisions and results per unit below.
