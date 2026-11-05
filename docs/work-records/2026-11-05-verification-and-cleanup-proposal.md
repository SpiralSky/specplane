# Proposal: verification levels and remaining cleanup

Date 2026-11-05. Status: proposal, not applied. Nothing in this file edits a spec, a plan or the configuration.
Written against `d773a26` on `overnight/specplane-20261102T144630Z`.

One approval from the user covers everything below. Section 8 lists what happens after that approval, in order. Approving this file does not approve a spec: re-approving a reopened spec stays a separate user instruction.

## 1. Decisions this proposal records

| Item | Decision |
| --- | --- |
| Verification | Add verification levels and an automatic mode (sections 2 and 3). A step can reach `done` in any repository with no setup, and the record states what was really checked. |
| Mappings | Optional. An unmapped criterion can be met by file evidence and is labelled self-assessed. |
| D16 | Replace options A and C. Suite commands move from `BUNDLED_SUITES` to `verification.suites` in each repository's configuration. |
| D19 | Settled: the six legacy skills are removed (`d773a26`). The stale spec text is corrected in section 4. |
| `reasoning` gate | The native reasoning commands are registered by default, because nothing else now provides those command names. The `native-reasoning` marker is deleted. This lifts the earlier rule that the commands wait for a live check (D13, D24), so the first live run happens with them already on. |
| D17 A | Keep the `confirmation` field on `record`. Turn the bridge on and delete `MANUAL_WRITE_RULE`, otherwise `/spec-assist`, `/spec-draft-architecture`, `/plan-create` and `/decision-new` can never write a file. The first live run is their check. |
| D15 | Reverse option B: add a core initiation for `plan-finish`, so `/plan-finish` works natively instead of being refused at `prepare`. |
| A13 readings | Accept readings (a) to (d), (h) and (i) as written into the spec in A7. Reading (e) stays as built and is relaxed when the host binding supplies `isAlive`. |
| Recording backlog | Replace the managed replay with a one-time labelled declaration (section 6). This removes the need for a legacy-target repair command and for moving work into plan checkouts. |
| Heuristic warnings | Leave the 54 "may contradict" warnings. `extension-conformance` 02 does not require clearing unrelated heuristic warnings. |

## 2. Feature spec text

`feature/plan-steps` and `feature/configuration` have `llm_role: assist`, so this text is applied only as approved here.

### F1. `feature/plan-steps`: new section before `## Acceptance scenarios`

> ## Verification
>
> Finishing a step compares what was built with what was intended. The spec states the intent and the code is the result. Tests and the step's acceptance criteria are bridges between the two, and a review can compare the code with the spec directly. Which bridges a step needs depends on the change: a wording fix may need only its criteria, while a change to access control may need tests and a second reader.
>
> The record of a step states two facts:
>
> - **How it was checked.** `test` means Specplane ran a configured suite and it passed. `inspection` means someone read named files against the criterion.
> - **Who checked it.** `self` is the session that did the work. `separate` is a different session that saw the spec and the result but not the working conversation. `human` is the user.
>
> A `done` step never claims more than was checked. A step checked only by the session that did the work is reported as self-assessed. Passing tests show that the tests ran and passed, not that they are good tests. A separate review is a second reading, not proof of correctness.
>
> ### Automatic verification
>
> With `verification.mode: auto`, the default, Specplane sets a minimum for each step from the files the step actually changed:
>
> | Change | Minimum |
> |--------|---------|
> | Every changed file matches `verification.text_paths`, and none is risky | Every criterion met, checked by `self` or stronger |
> | Any other change that is not risky | The same, and every configured suite passes |
> | Any changed file matches `verification.risk_paths` or is inside a configured spec root | The same, and a `separate` or `human` check against the spec |
>
> When no suite is configured, the second row needs no tests and the record says that none were configured. A suite is only as strong as the files it runs, which a step may have changed.
>
> The session doing the work can raise a step's minimum but cannot lower it. Only the user can lower it, for one step, by confirming a request that shows the session's stated reason, and the record keeps that reason. With `verification.mode: manual`, no minimum applies and only criteria mapped to a suite need tests.
>
> A step that does not reach its minimum cannot be recorded as `done`. An attended session asks the user to supply the missing check or lower the minimum. An unattended session ends the step `blocked`.
>
> A mismatch between the code and the spec is recorded as a gap and follows `feature/spec-precedence`. The session does not silently change either side to make them agree, because the spec may be the side that is wrong.
>
> Manual completion by a person through the CLI stays valid and has no minimum. It is recorded as manual and self-assessed. A host that can tell an agent from a person refuses this route to an agent.

