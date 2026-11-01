# Session handoff

## Latest milestone: specification changes committed and remaining approvals completed

Continued at the user's request. Committed the reviewed shelving/lifecycle specification changes, approved diagnostic correction and prior recovery evidence as `8a04a7f`. Fresh CLI build passed. Approval dry-run succeeded for both remaining architectures, then the authorized CLI approvals completed with Git write permissions: Claude `7ac9bb0`, Codex `3d012e7`. Codex approval also pinned its extended shared architecture/agent-skills contract through the CLI. The interrupted approval transaction is fully resolved; both architectures are now approved in committed state. This approves target design, not implementation or host compatibility.

Fresh validation: **0 errors, 65 warnings**. `git diff --check` passed. No implementation tests ran during this specification-only milestone. `plan next 2026-11-01-core-foundation` reports ready, step 01 Trustworthy subprocess tests pending, checkout none; it instructs start. The first start still requires the plan to exist on default branch main. Local main remains `21317cf`; the integration branch includes 18 commits beyond main, including earlier conductor/Codex implementation, target specifications and seven replacement plans. A merge would integrate that whole branch, not only today's documentation. Earlier implementation limitations and the nested-test defect remain unresolved; do not characterize the branch as implementation-conformant.

Next human gate: authorization to integrate `dot/codex-integration-20261101` into local main before starting core-foundation. No merge or push has occurred. Do not infer merge authorization from specification approval or this continuation. The old conductor branch/checkout remain preserved; do not resume obsolete step 3 or perform abandonment. Shelving remains target-only behavior and needs permitted implementation-plan coverage. Untracked `problems.md` is untouched and must remain uncommitted. At the end of each authorized milestone, rewrite this root HANDOFF.md with the goal, decisions, current state, evidence, next steps, and this instruction, then tell the user.

## Latest milestone: interrupted approval status restored with explicit authorization

The user explicitly approved the narrow recovery after its purpose was explained. Restored only Claude architecture's uncommitted `status: approved` line to its HEAD value `status: review`. Verified byte-for-byte that every other byte in the file was preserved, including its shelving presentation edits. This is the authorized rollback of a failed CLI transaction, not a new approval, a withdrawal of the user's prior approval decision, or general permission to hand-edit lifecycle statuses. The failed-status recovery blocker is resolved.

Fresh repository validation using the existing built CLI passed with **0 errors, 69 warnings**; `git diff --check` passed. No implementation tests or fresh build ran for this one-line recovery. Updated this root handoff. Other existing specification changes and untracked `problems.md` were preserved. No commit, CLI approval, pin refresh, merge, publication, or plan lifecycle transition occurred.

Next: finish reviewing/committing the revised target before resuming already-authorized CLI approvals; Claude's body remains uncommitted, so an immediate approval command would refuse. Use elevated Git-writing commands when required to avoid repeating the partial-write failure. Integration into main remains a human merge gate before core-foundation start. Shelving is unimplemented; preserve the conductor checkout and do not resume obsolete step 3. At the end of each authorized milestone, rewrite this root HANDOFF.md with the goal, decisions, current state, evidence, next steps, and this instruction, then tell the user.

## Latest milestone: approved diagnostic correction applied

The user approved the second proposed change: the dependency diagnostic correction. Applied the exact approved feature/plan-status sentence so the multiple-unmerged-dependencies message applies only after the shelved-dependency check. Aligned architecture/reference-cli's `blockedReason` paragraph with that precedence. No implementation changed.

The user asked what the first proposal meant; this is not authorization to restore the Claude status. Explained that the earlier CLI wrote `approved` but failed before its approval commit, leaving an uncommitted partial operation that its retry refuses. Restoring only that status line to `review` would undo the partial operation while preserving the later body edits and the user's earlier approval decision. Recovery remains pending an explicit exception to the workflow's direct-frontmatter-edit prohibition. No status was changed or approval retried.

Fresh validation using the existing built CLI passed with **0 errors, 69 warnings**. `git diff --check` passed. No implementation tests or fresh build ran for these prose changes. Updated only the two specification passages and this root handoff; preserved other existing changes and untracked `problems.md`. No commit, merge, publication or plan lifecycle operation occurred.

Next: resolve the narrow approval-recovery exception, then finish reviewing/committing the target and resume authorized CLI approvals. Integration into main remains a human merge gate before core-foundation start. Preserve the conductor checkout; do not execute obsolete step 3 or unimplemented shelving commands. At the end of each authorized milestone, rewrite this root HANDOFF.md with the goal, decisions, current state, evidence, next steps, and this instruction, then tell the user.

## Latest checkpoint: shelving review and approval-recovery diagnosis

Continued from the shelving milestone. Reviewed the ten specification diffs and the approval implementation. Found one diagnostic-contract inconsistency: feature/plan-status, Edge cases, says a shelved dependency reports the shelving-specific message but its next sentence assigns the multiple-unmerged-dependencies message to the same blocked plan. Architecture/reference-cli's `blockedReason` paragraph likewise still specifies only the multiple-dependency message despite its preceding algorithm adding shelving precedence. Do not implement conflicting diagnostic rules.

