# Conductor step 01 — feature-text review draft

**Not approved. Not applied. Not a replacement plan.** This document presents a bounded proposal for a human to finalize and approve. It does not edit the feature specs or change any status. The existing `2026-10-30-plan-conductor` plan is already recorded as ready; that alone does not satisfy the separate `assist` text-approval gate.

## Requested decision

Confirm or amend the following feature-text changes and the explicitly identified assumptions. Approval would authorize applying only this text while preserving existing statuses. It would not approve or finish a plan, approve an ADR, authorize a merge, or authorize external notification setup.

## 1. `feature/configuration`

Add these proposed defaults under `execution` in “Full schema with defaults”:

```yaml
session_mode: auto             # auto | unattended; never forces attended
notify:
  on: [blocked, consideration, finish_ready, failed]
  transport: none              # none | harness | command
  command: ""
  dedupe: true
max_parallel: 1
max_budget_usd: null           # no configured limit; see assumption A2
```

Add key-reference entries with the following text:

### `execution.session_mode`

Type: `auto | unattended`. Default: `auto`.

`auto` uses the harness's session-mode detection. `unattended` forces unattended behavior even if the harness detected an attended session. Configuration never forces a session to be attended. When the harness detects no available human, the session remains unattended under either setting. The consequences of unattended operation remain those defined by `feature/spec-precedence`; this setting does not waive approval or authorship requirements.

### `execution.notify`

Specplane decides whether a new consideration needs attention and what decision would resolve it. Delivery belongs to the harness or the user's configured command. The default transport is `none`, which sends nothing.

`on` selects events that can produce an alert: `blocked`, `consideration`, `finish_ready`, `done`, and `failed`. The default is `[blocked, consideration, finish_ready, failed]`. `consideration` includes unresolved proposals or assumptions, restack needed, divergence, dirty checkout, and exhausted execution limits. Ordinary progress does not produce an alert. (Event grouping is proposed assumption A1.)

`transport` is `none`, `harness`, or `command`. With `harness`, Specplane surfaces the alert to the harness and sends nothing itself; the user's existing harness settings control delivery. With `command`, Specplane invokes the configured `command` for each selected alert, passing `SPECPLANE_PLAN`, `SPECPLANE_KIND`, `SPECPLANE_DETAIL`, `SPECPLANE_COMMAND`, `SPECPLANE_SESSION`, and `SPECPLANE_CHECKOUT`. `command` defaults to an empty string; selecting `command` with an empty command is an invalid configuration (assumption A3).

`dedupe` defaults to `true`: the same plan, kind, and detail produces only one alert until the consideration changes. An alert names the decision needed and the resolving command. Specplane never enables a notification transport or external channel on the user's behalf.

### `execution.max_parallel`

Positive integer. Default: `1`. This limits simultaneous plan execution. A higher value permits distinct plans to run concurrently, never two steps of the same plan.

### `execution.max_budget_usd`

Positive number or `null`. Default: `null` (no configured limit). A configured limit is passed to the harness; reaching a limit stops execution and requires attention. An adapter must not claim enforcement it cannot verify. `null` representation, positive-value validation and unsupported-limit refusal need confirmation as assumption A2.

## 2. `feature/spec-precedence`, Rule 4 session-mode paragraph

Replace only the sentence “Whether a session is attended is decided by the harness, not by config” with:

> The harness detects whether a session is attended; `execution.session_mode: unattended` can force unattended behavior, but configuration can never force an attended session when the harness detected no available human.

Keep the remaining definition, examples, fallback-to-unattended rule, and approval/authorship rules unchanged.

## 3. `feature/agent-integration`

Add a section with this text:

> A conductor may run one plan step at a time through a harness adapter. A consideration is a condition requiring a human decision or corrective action rather than ordinary progress: a blocked step, an unresolved proposal or assumption, readiness for human finish review, restack needed, divergence, a dirty checkout, exhausted execution limits, or failure. The conductor stops at such a condition and states the decision and resolving command. It never approves, finishes, or merges a plan on the human's behalf. Specplane controls alert selection and deduplication through `execution.notify`; delivery belongs to the configured harness or user command. It never enables external notifications itself.

This describes intended conductor behavior. It does not authorize running the not-yet-implemented conductor or sending notifications now.

## 4. `claude:feature/claude-integration`, “Sessions in worktrees and the cloud”

Append:

> When Specplane selects the harness notification transport, the integration surfaces the alert in the relevant session. The user's existing Claude Code notification settings determine whether it is delivered beyond that session. Specplane must not enable, change, or bypass those settings. Configured unattended mode can make a detected attended session unattended, but cannot make a detected unattended session attended; approval and authorship restrictions remain in force.

## Assumptions needing confirmation

- **A1 — Event grouping:** the existing plan says “closed consideration kinds” but its default uses the umbrella `consideration`, while `plan next` currently exposes narrower attention kinds. The proposal uses a five-event notification selector with the listed subconditions grouped under `consideration`. Alternative: expose every attention kind in `notify.on` and change the default to enumerate them. No implementation choice has been applied.
- **A2 — Budget:** “default empty” in the plan has no concrete type. The proposal uses YAML `null`, rejects non-positive numbers, and requires an adapter to refuse a requested limit it cannot enforce. Alternative: omit the key when unset. No capability of the actual Claude CLI has yet been verified.
- **A3 — Invalid command transport:** selecting `command` without a command is proposed as a validation error, not silently doing nothing.

## Downstream approvals remain separate

This only addresses step 01 feature text. Later steps may need architecture drafts, ADR review, and additional feature amendments. A new Codex/Dot harness and the ai-workflow migration need their own bounded review where required. The configured `wait_for_merge` dependency policy must not be bypassed to work around the user's no-merge instruction.