### F2. `feature/plan-steps`: new scenarios after Scenario 6

> ### Scenario 7: Step in a repository with no verification setup
>
> Given a repository with no `verification` configuration and no suites,
> When an agent finishes a step that changes code and cites files for every criterion,
> Then the step is recorded `done`, reported as self-assessed, with the note that no tests were configured.
>
> ### Scenario 8: Failing suite
>
> Given a repository with a configured suite,
> When a step changes code and the suite fails,
> Then the step cannot be recorded `done`.
>
> ### Scenario 9: Change in a risky path
>
> Given `verification.risk_paths` includes `src/auth/**`,
> When an unattended step changes a file under `src/auth/` and no separate check has run,
> Then the step ends `blocked` and names the missing check.
>
> ### Scenario 10: Lowering the minimum
>
> Given a step needs a separate check,
> When the session asks to skip it and the user confirms in the host's dialog, which shows the session's reason,
> Then the step can be recorded `done`, and the record shows the lowered minimum and that reason. Text from the agent alone never lowers it.

### F3. `feature/configuration`: schema block, after the `execution` block

```yaml
# ── Verification ──────────────────────────────────────────────────────────────
verification:
  mode: auto                  # auto | manual
  suites: {}                  # name -> { command: [argv...], format: node-tap-v13 | junit-xml }
  text_paths: ["**/*.md", "docs/**"]   # changes limited to these need no tests
  risk_paths: [".specplane/**", ".claude/**", ".agents/**", ".github/**", "AGENTS.md", "CLAUDE.md", "**/SKILL.md"]   # changes here need a separate or human check
```

### F4. `feature/configuration`: key reference, before `### `decisions.dir``

> ### `verification.mode`
>
> **Type**: enum
> **Default**: `auto`
>
> `auto` sets a minimum check for each step from the files it changed (`feature/plan-steps` § Verification). `manual` sets no minimum.
>
> ---
>
> ### `verification.suites`
>
> **Type**: map of suite name to `{command, format}`
> **Default**: empty
>
> The test commands Specplane may run as proof. `command` is an argument list, never a shell string. `format` is the report format the command prints: `node-tap-v13` or `junit-xml`. Only the committed version counts, so an uncommitted edit cannot add a command. A step cannot edit the configuration, and if the `verification` settings changed after the plan started, the step needs a `human` check, so an agent cannot quietly change what proves its own work. This key is separate from `plans.test_command`, which belongs to the finish flow.
>
> ---
>
> ### `verification.text_paths`
>
> **Type**: list of glob patterns
> **Default**: `["**/*.md", "docs/**"]`
>
> A step whose changes all match these patterns needs no tests.
>
> ---
>
> ### `verification.risk_paths`
>
> **Type**: list of glob patterns
> **Default**: `[".specplane/**", ".claude/**", ".agents/**", ".github/**", "AGENTS.md", "CLAUDE.md", "**/SKILL.md"]`
>
> A step that changes a matching file needs a `separate` or `human` check against the spec. Files inside a configured spec root always count as risky. A file matching both this key and `verification.text_paths` counts as risky.

### F5. `feature/claude-integration`, line 50

Replace:

> Project skills can provide reasoning-only fallback workflows but must not masquerade as native deterministic handlers.

with:

> Reasoning procedures are internal to the extension and are not public commands.