Proposed exact feature correction (not applied; assist policy requires text approval): replace `Such a plan is displayed as `blocked`, with the message "Cannot stack on more than one unmerged dependency: <a>, <b>."` with `Otherwise, a plan with two or more unmerged dependencies is displayed as `blocked`, with the message "Cannot stack on more than one unmerged dependency: <a>, <b>."`. Align the architecture's `blockedReason` paragraph to return the shelving-specific reason first, then the multiple-dependency reason. No other shelving contract defect was identified in this review; this is not implementation certification.

Approval recovery: `packages/cli/src/commands/spec-approve.ts` writes status before `commitChange` and does not roll back a git failure. Approve rejects the resulting approved status; reopen also rejects the dirty file. There is no recovery command. The approve workflow explicitly prohibits an alternate retry or direct frontmatter edits after refusal. No further approval/reopen command was attempted. Proposed narrow recovery requires the user's explicit exception: restore only Claude architecture's uncommitted `status: approved` line to its HEAD value `status: review`, leaving its shelving body edits intact. This cancels the failed transaction; it does not itself approve the revised text. Do not commit the failed status as ordinary specification content.

Fresh verification using the existing built CLI: repository validation passed with **0 errors, 69 warnings**; `git diff --check` passed. No fresh build or implementation tests ran, because no implementation changed. Only this root handoff was edited during this checkpoint; all pre-existing changes and untracked `problems.md` were preserved. No commits, pin changes, approvals, plan execution, merge, publication or lifecycle transitions occurred.

Next: obtain the narrow recovery exception and feature diagnostic text approval, apply the corrections, then finish reviewing/committing the target before resuming authorized CLI approvals. Integration into main remains a human merge gate before core-foundation start. Shelving is still unimplemented; preserve the conductor checkout and do not resume its obsolete step 3. At the end of each authorized milestone, rewrite this root HANDOFF.md with the goal, decisions, current state, evidence, next steps, and this instruction, then tell the user.

## Latest milestone: shelving lifecycle specified; abandonment distinction resolved

The user approved the discussed lifecycle distinction and explicitly requested specification updates. Added stored `shelved` in both status-source modes: started work pauses while preserving its branch, checkout (including dirty implementation files), plan records and step outcomes. Explicit `plan resume` restores the prior stored status and recomputes current derived status without executing work. `shelved_from` records the prior status. Shelving overrides branch/PR activity; next/conductor and execution/recording/start/finish/restack cannot advance a shelved plan. Shelved dependencies block new stacked work. Unstarted/draft or terminal plans cannot be shelved.

Updated ten specifications: base plan-status, plan-execution, tooling, plan-system, plan-index, configuration; architecture file-formats, reference-cli, agent-skills; Claude architecture presentation. Architecture covers administrative recording, default-branch lifecycle precedence over stale retained checkouts, worker exclusion, dirty-work preservation and interrupted-operation recovery. Shelve/resume are CLI-only; no new slash commands are required.

Resolved the abandonment contract contradiction in favor of the existing feature behavior: abandonment retains plan records and the branch by default, removes the worktree with existing dirty-work protections, and is terminal. Archive is a filing operation for done/abandoned records, not a state or a promise to keep a checkout. No prune/delete command or deleted state was added. The earlier proposal to change abandonment to preserve worktrees is superseded and no longer awaiting text approval. The user reconsidered removal versus preservation while defining shelving; do not treat this specification request as an instruction to delete the conductor checkout or perform its lifecycle transition. Its concrete disposition should respect the newest user intent rather than blindly apply the old preserve-while-abandon instruction.

Verification: repository validation passed with **0 errors, 69 warnings** (previous checkpoint 67 warnings; the two additions flag the public `shelved_from` field in feature docs as possible architecture detail). The embedded PLAN.md JSON Schema compiled and passed 10 lifecycle cases (valid shelving origins, required/forbidden metadata, terminal status and rejection of archived/deleted states); mode-specific validation remains a semantic implementation requirement. `git diff --check` passed. No implementation suite ran because only specifications and this root handoff changed.

Changes remain uncommitted. Existing statuses and dependency/skill pins were not changed. The pre-existing uncommitted Claude `review` → `approved` CLI side effect from the interrupted approval transaction remains; the approval-recovery blocker below still applies. `problems.md` remains untouched and untracked. No actual plan records/steps/handoffs, implementation, worktrees or branches were changed; no approval, abandonment, shelving, merge or push was performed.

Next: review these specification changes, recover the interrupted approval transaction, and integrate the reviewed target through the human merge gate. Shelving support is a target contract, not implemented CLI behavior; account for it in a permitted implementation-plan workflow before attempting these commands. The core-foundation start still depends on integration into main. At the end of each authorized milestone, rewrite this root HANDOFF.md with the goal, decisions, current state, evidence, next steps, and this instruction, then tell the user.

