# Overnight Codex / ChatGPT Work prompt

## Before sending

This prompt is for a hosted overnight implementation run. Saving this file does
not launch that run. It incorporates the user's decision to skip live testing
for both hosts and package publication, with the remaining workflow choices
selected under the user's delegation.

Selected execution policy:

| Decision | Handling |
| --- | --- |
| Managed lifecycle gates | Implement on an isolated review branch; leave formal plan readiness, finish acceptance and lifecycle approvals for human review. |
| Target-lifecycle step 2 | Use the proposed four-part split as worker assignments, preserving every original criterion and leaving CLI-owned plan files unchanged. |
| Commits and merges | Permit commits, conflict resolution and integration among overnight branches; protect original branches, worktrees and unrelated edits. |
| Remote publication | Push only the dedicated overnight review branch to this repository's existing origin, without force. Do not push original branches, tags, packages or releases. If unavailable, retain a downloadable Git bundle/patch and continue local work. |
| Dependencies and live tests | Allow project-local dependencies and non-live automated tests for both hosts. Skip real Claude/Codex host sessions and model API calls made by the software under test, whether paid or free. Record live certification as deferred, not passed. |
| Missing requirements | Resolve routine reversible engineering choices; record contradictory or missing product requirements and continue independent work. |

The review-branch exception changes only how this overnight development run is
organized: tested predecessor code can be integrated into a separate branch and
used by later workers without waiting for managed plan finish/approval prompts.
It does not change Specplane's shipped approval behavior, mark managed plans
approved/done, or merge into the original integration branch. Formal acceptance
remains a later human action. All other applicable repository rules still apply.

Verify that the repository, unpublished commits, uncommitted implementation and
tools are present in the hosted executor before turning off the local computer.
Cloud coordination alone does not establish independent cloud execution. Resolve
cloud network, connector and repository access beforehand. No prompt overrides
platform permissions, account limits or service interruptions.

The previous roughly four-hour estimate describes extrapolated worker execution
along the dependency chain. It excludes coordinator/integration overhead and is
neither a completion guarantee nor a stopping deadline.

## Prompt to send

Complete the remaining Specplane implementation roadmap in this hosted
workspace. I will be offline and my computer will be off. Execute the work;
do not stop after planning, completing one step, or completing one plan.

### Objective and authority

Implement, test, review and integrate as much of the remaining roadmap as
possible, ideally all of it. Use a separate overnight review branch.
Create a unique branch named `overnight/specplane-<UTC-timestamp>` and record its
exact name. Never reuse an unrelated existing branch with the same name.

For this run I explicitly authorize ordinary-Git implementation outside the
managed plan lifecycle, using the existing plans and specs as requirements.
This is a scoped exception to repository instructions requiring managed plan
execution and human-finished predecessors for development.

It does **not** authorize changing the product's human-confirmation contracts,
fabricating human approval, or declaring managed plans formally finished.

I authorize:

- Creating isolated branches/worktrees in the hosted workspace.
- Project-local dependency installation from configured sources.
- Implementation, tests, builds and packaging checks.
- Commits and serialized integration merges among overnight branches.
- Normal, non-force pushes of the dedicated overnight review branch to this
  repository's existing `origin` after verifying the remote identifies the
  intended repository.
- Resolving implementation conflicts while preserving required behavior.
- Splitting oversized assignments into smaller sequential substeps without
  losing any acceptance criteria.

Do not modify protected/original branches, delete existing worktrees,
discard unrelated edits, force-push, publish releases or deploy.
Do not run live Claude or Codex host sessions or model API calls as tests of the
software under development, even if they would be free. Do not purchase external
services. This restriction does not prohibit the coordinator and implementation
subagents from doing their normal coding work in the current task.

Do not publish to npm or other package registries, create releases, push tags,
or push the original integration/default branches. Local package builds and
`npm pack`-style consumer checks are allowed. Do not create a new hosted remote
or hosted repository; disposable local test repositories are allowed.
If the authorized Git push cannot proceed, preserve a Git bundle
or patches and continue useful local work rather than waiting for credentials.

### Preflight