## 3. Shared architecture text

`architecture/*` has `llm_role: draft`.

### R1. `architecture/reference-cli` § Test definition and execution requests, second paragraph

Replace:

> If the reviewed procedure does not identify the required suites/report format, expose that missing mapping for resolution; the criterion remains uncertain until a revised preparation binds it.

with:

> A criterion with no mapping needs no suite of its own: it is assessed by file evidence and labelled self-assessed under § Verification policy, and the step-level suites still apply.

In the same paragraph, replace:

> The worker chooses a concrete command consistent with that procedure after making its implementation edits; it cannot weaken the prepared requirements through an execution request.

with:

> Commands that establish evidence come only from `verification.suites`; a worker cannot weaken the prepared requirements through an execution request.

### R1a. `architecture/reference-cli` § Test definition and execution requests, third paragraph

Replace:

> `executeWorkflowTest` accepts the closed object `{requestId, criterionIds, executable, args, reportFormat}`. `requestId` identifies an active prepared workflow owned by this caller; `criterionIds` is a nonempty unique list of its criterion IDs;

with:

> `executeWorkflowTest` accepts the closed object `{requestId, criterionIds, suiteId, executable, args, reportFormat}`. `requestId` identifies an active prepared workflow owned by this caller; `criterionIds` is a unique list of its criterion IDs, nonempty unless the run is step-level; `suiteId` is an optional key of `verification.suites` that marks a step-level run;

### R1b. `architecture/reference-cli` § Test execution receipts, first paragraph

Replace "Protocol 1 receipts have exactly `{protocol, requestId, executionId, stateDigest, executable, args, checkout, exitCode, signal, stdout, stderr, assertions}`." with "Protocol 1 receipts have exactly `{protocol, requestId, executionId, suiteId, stateDigest, executable, args, checkout, exitCode, signal, stdout, stderr, assertions}`; `suiteId` is the step-level suite, or null."

### R2. `architecture/reference-cli` § Reviewed suite mapping format

Replace:

> Missing mappings remain explicitly uncertain in private prepared state and preparation notices, and cannot be converted to met by a worker's empty list or unsupported report.

with:

> A mapping is optional. A missing mapping is reported in preparation notices and never counts as test evidence: the criterion can be met only by file evidence, and the record labels it self-assessed. A mapped `test` criterion still needs a matching core receipt, and a worker's empty list or unsupported report cannot satisfy it.

### R3. `architecture/reference-cli`: new section before `#### Test execution receipts`

> #### Verification policy
>
> This implements `feature/plan-steps` § Verification. Preparation reads `verification` from the configuration committed at the plan's recorded start base; a request with no plan reads it from the prepared HEAD. The configuration is already a protected path, so a step cannot edit it. If the `verification` block at the prepared HEAD differs from the start base, the step needs a `human` check, because a commit made outside a managed step could otherwise rewrite the rules. Suite commands come only from that block. Hosts resolve a `suiteId` from it and call `executeWorkflowTest` with its `command` split into `executable` and `args`.
>
> `validateWorkflowResult` computes the tier from the result's actual edit set, never from worker text:
>
> 1. `risk` when a changed path matches `risk_paths` or is inside a configured spec root.
> 2. `text` when every changed path matches `text_paths` and none is `risk`.
> 3. `standard` otherwise.
>
> A `done` result then needs every criterion `met`. `standard` and `risk` also need one step-level receipt per configured suite for the state being recorded. A step-level receipt passes when its `suiteId` is a table key, its `executable` and `args` equal the table's command, its exit code is 0, and its report shows `executed` above 0 and `failed` at 0. Core records the `suiteId` and command in the execution ledger. `risk` also needs a `separate` or `human` check artifact bound to that state. With `mode: manual`, only mapped `test` criteria need receipts. A missing check refuses with `INVALID_EVIDENCE`, and the error names it. A `blocked` result needs no minimum. A result may raise its own tier through a new optional `requestedTier`; a value below the computed tier is refused.
>
> A `separate` check is a read-only prepared request with `workflow: verify-review`. Its inputs are the step's spec context, criteria and diff, and not the working conversation. Its result is `{verdict, findings}`, stored as a core artifact bound to the state digest. Its session identity must differ from the worker's. That identity is what the host reports; the core records it as a claim about independence and does not prove it. A `fail` verdict cannot satisfy the check. Core writes each finding to `spec-gaps.md` as a numbered gap during recording, after the checks, so writing them does not make the receipts stale.
>
> A `human` check, and lowering a minimum, use § Revision-bound human confirmation. The challenge shows the worker's stated reason, its payload digest binds that reason, and the human's confirmation accepts it. Model text never satisfies either.
>
> Recording writes one verification line into the existing "What the next step must know" subsection, giving the tier, each criterion's method and checker, suites run, any lowered minimum with its reason, and `self-assessed` when no stronger check ran. No new HANDOFF section is needed. Manual `plan step-done` skips the minimum and writes `manual, self-assessed`. The CLI cannot tell a person from an agent, so this route is a labelled declaration, not a security boundary; a host with a policy guard denies it to agents.