## Latest checkpoint: dependency pin committed; approval partially applied

Continued the authorized specification-approval work. Reviewed the Claude feature dependency diff `fd9ae8f..4dc646b` against the architecture: native dispatch, reasoning assets, shared contracts, direct human approval, cloud capability checks, optional UI and contribution provenance are represented in the target design. Refreshed only that dependency through `specplane spec pin` and committed it as `4358c98`. This is target-design review, not implementation or host compatibility certification.

The subsequent CLI approval of Claude and Codex architecture hit a partial-write failure: it changed Claude architecture from `review` to `approved`, then failed at `git add` because the sandbox makes `.git` read-only. The required elevated retry refused: “Spec `claude:architecture/claude-integration` is `approved`; only `draft` or `review` specs can be approved.” Under the approve contract, stopped at that refusal. Claude's status change is an **uncommitted CLI side effect**, not a completed approval commit. Codex remains draft and was not reached. Do not report both approved, hand-edit status, or bypass the refusal through an alternate approval path. Recovery must address the interrupted CLI transaction before resuming the existing approval authorization.

Fresh verification: CLI build passed; validation returned **0 errors, 67 warnings**; `git diff --check` passed. No implementation tests ran because implementation did not change. Working tree contains the root handoff, CLI-written Claude status change, and untouched untracked `problems.md`. No plan execution, abandonment, merge, push or deletion occurred.

Remaining blockers from the prior milestone stand: exact-text approval is still needed to change feature/plan-execution abandonment step 2 to “Keep the plan's worktree unless deletion is explicitly requested” and align reference-cli architecture; retirement itself is already authorized and must not be reconfirmed. Integration into main remains a human merge gate before first-plan start. Preserve conductor branch, checkout and history. Do not resume conductor step 3.

Next: recover the interrupted approval transaction through a permitted workflow, then resume already-authorized approvals; obtain the outstanding preservation-text decision, resolve preservation support in a permitted implementation workflow, and pass the integration merge gate before plan start. At the end of each authorized milestone, rewrite this root HANDOFF.md with the goal, decisions, current state, evidence, next steps, and this instruction, then tell the user.

## Latest milestone: target committed and first plan ready; retirement authorized

The user explicitly approved the revisions and first-plan readiness and confirmed that the obsolete conductor plan is abandoned because they need to rework it. Preserve the conductor implementation, branch, checkout and history; the desired administrative outcome is abandoned status plus archived plan records, not code removal. This retirement decision is settled and must not be requested again. The CLI transition has not occurred.

Committed specification revisions/review evidence in `785d0d2` and the seven draft plans/planning evidence in `ab68e0e`. CLI approvals succeeded for base feature agent-integration (`83eff04`), plan-execution (`f051962`), configuration (`c0fb7b3`), Claude feature (`f3e33c2`), Codex feature (`adf8354`), file-formats architecture (`9028824`), agent-skills architecture (`f02eafb`) and reference-cli architecture (`0b84cd8`). First-plan readiness was recorded through CLI in `48fc6fa`; the other six plans remain draft. ADR 0005 remains proposed.

The specification approval command stopped at Claude architecture: its Claude feature dependency pin is stale (`fd9ae8f` versus current `4dc646b`). Following the approve contract, no alternate approval path or frontmatter edits were used. Claude architecture remains review and Codex architecture remains draft (not reached). Fix requires reviewing the dependency diff and refreshing the pin through CLI, committing it, then resuming authorized approvals.

Repaired the old conductor checkout with `git worktree repair`; `git -C <checkout> status --short --branch` now succeeds and reports a clean checkout on `plan/2026-10-30-plan-conductor`. Its branch/history remain intact. Worker liveness was not verified. No abandonment, worktree removal, branch deletion, push or merge occurred.

Retirement has a specification contradiction, not only an implementation mismatch: feature/plan-execution, Abandoning a plan, step 2 and architecture/reference-cli, Cleanup, abandon, archive, require worktree removal; architecture/agent-skills, plan-abandon, requires preservation unless deletion is requested. AGENTS.md prohibits implementing either side of contradictory specs. Asked for exact-text approval to replace the feature removal rule with “Keep the plan's worktree unless deletion is explicitly requested” and align CLI architecture. This correction approval is pending; the existing retirement authorization stands. Correct the contracts before implementing preservation support through a permitted plan workflow. Current abandon also requires the default branch and may push, so do not invoke it from this integration checkout.

`plan next 2026-11-01-core-foundation` reports ready, pending step 01 Trustworthy subprocess tests, checkout none. `plan start ... --no-fetch` refuses “Plan `2026-11-01-core-foundation` not found.” Source inspection explains this: first start reads the plan from the default tip (`main`), where the new integration-branch plan is absent. Do not bypass by changing the default branch or manually creating a plan branch. Human-controlled integration into main remains necessary; no merge approval was inferred.