Read AGENTS.md, `.specplane/config.yaml`, the latest root HANDOFF.md, current
plan handoffs and relevant work records. Resolve paths from configuration.

Verify:

1. Commands, repository files and subagents execute in hosted infrastructure
   independent of my computer.
2. The supplied snapshot includes unpublished commits, current plan branch
   history and the uncommitted target-lifecycle step-2 implementation.
3. Git writes, worktrees, dependencies, subprocess tests and subagents work.
4. Outputs can be preserved and retrieved after this run.

The source integration branch is `dot/codex-integration-20261101`, not `main`.
At prompt preparation its implementation base was `37a77e1`. Target-lifecycle
step 1 was recorded separately as `346425f` on its plan branch; step 2 also had
uncommitted changes in its plan checkout. Verify these facts against the supplied
snapshot, including ancestry and file hashes. Do not assume pushing this prompt
also transferred the other worktree or uncommitted records. Use cloud-local
paths discovered at runtime, not historical absolute paths on my computer.

Use actual checkout state as authority; older handoff sections may be stale.
Do not assume a remote checkout contains local-only work. If required input
is missing, record exactly what is missing and work only on unaffected scope.

Snapshot initial branch/commit identities and relevant dirty-file hashes.
Preserve original work. Create an isolated baseline for this run and record
how each existing patch or commit was incorporated. Never blanket-stage
unrelated files.

Inspect available Claude and Codex declarations, protocol contracts and version
metadata early using an independent investigation subagent. Do not launch live
host sessions. Record live certification as deliberately deferred for both
hosts. Missing declarations may block code that depends on unknown APIs; do not
invent those APIs. Continue all implementation and checks that do not need them.

### Scope and dependencies

Reconcile the current roadmap before dispatch:

- Target lifecycle
- Plan index
- Workflow recording
- Manual lifecycle
- Completion assessment
- Product docs
- Extension packaging
- Claude delivery
- Codex delivery
- Extension conformance

Core foundation is already completed; verify rather than redo it.
Preserve the old conductor checkout/history.

The expected dependency graph is:

```text
target lifecycle -> plan index -> workflow recording -> manual lifecycle
manual lifecycle + completion assessment + plan index -> product docs
product docs -> extension packaging
extension packaging -> Claude delivery and Codex delivery
Claude delivery + Codex delivery -> extension conformance
```

Verify this against current requirements. In this review-branch workflow,
a dependency becomes implementation-ready after its required code has been
reviewed, tested and integrated into the overnight branch. Do not describe
this as managed lifecycle approval or completion.

Deferred live certification alone must not prevent downstream non-live work
whose actual code prerequisites are available. Exercise applicable conformance
checks and report the missing live evidence separately; never label full host
certification or every original acceptance criterion as passed.

Use the proposed four-part target-lifecycle step-2 decomposition as worker
assignments, preserving the original scope and criteria. Track the mapping
in a separate run ledger; do not hand-edit CLI-owned plan files.

The proposed assignments for original target-lifecycle step 2 are: (a) creation
inputs and immutable comparison validation; (b) read-only start preparation from
authoritative target snapshots; (c) first-start binding, ordered leases and
rollback/recovery; (d) resume and checkout preservation. Run them sequentially.
Check each against the original step text; this summary does not replace its
acceptance criteria. Missing proposal notes alone are not a reason to stop.

### Subagent contract

You are the coordinator. Delegate every implementation step to a fresh
subagent with a self-contained brief and fresh context where supported.
Do not implement whole plans yourself or give one worker the entire roadmap.

Each brief must include:

- Plan ID, original step ID and any substep mapping.
- Exact checkout, branch and base commit.
- Relevant specs, acceptance criteria and prerequisite commits.
- File ownership and shared-file risks.
- Required meaningful tests and expected evidence.
- Known blockers and applicable permissions.

Each worker owns its step end-to-end: investigation, implementation, tests,
repairs, gap reporting and a durable result containing changed files,
commits/diffs, test results and limitations. No nested delegation.

Prefer the established Terra/high worker configuration if available.
If unavailable, use an available capable coding model and record the
substitution; do not stop solely because a preferred model is unavailable.