### R4. `architecture/reference-cli` § Structured reasoning boundary, `WorkflowResult` row

Add `requestedTier` (optional) to the listed fields.

### K1. `architecture/agent-skills` § `plan-step`, step 6

Delete the sentence "Missing suite/report mappings remain uncertain until resolved and bound by preparation." and append:

> A criterion with no mapping is assessed by citing files. Run every configured suite the step's tier requires. If the tier needs a separate check, request it after the edits are final. Never lower a minimum yourself: ask the user, or end the step `blocked` when unattended.

## 4. Claude architecture text

Target: `harnesses/claude/specifications/architecture/claude-integration.md`.

### A1. Line 62

Replace "Repository content can deliver fallback skills and settings hooks." with "Repository content can deliver reasoning procedures and settings hooks."

### A2. Line 153

Delete the sentence "A reasoning-only fallback receives `$ARGUMENTS`, applies the same grammar through the bundled runner or CLI, and never treats prompt text as a human confirmation."

### A3. Line 161

Delete the sentence "A user-only fallback skill may use `disable-model-invocation: true`."

### A4. Line 177

Replace:

> **Invocation rule.** The table's flags describe user-only fallback skills; internal reasoning assets use the visibility needed by their supported host invocation. Neither flag grants permission to mutate, approve, finish, merge, or spend quota.

with:

> **Invocation rule.** Internal reasoning assets use the visibility needed by their supported host invocation. The table's flags never grant permission to mutate, approve, finish, merge, or spend quota.

and delete the last sentence, "Hiding a fallback skill does not hide the manual CLI."

### A5. Line 466

Replace:

> The commands are registered only when the native reasoning path is enabled; while it is disabled, the reasoning commands and the completion tool are not registered and the legacy reasoning skills keep their names.

with:

> The commands and the completion tool are registered in every session where the host's command inventory is available. Otherwise they are not registered and the manual CLI remains available. A public skill of the same name, from an earlier install or written by the user, keeps its name under the collision rule and the install reports it.

### A6. § Reviewed test suites (lines 521 to 529)

Replace the whole section body with:

> A plan step's tier may require suites (`architecture/reference-cli` § Verification policy). The server never runs an executable or arguments that the model, or any text from a prepared request, supplies. `executeTest` takes only `requestId` and `criterionIds`. The server resolves each required `suiteId` from `verification.suites` in the configuration committed at the prepared HEAD, runs it with the checkout as working directory and without a shell, and passes the report back to the core for assertion matching exactly as `architecture/reference-cli` defines. An unknown `suiteId` is refused, and the request is cancelled and its lease released.
>
> The model starts a run through the mod-registered tool `specplane_run_tests`, whose only input is `requestId`. The mod calls `executeTest` and returns the receipt reference for the model to cite in `criterionEvidence[].artifacts`. A receipt the core did not produce is not evidence.
>
> A separate check runs as a fresh host session or subagent that receives only the `verify-review` request.