Verification: fresh CLI build passed; validation before and after approvals both returned 0 errors, 68 warnings; git diff --check passed. No implementation tests ran because implementation did not change. `problems.md` remains untouched and untracked. Only this root handoff is additionally modified after the approval commits.

Next: settle the preservation text correction; review/fix the stale pin and resume the remaining authorized specification approvals; resolve CLI preservation in a permitted implementation workflow; integrate the reviewed branch through the human merge gate before start/abandon operations that require main. Do not resume obsolete conductor step 3 or delete its history. At the end of each authorized milestone, rewrite this root HANDOFF.md with the goal, decisions, current state, evidence, next steps, and this instruction, then tell the user.

## Latest checkpoint: continuation eligibility checked; human decisions pending

Read the root and first-plan handoffs and confirmed the next implementation candidate is `2026-11-01-core-foundation`, step 01, Trustworthy subprocess tests. `plan next` refuses execution because the plan is draft. `spec approve feature/agent-integration --dry-run` reports that approval is available; `plan approve 2026-11-01-core-foundation --dry-run` refuses until its uncommitted plan files are committed. Feature tooling is already approved; agent-integration remains review.

Asked the user whether to approve the current specification revisions as the implementation target, authorize committing the reviewed specs/plans, and approve first-plan readiness. Separately asked whether to retire the old conductor while retaining its branch, checkout and history after its execution blockers are resolved. These questions are pending, not approvals. The workflow contract reserves approval for the human; “continue” did not explicitly settle these recorded decisions.

Fresh checks: local `plan list --live --no-fetch` still reports the conductor in progress, 2/5 steps done; Git still registers its historical checkout. No repair or health certification occurred. `git diff --check` passed. No implementation tests or repository validation rerun; previous results below remain historical. No specification, plan progress, lifecycle, commit, pin, or merge changes were made. Only this root handoff was updated.

Next: consume the human answers before dependent approval/commit/start work. Preserve the old conductor and do not run the current destructive abandon implementation. At the end of each authorized milestone, rewrite this root HANDOFF.md with the goal, decisions, current state, evidence, next steps, and this instruction, then tell the user.

## Latest milestone: approved decomposition created as seven draft plans

The user approved the seven-plan/23-step proposal for **draft creation**. Created each PLAN.md and HANDOFF.md through `specplane plan new`, then filled the plan bodies and wrote pending step files under the plan-create contract. Refreshed `plans/PLANS.md` through `specplane generate`. All seven plans remain draft, all 23 steps pending, and CLI-created plan handoffs are untouched. This does not approve readiness, specifications, ADRs, conductor retirement, implementation, commits or merges.

Dependency order (all IDs prefixed `2026-11-01-`): core-foundation (5 steps) → workflow-recording (4) → manual-lifecycle (3) → extension-packaging (3) → codex-delivery (3) and claude-delivery (3) → extension-conformance (2). The two delivery plans share a packaging dependency; no parallel agents or sessions were launched.

Evidence: `docs/work-records/2026-11-01-draft-plan-creation.json`. Fresh repository validation: **0 errors, 68 warnings**, compared with 0 errors/65 warnings before creation. The three additional warnings are the Codex delivery steps referencing draft Codex architecture. Plan index freshness is resolved. Verified all seven plans against the approved proposal for exact spec lists, dependency edges, step titles, contexts, deliverables and acceptance criteria. No implementation tests ran because no implementation changed.

**Next:** human readiness decisions and required feature approvals remain outstanding; settle and commit the target specification revisions before implementation. Before overlapping implementation, resolve the old conductor disposition, repair/inspect its stale worktree link and address the abandon command’s worktree-preservation mismatch. The user’s approval applied to draft creation only, not retirement. Do not resume the obsolete step 3 or blindly merge/cherry-pick the old commits. The first replacement plan is `2026-11-01-core-foundation`; starting it still requires eligibility and a human readiness decision. Later plans require human-finished/merged predecessors under `wait_for_merge`.

All prior dirty work and historical review records are preserved. No lifecycle transitions, implementation, pin refresh, commit, push, merge, worktree repair or deletion occurred. At the end of each authorized milestone, rewrite this root HANDOFF.md with the goal, decisions, current state, evidence, next steps, and this instruction, then tell the user.

## Previous milestone: conductor disposition reviewed; checkout and retirement blockers found

Compared the two unique conductor commits (`8898627`, `092a6f8`) with current source. Configuration, gates and force-reason recording already have newer implementations. Do not merge/cherry-pick the old commits wholesale: the old lock overwrites files and fails open on malformed data. Preserve the old CLI integration test scenarios as review input for replacement manual-lifecycle step 3, and retain branch-local progress/gap history and attribution. Details: `docs/work-records/2026-11-01-conductor-disposition-review.json`.

