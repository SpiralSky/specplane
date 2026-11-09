# Conflicts between the requirements page and the existing project

Written 2026-11-09. This is step 1 of "Do next" in `HANDOFF.md`, plus the grouping from step 2. Nothing listed here has been changed.

**Superseded in part (user, 2026-11-09):** old specs are now reference only, to adapt or scrap, so this list shows what to change or drop rather than edits owed before work can start. "Suggested order" and question 1 no longer apply as written; `R27.1` settles the soft stop.

The page, `docs/requirements/product-requirements.md`, wins every conflict. Each item below is existing text or behaviour that would be wrong under it. Features that are simply not built yet are left out unless existing text says the opposite.

**How this was checked.** Three read-only reviews covered the specs, rules and code by area. 26 of their main quotes were then confirmed in the files. The remaining citations, and the code locations in particular, come from those reviews and were not rechecked. One finding was corrected: a review said default preset 4 gives an LLM the approval permission, but `R57` says spec approval is request user for LLM roles in all default presets.

**Totals.** 39 items: 34 firm and 5 borderline. Size means S wording, M section rework, L model or code change. Phase is where `docs/release-plan.md` builds the matching requirement.

## Group 1: Which spec wins

Text only, but repeated in about five copies: `AGENTS.md`, `.claude/rules/specplane.md`, `harnesses/claude/templates/rules/specplane.md`, `architecture/agent-skills`, `packages/cli/src/agents/standing.ts`.

| # | Requirement | Existing | Page | Size | Phase |
|---|---|---|---|---|---|
| 1 | `R65` | `feature/spec-precedence` Rule 1, "Architecture spec is the primary implementation authority"; standing text, "the architecture spec wins" | Requirements, then Feature, then Architecture | M | 2 |
| 2 | `R65` | `feature/spec-precedence` Rule 4, "Contradictions are blocking"; standing text, "stop and report it; do not implement either side"; `feature/agent-integration` contradiction handling | Follow the higher layer and report the conflict | M | 2 |

## Group 2: Spec status and approval

| # | Requirement | Existing | Page | Size | Phase |
|---|---|---|---|---|---|
| 3 | `R11` | `draft`, `review`, `approved`, `deprecated` in `feature/spec-system`, `architecture/file-formats`, `packages/cli/src/types.ts` | Awaiting Review and Approved only | L | 1 |
| 4 | `R11.3` | `feature/spec-system` line 230, "Editing an approved spec as part of a plan does not change its status" | A commit that changes content returns the spec to Awaiting Review | L | 1 |
| 5 | `R11`, `R40` | Status is an editable frontmatter field, and validation reads the working tree | Status is bound to committed content, records its commit and survives rebase; uncommitted changes are ignored | L | 1 |
| 6 | `R11.2`, `R11.4` | `spec pin` stores whole-file hashes written by hand; pins are optional and stale ones warn (`feature/spec-overlays` "Base pins") | Specs referencing changed or deleted parts become Awaiting Review automatically, with the reason recorded | L | 1 |
| 7 | `R16` | `feature/spec-policies` line 95, "An architecture spec may be approved at any time"; `spec approve` checks only overlay bases and `implements`, one spec at a time | Fails on any unapproved reference, in every layer; specs that reference each other are approved together with a warning | M to L | 1 |

## Group 3: Roles replace `llm_role`

| # | Requirement | Existing | Page | Size | Phase |
|---|---|---|---|---|---|
| 8 | `R19.2`, `R42`, `R46`, `R57` | `specs.<type>.llm_role` (`none`, `review`, `assist`, `draft`) and `authorship`, in config, standing text, skills, guard hook | Each role has allow, request user or deny, set by presets | L | 1 |
| 9 | `R20`, `R20.1` | `feature/spec-system` line 226, "An LLM agent never sets `approved`"; `feature/tooling`, `feature/agent-integration`, Claude guard hook | An LLM can be asked to approve and uses its own permission (request user by default) | L | 1 |
| 10 | `R18`, `R31.1` | `AGENTS.md` line 18, "The plan skills are user-invoked only"; `disable-model-invocation` in the Claude skill table | Typed commands run in the harness, but an LLM may run what its permissions allow | M | 1 |
| 11 | `R19.2`, `R52.3`, `R59.1` | `/spec-assist` refine-then-write and review-only modes, chosen by `llm_role` | Asking first comes from request user or from steering | M | 1 |
| 12 | `R38.1`, `R26.2` | `llm_role: none` forbids review or suggestions (`feature/agent-integration` Scenario 6) | Review uses Information Retrieval; write permission does not gate it | M | Later |
| 13 | `R55`, `R55.1` | `specplane-policy-guard.sh` blocks spec file edits by default | Blocking file edits belongs to Strict Mode, off by default | M | 1, Later |
| 14 | `R10`, `R10.1`, `R19.1` | `author: mixed` or `llm`; "a human must revise it" before `review` | A list of authors with optional contribution degrees; LLM authorship recorded by default | M | 2 |

