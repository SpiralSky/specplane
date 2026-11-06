# Usage percent limit: spec proposal (2026-11-06)

Status: code is on local branch `usage-percent-limit-20261106`, gated and unusable until live checks pass. No spec, config key or packaged asset was edited. Every edit below needs the user to reopen and re-approve the named spec.

## What the code does now

- Core: `SessionLimit` gains `{ kind: 'usage_percent'; window: 'five_hour' | 'seven_day'; amount }`, with `0 < amount <= 100`. `SessionState` gains an optional `stop: 'limit'`, set with `state: 'failed'` when the adapter stopped the session because a requested limit was reached.
- Conductor: a programmatic `usageLimits` option (no CLI flag, no config key). Entries are validated, appended to `limits` after any `usd` entry, and passed whole to every session. They are never divided and never added to `reservedBudgetUsd`. The `limit:usage_percent` probe requirement and refusal come from the existing generic path. A session reported as `failed` with `stop: 'limit'` ends the run with exit code 4 (`action: limit`), starts no further session, and keeps the session record.
- Claude adapter: optional `readUsage(event)` dependency with no default, and optional `usagePercentSeen` on the probe evidence. `usage_percent` is declared only when both are present for the exact installed version. Undeclared, `buildArgv` and `launch` refuse it as before. No argv flag is added; enforcement is observation plus the existing cancel path.

Fail-closed choices in the adapter:

1. A reading counts only if it is a finite number in 0..100 for a window that has an active limit. A throwing reader, `undefined`, NaN, out of range and a wrong-window reading are all "no reading".
2. If a usage limit is active and the session ends in an otherwise successful way (exit 0, `result` success) without a usable reading for every limited window, the state is `unknown`, not `completed`. Other failures stay `failed`.
3. After a threshold crossing the state stays `running` until the cancelled process has actually exited, then becomes `failed` with `stop: 'limit'`. A later `result: success` cannot turn it into `completed`.
4. Existing precedence is kept: an unparseable stream is `unknown` even after a crossing.

## Exact spec edits

### `architecture/reference-cli`, Conductor section (reopen needed)

Before:

> Each entry of `limits` is `{kind, amount}`; the only kind in protocol 1 is `usd`, derived from the configured budget.

After:

> Each entry of `limits` is `{kind, amount}` or, for `usage_percent`, `{kind, window, amount}`. Protocol 1 has two kinds: `usd`, derived from the configured budget and divided across attempts, and `usage_percent`, an account-wide threshold with `window` of `five_hour` or `seven_day` and `amount` above 0 and at most 100, which is passed whole to every session and never divided or counted in the reserved budget.

Before:

> observation returns `state` (`running`, `completed`, `failed`, or `unknown`), the same identities, and an optional structured recording receipt.

After (add one sentence after it):

> A `failed` observation may carry `stop: 'limit'` when the adapter stopped the session because a requested limit was reached; the conductor reports that as a limit stop (exit code 4) and starts no further session.

### `claude:architecture/claude-integration`, Session adapter (reopen needed)

Launch, before:

> `--max-budget-usd` is passed only for a `usd` limit, and any other limit kind refuses.

After:

> `--max-budget-usd` is passed only for a `usd` limit. A `usage_percent` limit adds no argument: it is accepted only when the adapter declares it and is enforced by observation. Any other limit kind refuses.

Probe, before:

> `probe` reports `launch`, `observe`, `resume` and `cancel` true, and `limitKinds` as `['usd']`, only after a probe against the installed, named version has launched, observed, resumed and cancelled a throwaway session and seen a budget stop. Help text alone is insufficient. Otherwise each capability is false and `limitKinds` is empty and the conductor refuses before preparing a checkout.

After:

> `probe` reports `launch`, `observe`, `resume` and `cancel` true, and `limitKinds` as `['usd']`, only after a probe against the installed, named version has launched, observed, resumed and cancelled a throwaway session and seen a budget stop. `limitKinds` also includes `usage_percent` only when the extension supplies a usage reader and the same probe recorded a usable usage percentage in the session's stream. Help text alone is insufficient. Otherwise each capability is false and `limitKinds` is empty and the conductor refuses before preparing a checkout.

Observe, add after the paragraph beginning `Observation is fail-closed.`:

> With a `usage_percent` limit, the adapter reads usage from each stream event through the extension-supplied reader. When the reading for the limit's window reaches the threshold, it cancels the session through `cancel` and reports `failed` with `stop: 'limit'` once the process has exited. If the session would otherwise be `completed` but a limited window never produced a usable reading, the state is `unknown`.

### `feature/configuration` (suggestion only; the user finalises the exact text)

This is a feature spec, so the wording below is a starting point, not a proposed final edit. Suggested key, harness-neutral at the schema level and enforced only by adapters that declare it:

Before (the example block):

> `  max_budget_usd: null`

Suggested after:

> `  max_budget_usd: null`<br>
> `  usage_limits: []            # [{ window: five_hour | seven_day, percent: 1-100 }]; account-wide, never divided`

Before (the prose):

> `execution.max_budget_usd` is a positive finite number or null (default, no configured bound). The conductor reserves the bound in equal shares across its maximum session attempts. Unsupported budget enforcement is a refusal; reservations include uncertain launch attempts and are not a measurement of cost.

Suggested addition after it:

> `execution.usage_limits` is a list of `{window, percent}` entries, `window` being `five_hour` or `seven_day` and `percent` above 0 and at most 100. Each entry stops a session when account usage in that window reaches the percent. Unlike the budget it is not divided across attempts and is not part of the reserved budget. Usage is account-wide, so other sessions count toward it, and enforcement overshoots by up to one observation. An adapter that cannot enforce it causes a refusal. Subscribers only; API-key users have no percentage and keep `max_budget_usd`.

Open choices for the user: key name and placement (under `execution`, or per-harness such as `harness.claude.usage_limits`), whether a CLI flag is wanted, and whether exit code 4 is the right report for a usage stop.

## Live checks still required

The adapter ships no reader because none of these is known. One live probe on the installed Claude Code version must settle them before `usagePercentSeen` can be recorded as true:

1. Whether `claude -p --output-format stream-json` emits any usage percentage at all. The `rate_limit_event` seen in `harnesses/claude/host-evidence/2.1.317/d25-route-b-probe.txt` has unrecorded fields. The status line names `rate_limits.five_hour.used_percentage` and `rate_limits.seven_day.used_percentage` are documented for status line JSON only.
2. The exact event type and field paths, for both windows, and whether values are 0..100 percent or fractions.
3. How often the value updates during a run, which sets the overshoot, and whether it appears before the first API response.
4. Whether a value exists for API-key accounts (expected: none) and for both windows on subscriptions.
5. What `claude -p` does when it hits a real usage limit: exit code, result subtype, and whether it waits instead of exiting.
6. That killing the process on a threshold leaves a resumable session (`--resume`).
7. A deterministic-enough way to cross a low threshold in the probe, for example a limit set just above the current reading.

After that, add the real `readUsage` in the extension host binding, record `usagePercentSeen: true` in the evidence file for that version, and ask the user to reopen the specs above.