Fresh `plan list --live --no-fetch` still reports stored ready/effective in_progress, 2/5 steps done, step 3 pending. However, the registered checkout is unusable by Git: its `.git` points to the former `specs-framework/.git` location. `git -C <checkout> status --short` failed. Dirty/untracked state and worker liveness are unknown; local status output does not establish checkout health.

A second blocker changes the retirement recommendation: the plan-abandon contract preserves the worktree unless deletion is requested, but current `abandonPlan` unconditionally removes it, commits/archive-updates on the default branch and may push. Do not run it from this dirty integration branch or use force. Repair/inspect the worktree through Git tooling and resolve preservation behavior before retirement. No repair, deletion, lifecycle transition, plan creation, implementation, commit, push or merge occurred.

**Next human decisions:** approve the existing seven-plan/23-step proposal for draft creation, and confirm intended retirement of the old conductor with its branch and checkout retained. Draft creation approval is required by `architecture/agent-skills` plan-create step 5; abandonment confirmation by plan-abandon step 2. Readiness and specification approvals remain separate. A retirement decision does not bypass the two execution blockers above.

Verification: local CLI status and source comparison completed; checkout status failed as described. No implementation tests or spec validation rerun for this review-only milestone. Prior validation results remain historical. At the end of each authorized milestone, rewrite this root HANDOFF.md with the goal, decisions, current state, evidence, next steps, and this instruction, then tell the user.

## Previous milestone: implementation proposal reviewed and refined once

Reviewed the seven-step proposal against the architecture, step-grouping rules, current implementation and the conductor branch's own handoff. The replacement proposal is `docs/work-records/2026-11-01-implementation-proposal-review.json`: **seven dependent plans, 23 smaller steps**, with per-step deliverables, acceptance checks and validated context. The previous JSON remains historical and its seven-step decomposition is superseded.

Order: core foundation → workflow recording → manual lifecycle → extension packaging → separate Codex and Claude delivery plans → cross-package conformance. Move nested-test execution verification and compatibility checks ahead of their consumers. Keep human gates distinct, migrate manual recording callers with the new input, and separate native host delivery from generic fallback success. Context uses heading text accepted by the current plan validator, including H2/H3 parents for H4 subsections.

The existing `2026-10-30-plan-conductor` is locally **in_progress**, with two of five steps recorded done and its checkout at `092a6f8`. Its branch contains two commits absent from current HEAD (`8898627`, `092a6f8`); current source also contains the later conductor implementation `d5b9afc`. Do not infer that either branch should be merged or the old plan marked complete. Resolve ownership/disposition and compare useful unique work before overlapping implementation. The recommendation is to reconcile useful work and retire obsolete pending scope through an authorized CLI workflow, not blindly resume step 3 or make the new work wait for that obsolete design. No old plan files or checkout were changed. Status inspection used local refs with `--no-fetch`; process liveness and remote freshness were not verified.

Feature eligibility is broader than the prior handoff stated: base agent-integration, plan-execution, configuration and Claude feature are `review`; Codex feature is `draft`. Include relevant feature specs explicitly rather than bypassing start eligibility with an architecture-only spec list. ADR 0005 remains proposed. Dependency mode is wait-for-merge, so later plans need human-finished/merged predecessors. Missing native host evidence blocks the corresponding Claude delivery work; it cannot be counted as implemented merely because capabilities stay disabled.

Evidence: proposal JSON, source/spec references, context anchors and dependency order checked; 7 plans, 23 steps, 92 references. Final `git diff --check` passed. No implementation tests/build/spec validation rerun because this milestone changes only the proposal record and root handoff. Prior repository validation remains historical evidence: 0 errors, 65 warnings. No specification, implementation, plan, pin, lifecycle, commit or merge changes were made.

**Next:** review this refined decomposition and resolve the old conductor plan's disposition before implementation. Draft plan creation still requires user approval under the plan-create contract; this review request does not grant it. Create approved proposals via CLI, settle target commits and feature eligibility, then obtain separate plan readiness decisions. At the end of each authorized milestone, rewrite this root HANDOFF.md with the goal, decisions, current state, evidence, next steps, and this instruction, then tell the user.

## Previous milestone: architecture findings addressed in draft; implementation proposed

Continued the recorded next action by revising `architecture/reference-cli` and the shared `architecture/agent-skills` recording procedure. R1 now specifies an explicit digest-bound `--recording-set` manifest shared by manual CLI/core, exact staging checks and recovery. R2 defines checkout/repository writer coordination, ordered acquisition, non-plan writers and worker-aware recovery. R3 defines closed test execution receipts with core ledger binding, expected suites and parsed reporter evidence. These are draft resolutions for human review, not implemented behavior or lifecycle approval.