Run independent steps concurrently in separate worktrees. Start with
target lifecycle and completion assessment. Later run Claude and Codex
delivery concurrently. Respect actual agent capacity and dependencies;
do not launch dependent steps speculatively.

Use additional capacity for independent review or host investigation.
Never allow competing writers in one checkout. The coordinator alone owns
the shared run ledger and integration branch.

An idle worker still may occupy an agent slot. Close or release completed worker
sessions using supported lifecycle controls after review and durable evidence
capture. If all slots are occupied, resolve or release existing assignments;
do not silently abandon the run. Keep one implementation owner per step. Worker
briefs must include this run's review-branch exception, deferred-live-test policy
and approval recovery procedure, so stale handoff instructions do not restart
human-gated workflows. Never run tests or Git commands against the original
checkout merely because a child inherited its working directory.

### Review and integration loop

For each settled worker result:

1. Review the diff against its criteria and inspect test evidence.
2. Return actionable findings to the same worker while it is available.
3. If it has ended, use a fresh repair subagent with the exact current state.
4. Integrate accepted changes serially.
5. Resolve conflicts through a delegated repair assignment.
6. Run checks justified by the integrated changes.
7. Checkpoint the ledger and immediately dispatch the next eligible work.

Do not count an agent's “done” message as verified completion.
Do not repeatedly rerun unchanged passing tests without a concrete reason.
Run required final integrated validation and report failures honestly.
Never weaken assertions or acceptance criteria merely to get a pass.

Use non-live verification for both hosts:

- Unit and contract tests with real assertions.
- Protocol framing, request matching, disconnect, cancellation and error tests
  using deterministic scripted clients and fake host adapters.
- Real CLI/subprocess integration tests in disposable repositories.
- Git synchronization/push/failure scenarios against disposable local bare
  remotes where appropriate; no hosted service or live agent is required.
- Builds, type checks, schema validation, local package/consumer installation
  checks and installed-asset tests against isolated project-local directories.
- Final integrated regression and repository validation checks applicable to
  this run, excluding only tests that actually require live host/model access.

Keep simulated evidence explicitly labeled. Test doubles do not establish live
host compatibility. Record excluded live tests and their exact prerequisites.
Do not enable unsupported native/background capability flags on fake evidence.

After integrating a reviewed plan-sized milestone, checkpoint the authorized
review branch to origin if available. Serialize pushes, record success or
failure, and never force a diverged remote branch. Preserve local results and
continue independent work if publication is unavailable.

### Continuation and recovery

Continue automatically after every result. Do not ask “shall I continue?”
Do not end the task merely because a worker ended, a plan ended, or a
context compaction occurred.

Use event-driven agent completion. Avoid repeated short polling and
busywork. Before waiting, determine whether independent work can proceed.

On failure, preserve evidence and diagnose before retrying. Use bounded
retries for transient errors. Do not repeat an unchanged failing command
indefinitely or duplicate a worker whose execution status is uncertain.

Before replacing a worker, establish that its writers have stopped. Inspect
its checkout and commits before replaying any operation.

### Approval-blocker failsafe

Keep `approval-blockers.json` beside the run ledger. Record each blocked action,
its exact error or approval requirement, affected criteria, checkout/commit,
whether execution started, partial side effects, permitted alternatives tried,
chosen fallback and the exact human action needed later. Exclude secrets.

Before invoking operations likely to prompt, check their documented
noninteractive behavior and available permissions. Do not enter managed
approval/finish flows in this ordinary-Git run. Use supported automatic review
only when already available and allowed by the environment.

If an approval blocks an action:

1. Check whether it executed or left a running process; preserve partial state.
2. If it is merely an optional workflow/publication/live-test gate, defer that
   action and continue the authorized implementation and local validation.
3. Use a permitted alternative that actually satisfies the same requirement:
   project-local instead of global installation, disposable local Git remotes
   for Git behavior tests, or local bundles when remote publication is blocked.
   Label simulated host tests correctly; they cannot satisfy live certification.
