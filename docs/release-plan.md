# Release Plan

This is the intended build order for `docs/requirements/product-requirements.md`. It cites requirement IDs and can change without changing the requirements. Sub-requirements follow their parent unless listed separately. `R62` and `R63` define scope and apply throughout.

## Phase 1: Plans

Plans come first so that an agent can carry out the remaining work, including writing specifications (`R30.1`).

- Specification basics: `R1`, `R2`, `R7`, `R9`, `R11`, `R16`, `R40`, `R68`
- Plans, including budgets (`R27.1`): `R27`, `R28`, `R29`, `R30`, `R31`, `R67`, `R69`
- Harness: `R18`, `R19`, `R20`, `R26`, `R34`, `R35`
- Requests: `R52`
- Default roles, presets and steering: `R42`, `R46`, `R47`, `R50`, `R51`, `R55`, `R57`, `R59`

## Phase 2: Rest of the first release

- Specification format and metadata: `R4`, `R5`, `R10`, `R12`, `R17`, `R65`
- Tests and coverage: `R36`, `R61`, `R64`
- Auditing and warnings: `R13`, `R24`
- Commands and configuration: `R14`, `R25`, `R54`
- Identity without role mappings: `R44`
- Documentation: `R22`, `R23`

## Later releases

- Spec review command: `R38`, built after the first release was assembled
- Spec viewing command (Claude Code): `R21`, built after the first release was assembled
- Decision records: `R37`
- Subprojects: `R39`
- Custom roles and role management: `R43`, `R48`, `R49`, `R56`, `R60`, and role mappings in `R44` and `R44.1`, built after the first release was assembled
- Stronger enforcement: `R55.1`, `R58`, `R36.3`, `R32`
- Plan parallelism: `R31.2`
- CLI plan management: `R33`
- Project migration: `R66`