`docs/work-records/2026-11-01-architecture-resolutions.json` records source hashes, resolutions, fresh validation and a seven-step implementation proposal: core/schema exports; writer coordination; provenance; prepared workflows/evidence/recording; human gates and neutral lifecycle; package/migration; host integration and verification. Context and acceptance criteria are included for each proposed step. No plan files were created. Before creation, inspect overlap with the existing conductor plan and resolve dependencies. All prior dirty work and historical review artifacts are preserved.

Evidence: fresh CLI build passed; repository validation **0 errors, 65 warnings** (40 overlay, 23 skill-drift, one base-changed, one pin); `git diff --check` passed. No implementation suite or live host checks ran. Historical warning dispositions retain their original source hashes; unchanged counts do not revalidate them against changed text.

**Next:** human review of the three draft resolutions and approval of the concrete implementation decomposition. `architecture/agent-skills` plan-create step 5 requires user approval before creating draft plan files. Then create through the CLI, resolve spec/start eligibility, and obtain a separate human readiness decision before implementation in the plan checkout. Codex specs remain draft; ADR 0005 remains proposed. No commits, pins, pushes, merges, or lifecycle transitions occurred.

At the end of each authorized milestone, rewrite this root HANDOFF.md with the goal, decisions, current state, evidence, next steps, and this instruction, then tell the user.

## Previous milestone: focused architecture consistency review

Continued from the completed architecture design into repository-local review. The design exists; this review does not restart drafting, approve it, or certify implementation compatibility. The goal remains preparing this branch for eventual human review and merge.

Recorded three open findings in `docs/work-records/2026-11-01-architecture-consistency-review.json`, with source hashes, exact references, consequences, and proposed resolutions:

- **R1 (high): conflicting recording contracts.** The manual `step-done` section includes all staged files and stages the plan folder; the new shared-core contract rejects unrelated changes and forbids blanket staging. Reconcile the primitive's contract before implementation rather than choosing one side.
- **R2 (medium): non-plan writer coordination is unspecified.** The API supports spec/ADR/creation workflows, but writer locks are defined only by plan ID. Define serialization and lock ordering for shared checkout/index mutations.
- **R3 (medium): test-evidence wire format is incomplete.** Closed-schema artifacts have three named fields, while test artifacts require additional execution evidence without a defined variant or referenced payload schema.

Fresh CLI build passed. Fresh repository validation remains **0 errors, 65 warnings** (40 overlay, 23 skill-drift, one base-changed, one pin). The 40 archived contextual warning dispositions remain unchanged; these three manual review findings are separate. `git diff --check` passed before recording this milestone. No implementation suite or live host verification ran.

Only this root handoff and the new JSON review record were changed by the review milestone. Existing dirty specifications and historical records were preserved. No implementation, plan files, dependency pins, lifecycle statuses, commits, pushes, or merges changed.

**Next:** resolve the recording contradiction and settle the two protocol/coordination gaps, then prepare the implementation proposal against that target. Repository instructions prohibit implementing either side of contradictory specs. The plan-create contract requires approval of the proposed decomposition before creating draft plan files; readiness remains a separate human decision. Pin refresh still follows committed targets and implementation review as described below.

At the end of each authorized milestone, rewrite this root HANDOFF.md with the goal, decisions, current state, evidence, next steps, and this instruction, then tell the user.

## Prior clarification: architecture already updated; implementation remains

The architecture has already been updated for the recent feature changes. Do not restart architecture drafting or describe it as missing. The five changed architecture specs cover the shared CLI/core, agent workflows, file formats/provenance, Claude integration, and Codex integration. This design is complete for human review and remains uncommitted; completion does not imply human approval or live compatibility.

CLI/core behavior, adapters, delivered skills, templates, and contract pins have not yet been brought into alignment with that design. The next work is review of the completed architecture, followed by implementation planning against the settled target. The user's request to clarify and record this state does not approve specs, ready a plan, accept an ADR, or authorize a merge.

The 25 remaining dependency-review warnings are change notifications, not 25 confirmed implementation defects:

- 22 Claude skill warnings: installed and template copies of each of `approve`, `decision-new`, `plan-abandon`, `plan-create`, `plan-finish`, `plan-start`, `plan-status`, `plan-step`, `spec-assist`, `spec-draft-architecture`, and `validate`.
- One Codex `specplane` skill warning.
- One stale Claude architecture-to-feature dependency pin and one missing Codex architecture-to-shared-agent-skills pin.

After the reviewed specification targets are committed, refresh the two specification dependency pins through the CLI. Review/update the delivered integrations and supporting implementation before refreshing skill pins; changing hashes alone would not establish conformance. No additional fixes or file changes were made during the follow-up discussion; this handoff update records its clarification. The latest executed validation remains the warning-triage result below.

## Previous milestone: warning triage complete