## Group 4: LLMs and the CLI

| # | Requirement | Existing | Page | Size | Phase |
|---|---|---|---|---|---|
| 15 | `R47` | `AGENTS.md` line 18, "Run the command from the shell"; `Bash(specplane:*)` in `harnesses/claude/templates/settings.json` and root `CLAUDE.md`; reasoning-only fallback in `architecture/agent-skills` | The CLI should not be directly callable by LLMs in the harness | L | 1 |

## Group 5: Plan lifecycle

| # | Requirement | Existing | Page | Size | Phase |
|---|---|---|---|---|---|
| 16 | `R29.1` | Stored `draft`, `ready`, `done`, `abandoned`, `shelved` and derived `blocked`, `in_progress`, `review` (`feature/plan-status`) | Not started, in progress, stopped, completed, abandoned, with progress stored | L | 1 |
| 17 | `R29`, `R27.6` | `feature/plan-status` line 27, `ready` means "approved for execution" | Plans use specification metadata, including Approved | L | 1 |
| 18 | `R27.1`, `R29.1` | `architecture/reference-cli`, "Runtime files are derived coordination data, never plan status" | Stops, progress and a session reference are plan metadata | M | 1 |
| 19 | `R27.6` | `plans.require_approved_specs: feature`, checks only feature specs | The plan and all specs it already references must be Approved; on/off, default on | M | 1 |
| 20 | `R30.1` | Spec checks only at first start; a resume skips them; no spec-writing steps | A step implementing a plan-written spec cannot run until that spec is Approved | M | 1 |
| 21 | `R28`, `R28.1` | `done` is set in the plan branch's final commit, before the merge | A final review decides completion and shows specs changed on the target | M | 1 |
| 22 | `R29.1`, `R29.2` | `plans.archive_done` can turn archiving off | Completed and abandoned plans are always archived | S | 1 |

## Group 6: Stops, budgets and resuming

| # | Requirement | Existing | Page | Size | Phase |
|---|---|---|---|---|---|
| 23 | `R27.1` | `execution.usage_limits` holds `{window, percent}`, a single stop (`feature/configuration` line 487) | A soft stop tells the model to write a handoff; a hard stop ends the session | L | 1 |
| 24 | `R27.1` | `execution.max_budget_usd`; no token budget exists | Main metrics are tokens or usage limits | M | 1 |
| 25 | `R27.2` | `plan resume` only restores a stored status and launches nothing (`feature/plan-execution` line 197) | A harness command resumes from the handoff, plus session logs after a hard stop | M | 1 |

## Group 7: Running steps

| # | Requirement | Existing | Page | Size | Phase |
|---|---|---|---|---|---|
| 26 | `R27`, `R27.3`, `R27.5` | `blocked` steps wait for a person to reset them; attended sessions ask directly | Steps need no input; the LLM uses requests or a soft stop, then the plan resumes | M | 1 |
| 27 | `R27` | `skipped` step status and `--step N --force` | Deny a selection that skips an incomplete step | S | 1 |
| 28 | `R31.2` | `feature/plan-steps` line 10, "Steps run sequentially, one at a time"; `max_parallel` covers distinct plans only | Users control parallel tasks within a step | M | Later |
| 29 | `R27.4` | `feature/plan-steps` line 233, "one commit (or a small, cohesive group of commits)" | Commit policy is the user's, with at least one per step | S | 1 |
| 30 | `R27` | `branch` backend switches the main checkout (`feature/plan-execution` line 38) | Plans start in a separate worktree so the user's directory stays the same | M | 1 |