### A7. § Claude session adapter: add after **Observe.**

> Observation is fail-closed. A `success` result with `is_error: true` is `failed`. A live process stays `running` after a `result` event until it exits. Exit 0 with no `result` event, a signal exit, and any unparseable or typeless line give `unknown`, which does not change afterwards. A `spawn` that throws after the mapping is saved returns `unknown` and is not retried.

and add to **Launch.**:

> The only backend is `worktree`. The prompt is exactly `Run the installed plan-step procedure for the workflow request at <path>`, and a path containing a newline is refused.

and add to **Resume.**:

> After a restart, resume refuses unless the process port reports the recorded process dead.

### A8. § Claude session adapter, **Permissions.**

In the deny list, replace "`plan abandon` and `decision accept`" with "`plan abandon`, `plan step-done` and `decision accept`".

### A9. Policy guard

Add to § Policy guard: "The guard denies an agent's `specplane plan step-done`. A step recorded by an agent goes through the workflow server, so its verification minimum applies."

### A10. Remaining fallback wording

- Line 29: replace "supporting assets and reasoning fallbacks" with "supporting assets".
- Line 343: replace "through the extension or reasoning fallback supported on that surface" with "through the extension supported on that surface".
- Line 424 stays: it describes retiring old skills from earlier installs.

### A11. § interim rule (line 472)

Delete the paragraph that begins "**Interim rule for workflows that would write text.**".

### R5. `architecture/reference-cli` § Workflow initiation and preparation inputs

Add `plan-finish` to the workflows that accept an initiation. Its selection is `{planId}`, and its preparation runs the existing finish readiness checks. The finish itself stays behind the human confirmation the spec already requires.

## 5. Smaller cleanup

### C1. `.specplane/config.yaml`

Add to `specs.feature.leak_guard_allow`, under a comment `# Public plan and completion fields, reviewed 2026-11-05`: `target_branch`, `comparison_base`, `start_base`, `shelved_from`, `reassessment_needed`, `implementation_status`, `assessment_status`, `assessment_reasons`, and the new public names `verification`, `text_paths`, `risk_paths`, `node-tap-v13`, `junit-xml`. This clears the 16 "architecture detail" warnings and prevents new ones from sections 2 and 3.

### C2. Plan references

- In `claude-delivery` step 03 and `manual-lifecycle` step 03, replace the context file `packages/cli/src/harness/session.ts`, removed in `60e84e8`, with `harnesses/claude/plugin/hooks/session-adapter.ts`.
- `specplane validate` stops warning about missing context files and anchors in archived plans, because those records are history. This clears the 8 remaining plan warnings.

### C3. `docs/OPEN-QUESTIONS.md` and ADR 0005

Move OQ-12 to OQ-15 to "Resolved questions", and delete the experimental update note at the top:

| ID | Resolution | Where recorded |
| --- | --- | --- |
| OQ-12 | The conductor is in the shared core and each extension supplies its own adapter. | ADR 0005 |
| OQ-13 | Neither: the standalone CLI never launches a session. Automated runs start only from an extension. | ADR 0005 |
| OQ-14 | Specplane owns the worktree, and the adapter launches in that checkout. | `claude:architecture/claude-integration` § Claude session adapter |
| OQ-15 | A session id is deterministic per plan and step (`sessionIdFor`), and the adapter persists its own native id. | `claude:architecture/claude-integration` § Claude session adapter |

ADR 0005 already describes this design, so its text does not change. Accepting it stays the user's action: `specplane decision accept 0005`.

### C4. Local items

- `problems.md` is out of date: every finding is fixed. It is untracked and never committed, so deleting it is the user's choice.
- Bun 1.4.4 is recommended. In this session 1.3.14 stalled on 4 of 6 full runs and 1.4.4 on none of 6.