Fresh build and validation confirmed the previous 70 warnings. Added four public execution interface terms to `specs.feature.leak_guard_allow`, removing five identifier false positives. Current raw validation: **0 errors, 65 warnings**. Of those, **40 overlay warnings are archived as contextual false positives** in `docs/work-records/2026-11-01-warning-triage.json`, with per-finding reasons and current source hashes. **25 dependency-review warnings remain open** (23 skill drift, one stale base pin, one missing pin). Pin mismatches establish review debt, not proof every skill is defective.

The CLI has no general persisted warning dismissal/archive feature. The review archive does not suppress CLI output; raw validation still prints the 40 reviewed overlay findings. A future feature should bind dispositions to exact findings and source revisions, reopen them when sources change, preserve reasons, and expose active versus archived counts. This is a proposed follow-up, not an approved feature specification or started plan. Existing historical review artifacts remain unchanged. No commits or lifecycle transitions were made.

## Previous milestone: architecture design complete for review

The **architecture-specification milestone is complete**. The target now defines the core/extension API, compatibility checks, structured reasoning/recording boundary, human confirmations, cancellation, contribution capture, and legacy workflow migration. This is specification design, not implementation or human approval. Initial Codex scope remains existing-session reasoning and the full manual CLI; native commands and background execution remain unavailable.

Branch: `dot/codex-integration-20261101`. HEAD remains `74d1f0fcd3e65751ed49a024a7e04631ede7359e` — `docs(specs): define extension-owned workflows and provenance`. This milestone made no commits, pushes, merges, lifecycle-status changes, or ADR acceptance. All architecture changes and the prior warning-review changes remain in the working tree. `problems.md` is temporary, untracked, unchanged and uncommitted.

Read AGENTS.md and `.specplane/config.yaml` first. Configured spec roots are `docs/specifications` (base), `harnesses/claude/specifications` (Claude overlay), and `harnesses/codex/specifications` (Codex overlay). Plans resolve from `plans`; decisions default to `docs/decisions` because config omits `decisions.dir`. This root session handoff is not a plan progress record. No plan was started and no plan progress files were edited for architecture design.

## Goal and agreed boundaries

Prepare this branch for eventual human review and merge into main. The completed milestone covers architecture specifications only.

- An extension is any harness plugin, extension, or mod delivering workflows. Each bundles a compatible shared core and supplies its adapter directly. No provider registration, executable discovery, registry-order runtime choice, or default host. Multi-host entry points require explicit selection.
- The standalone CLI remains complete for the manual lifecycle, including human approvals. The target removes standalone `plan run` and `plan start --run`; manual start and plain init are neutral. Harness install/refresh requires explicit selection. Co-installed integrations preserve shared neutral guidance.
- Mechanical operations run in code without model calls. Agent reasoning sits between deterministic preparation and validation/recording. Human decisions remain explicit and revision-bound; model prose is not authorization. Host built-ins remain host-owned.
- Claude targets a plugin/mod with native `$.command.register` / `command.run` dispatch, internal reasoning assets, and policy hooks. Documentation supports this design; live implementation compatibility is unverified.
- Codex supports reasoning inside an existing authorized session and manual CLI operations. Package/skill delivery does not establish native dispatch, background sessions, or verified live compatibility. Never substitute Claude or infer support from help text.
- Preserve every contributing human/model and revision-linked event, including multiple models in one session and subagents. A model selection without work adds no contributor. Runtime identity requires host evidence; unknown identities stay unknown. Identity never grants permission.
- Authorship does not override `llm_role`. Under `none`, reading/implementing remains permitted, but spec-body editing, review and suggestions are prohibited.

The prior user authorized writing the agreed spec changes from gist-level approval without another exact-text round. That is scoped authorization, not a permanent policy override or a lifecycle transition. Existing statuses remain unchanged; Codex specs remain draft and ADR 0005 remains proposed. Final merge remains human-only.

## Architecture changes and entry points

Start at **Shared conductor and extension boundary** and **Architecture readiness** in `docs/specifications/architecture/reference-cli.md`.