4. If no permitted equivalent exists, retain the affected criterion as blocked
   and dispatch independent work immediately. Do not wait indefinitely for me.
5. Revisit deferred actions after a relevant dependency or permission changes,
   and once during final reconciliation. Do not repeatedly submit the same
   denied request without new evidence or changed conditions.

This is recovery around unavailable optional actions, not authority to bypass
access controls. Do not synthesize affirmative input, change security policy,
use alternate credentials/executors to evade a denial, or treat a timeout as
approval. A platform-level pause may prevent all further execution; no prompt
can guarantee recovery from it. Checkpoint before foreseeable approval risks.

### Progress and durable state

If a step requires unavailable permission, a human product decision,
contradictory requirements or missing host capability:

- Record the exact blocker and affected criteria.
- Preserve partial work.
- Block only dependent work.
- Continue every other authorized implementation, test, review, packaging
  or documentation task that can produce useful results.
- Do not bypass security controls or invent confirmation/certification.

Routine reversible engineering choices are yours to make and document.
Do not change feature-spec bodies or approval states to remove a blocker.

Keep a durable machine-readable ledger in a separate run-owned location.
After each meaningful transition record:

- Baseline and integrated commit IDs.
- Step/substep mapping and worker assignment.
- Pending/running/implemented/reviewed/integrated/blocked status.
- Test commands and outcomes.
- Remaining dependencies and exact next action.
- Worker elapsed time, separately measured approval waits, token usage
  when available, and unknown timing intervals.
- Active processes or uncertain operations requiring recovery.

After interruption or compaction, reconcile this ledger with actual Git
state before continuing. Never restart completed work blindly.

Maintain an acceptance matrix mapping every original criterion to its code,
test evidence and status: verified, failed, blocked, or deliberately deferred.
Work on achievable portions of a partially blocked step when their prerequisites
are established. Do not reduce the goal to the easiest subset or allow an entire
plan to disappear because one criterion requires live evidence.

Bound test subprocesses with timeouts appropriate to their normal runtime.
On a hang, preserve logs, stop only the owned process tree, diagnose the cause
and delegate repair. Avoid background commands that outlive their owner or
continue writing after a result is declared settled. Check available resources
before expensive parallel builds; serialize them if contention impedes progress.

Record usage when available; use focused briefs and concise evidence instead of
repeated full-history reads. Do not infer an unlimited budget. If a hard limit
is approaching, save the acceptance matrix, branch and recovery artifacts before
exhaustion. An interruption cannot be assumed to restart itself automatically.

### Stopping and delivery

Do not stop because an estimate has elapsed. Continue until:

- All achievable criteria are implemented and verified; or
- Every remaining useful action is genuinely blocked after investigation; or
- The platform imposes a hard limit or I explicitly stop the run.

Before a foreseeable limit, prioritize durable checkpoints and recoverable
outputs. A progress update is not a final answer.

Before declaring completion or an all-blocked result, reconcile every roadmap
step and criterion, check for remaining eligible work, and account for all active
workers and owned processes. Delegate a final independent review of the integrated
diff and acceptance matrix. Resolve actionable findings through repair subagents.
Do not finish while an implementation worker is still running. Deliberately
deferred live tests and human lifecycle approvals must remain visible in the
final report, even when all non-live implementation work is complete.

Deliver:

- The review branch and exact integrated commit.
- The remote review-branch reference and push result, or a retrievable Git
  bundle/patch artifact if pushing is unavailable and artifact delivery exists.
- Per-step implementation and verification status.
- Integrated test results and unresolved failures.
- Explicitly separate implementation completion, live certification,
  managed lifecycle approval and publication.
- List deliberately deferred live Claude/Codex tests and package publication
  separately from unexpected implementation blockers.
- Exact blockers and minimal actions needed to resume.

Do not claim background execution continues after your final response.

## Official documentation checked while drafting

- [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- [Long-running work](https://learn.chatgpt.com/docs/long-running-work)
- [Cloud environments](https://learn.chatgpt.com/docs/environments/cloud-environments)
- [ChatGPT Work cloud security](https://learn.chatgpt.com/docs/enterprise/chatgpt-work-cloud-security)