## 6. Recording backlog

**Problem.** The managed replay is blocked: `plan step-done` records only uncommitted changes in a plan checkout, the work is already committed on this branch, and "Legacy target history is ambiguous" has no CLI repair.

**Decision.** Do not replay. Stored `done` is a valid declaration (`feature/plan-status` § Declarations versus operation evidence), so one commit declares the finished plans, and each says exactly what it is:

> Declared done on 2026-11-05 by the user. Implemented outside the managed flow on `overnight/specplane-20261102T144630Z` at `<sha>`. No managed recording or receipts exist for these steps.

- **Declared done:** `target-lifecycle`, `plan-index`, `completion-assessment`, `workflow-recording`, `manual-lifecycle`, `product-docs`, `extension-packaging`, `codex-delivery`. Each `PLAN.md` and step file gets `status: done`, and each `HANDOFF.md` gets the note.
- **Stays open:** `claude-delivery` (step 03) and `extension-conformance`, whose unmet criteria need live evidence.
- **Abandoned:** `2026-10-30-plan-conductor`, through `plan abandon`.
- **Index:** regenerate `plans/PLANS.md` with `specplane plan index`; it is not edited by hand.
- **Preserved:** the uncommitted edits in the `target-lifecycle` worktree are not touched and need a look before that worktree is removed.

The tradeoff is that these plans lose managed receipts they never really had. Anyone reading them sees a declaration, not evidence.

**Push.** Handled in `5284f44`: the remote commits are merged with no file change, so a plain push works and no force is needed. Before that merge, a plain push failed because the remote branch had `63cd572` and `cff7c78`. Comparison: every code line `63cd572` added to `contracts.ts`, `index.ts`, `workflow-preparation.ts` and `workflow-recording.ts` is here or has been replaced by a newer form (`assertContributionRecordingAvailable` became `validatedContributions` in recording), and `contribution-capture.ts` here has all three of their exports and more, so their code is superseded. Two record files exist only on the remote: `docs/work-records/2026-11-03-workflow-contribution-capture-result.json` and `docs/work-records/implementation-forecast.json`. This branch replaced per-batch records with `LOG.md` in `7bde247`, so losing them matches that decision. The push stays the user's action.

## 7. Build order

1. Apply the text (section 8).
2. Core: `verification` config and schema, optional mappings, step-level receipts, the tier check, `requestedTier` and the verification line.
3. Claude: suites from configuration, delete `BUNDLED_SUITES`, the D16 C refusal and the `native-reasoning` marker, register native commands by default, turn on the D17 A bridge and delete `MANUAL_WRITE_RULE`, add the `plan-finish` initiation, and add the `plan step-done` denial.
4. `verify-review`, the `human` check and lowering a minimum. Until this lands, a `risk` step ends `blocked` in `auto` mode.
5. Refresh the 7 remaining skill pins after reviewing each skill against its contract (`extension-conformance` 02). This comes last because step 3 changes those skills.
6. One live run on a real task proves the native path, then the budget-stop case on a low-stakes task. Each needs the user's go-ahead.

Codex receives the same core rules. Its runner keeps its current request shape, so a Codex step meets a suite requirement only with a command equal to the table's.

## 8. After approval

1. Run `spec reopen` on `feature/plan-steps`, `feature/configuration`, `claude:feature/claude-integration`, `architecture/reference-cli`, `architecture/agent-skills` and `claude:architecture/claude-integration`, and on `codex:feature/codex-integration` and `codex:architecture/codex-integration`, whose text does not change but whose pins do. Add any other approved dependant the command lists. Each reopen makes its own commit.
2. Apply sections 2 to 5, one commit per spec.
3. Refresh the `based_on` pins with `spec pin`, then run `specplane validate`.
4. Apply section 6 as one commit, with `plan abandon` as its own commit.
5. Stop for the user to re-approve the reopened specs and accept ADR 0005, or to tell the coordinator to run those commands.
6. Build section 7, steps 2 to 4.