## Group 8: Other models

| # | Requirement | Existing | Page | Size | Phase |
|---|---|---|---|---|---|
| 31 | `R37` | Architecture Decision Records, "never deleted", accepted by a person (`feature/decisions`) | User decisions saved from discussion, on/off, with add, retrieve, edit and delete permissions | L | Later |
| 32 | `R36`, `R61.1` | `implementation` is `incomplete`, `partial` or `complete`, on any spec, and manual edits are valid (`feature/spec-system`) | Architecture specs only; implemented only when declared checks pass on a commit | L | 2 |
| 33 | `R4` | CLI leak guard with about 50 `leak_guard_allow` entries, including `src/types/spec.ts` and `src/graph/` | Optional harness instructions that warn, configurable by users | L | 2 |
| 34 | `R35.1` | `harnesses/codex/specifications/architecture/codex-integration.md` line 25, "expose reasoning skills plus manual CLI instructions" | Say the capability is missing and refuse; no weaker substitute | S | 1 |

## Borderline

These may be gaps rather than contradictions.

| # | Requirement | Existing | Why it is uncertain |
|---|---|---|---|
| 35 | `R36.3`, `R62.1` | The Claude hook blocks an agent's `git commit` on any validation error, and is installed by default | The page makes commit gates optional and off by default, but this hook guards the agent rather than a git hook. It is also the hook behind step 0 |
| 36 | `R27` | Sessions are launched only as `unattended` | The page wants sessions the user can read and intervene in, which may only need adding |
| 37 | `R39`, `R68` | Overlays (`extends`, `spec_roots`) model what the page calls subprojects | The page never mentions spec extension, so overlays may or may not survive |
| 38 | `R29.2` | `feature/plan-status` introduces no deletion command | Absent more than forbidden |
| 39 | `R29`, `R29.3` | Plans list spec IDs with no commit | Absent more than wrong, though the shape must change |

## Questions the page leaves open

**Need the user's product decision:**
1. Soft stop (`R27.1`). The page says the model is told to write a handoff. The 2026-11-06 recommendation was to start no further session, which needs no cooperation from the model.
2. Default protection (`R55`, `R55.1`, `R63`). With Strict Mode off, nothing stops an LLM editing a spec file directly. Binding approval to content (`R11`) means such an edit cannot stay Approved, but the edit itself still happens.
3. CLI blocking (`R47`, `R58`). `R47` reads as mandatory and `R58` as configurable guardrails, and `R58` is built later than `R47`.
4. Whether Architecture Decision Records stay alongside user decision records (`R37`).
5. Whether overlays stay, or become subprojects (`R39`).
6. What replaces `deprecated` and `supersedes` for retired specs (`R11`).
7. Whether `stopped` also covers a pause by the user, today's `shelved` (`R29.1`).
8. When a plan becomes completed and is archived, relative to the merge (`R28`, `R29.1`).
9. Whether an attended session may ask the user directly, given "Steps should not require user input" and "intervention" (`R27`).
10. "Minimal architecture included" in the layer list against "should ideally not exist" in `R4`.

**Technical, to be settled in the spec edits unless they turn out to change behaviour:**
- `R9` and `R7` define no reference syntax, while `R11.2` and `R26` need part-level references.
- `R11` does not define "last Approved state" for a spec never approved, or how "the commit it was set on" reads after a squash.
- `R27.3` allows a soft stop in all default presets, but no stop permission is defined.
- `R10` records authorship through harness commands and `R19.1` has the LLM add it; direct file edits are not covered.

## Suggested order

1. Answer the ten questions, one or two at a time.
2. Group 1 and the standing text, even though `R65` is Phase 2 in the release plan. `AGENTS.md` currently tells agents to stop on contradictions, and the page contradicts many specs, so no agent can work from them until this changes.
3. Groups 2 to 7 as spec edits for Phase 1, in that order because plans depend on status and roles. Code follows through Phase 1 of the release plan.
4. Group 8 and items 12 and 28 with their later phases. Items 12, 28 and 31 can wait for the later releases.