1. **Core and compatibility:** target ESM `specplane/core` exports, typed mechanical operations, explicit session adapter request/results, package manifest, exact bundled version/protocol checks, SHA-256 runtime/procedure inventories, and a per-surface tested host matrix. A copied skill, prepared package, installed plugin and enabled plugin are distinct states. No live version matrix is currently certified.
2. **Reasoning boundary:** `WorkflowRequest`, `WorkflowResult`, and `RecordingProposal` bind context, criteria, actual edits, test artifacts, gaps, contribution events and current revision. Core validates and records once; publication retry does not repeat implementation. Parent/worker lease delegation avoids recursively locking a plan and prevents reclaiming a still-running worker merely because its parent died.
3. **Human gates and cancellation:** direct human interaction consumes one-use, revision-bound challenges; approval, exact-text authorization, finish acceptance and local merge remain separate decisions. Cancellation retains partial edits, stops dispatch, and requires worker-stop evidence before lease release. Existing commits are reported rather than claimed rolled back.
4. **Migration:** installation inventories ownership digests and collisions, preserves customized assets, checks all path components including dangling links, stages/journals writes and backups, recovers interrupted upgrades, and activates no partial command set. Legacy public prompt skills retire only when their replacements are ready. Host reload/enablement and built-in command ownership remain explicit.
5. **Procedures:** `architecture/agent-skills` now maps whole-workflow steps to code, reasoning and human interaction. Shared creation uses the core operation or CLI. Agents do not compete with core recording; fallback sessions remain labeled.
6. **Provenance:** `architecture/file-formats` §1.7 defines action-time capture and transport, trusted runtime versus declared identity, subagent forwarding, event-ID deduplication, summaries, repeated Git trailers, corrections and origin preservation across rewrites. Commit readers preserve every contribution trailer rather than taking only the last one.
7. **Claude:** its architecture reconciles customized-file refresh, argument parsing, startup context versus action provenance, worker/core recording, package layout, mod prompt/completion-tool delegation, direct human UI gates, cancellation and per-command collisions. Exact host signatures require installed declarations and live verification before enablement.
8. **Codex:** its architecture specifies the repository skill subtree, bundled Node/core/snapshots, optional portable root `plugin.json`, host install interfaces, supported surface prerequisites and a persistent NDJSON runner protocol. Surfaces lacking a persistent tool channel use the manual CLI procedure; native/background flags stay false.

No implementation, adapters, templates, installed skills, or skill pins were changed. The five architecture files contain the new design; feature-spec modifications already present at entry remain the previous reviewed pin updates.

## Evidence and validation

`docs/work-records/2026-11-01-architecture-completion.json` records requirement coverage, source URLs, reviewed architecture-file SHA-256 hashes/statuses, full baseline/final validation reports, new warning dispositions, verification and deferred work. These hashes identify the working-tree design snapshot, not a commit or approval.

- Fresh CLI build: **passed**, `npm run build` in `packages/cli`.
- Fresh repository validation: **0 errors, 70 warnings**, versus **0 errors, 68 warnings** at entry.
- Warning types: `base-changed` 1, `pin` 1, `identifier` 5, `overlay` 40, `skill-drift` 23.
- The two additional overlay warnings are contextual false positives: core-owned step recording versus a historical status comment, and package-relative assets versus the rule requiring repository paths from config. Exact diagnostics/rationales are in the new record. No warning suppression or allowlist edits.
- `git diff --check` passed. Twelve JSON fences contain thirteen parseable JSON values; the pre-existing Claude registration fence intentionally contains two snippets. All five edited architecture lifecycle statuses match HEAD.
- No implementation suite or live host/model/native-command/background evaluation ran. Build/spec validation establishes neither implementation conformance nor runtime compatibility.

The prior warning-review artifact, `docs/work-records/2026-11-01-validation-warning-review.json`, remains unchanged historical evidence. It reviewed all 76 original warnings, corrected three stale architecture passages, refreshed eight dependency pins against committed targets, and reached 68 warnings. Its hashes describe the earlier snapshot, superseded for the five edited architecture files by the new record. Its 38 contextual overlay dispositions remain scoped to that text; its 23 skill-drift warnings were deferred for implementation review.

## Next steps and deferred implementation

The next milestone is human review of this architecture and implementation planning against the settled design. Do not treat this handoff as approval, ADR acceptance, plan readiness, or merge authorization. If asked to execute a plan, use the repository's CLI routing and its designated plan checkout; this branch is not `plan/<id>`.

After settled target text is committed, review and refresh dependency pins through the CLI:

- `node packages/cli/dist/cli.js spec pin claude:architecture/claude-integration claude:feature/claude-integration`
- `node packages/cli/dist/cli.js spec pin codex:architecture/codex-integration` (review all implements and extends targets).

Do not pin dirty targets or refresh delivered skill comments as a claim of conformance. Implementation review must update core exports, command surfaces, adapters, installation/migration, complete delivered procedures and contract snapshots/pins, provenance capture, and host integration tests. Include interrupted upgrades, stale confirmations, parent/worker lease recovery and cancellation, repeated contribution trailers, same-session A/B and later C contributions, unknown/subagent identities, ordinary remote-backed plan steps and nested test assertion execution.

Previously observed implementation concerns remain deferred: implicit conductor runtime selection, unconditional Claude manual-start commands, registry-order shared guidance, dangling Codex skill links, incomplete delivered Codex step procedure, and inherited `NODE_TEST_CONTEXT` hiding child assertions. Prior focused test counts are historical and do not prove those child assertions ran. `problems.md` is older context; its provider-registration proposal is superseded by the extension-owned adapter design.

## Continuing handoff instruction

At the end of each authorized milestone, rewrite this root HANDOFF.md with the goal, decisions, current state, evidence, next steps, and this instruction, then tell the user. Architecture design is now complete for review; implementation and formal human lifecycle decisions remain separate. Historical records, archived plans and the conductor plan provide context, not authority to merge or bypass gates.
