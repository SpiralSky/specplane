# Session limit proposal (2026-11-06)

Status: proposal. Nothing here is approved. The code is on local branch `limits-seam-20261106`, not on `main`.

## Why

`--max-budget-usd` stops a `claude -p` run at Claude Code's own estimate of API list-price spend. On a subscription that figure is not a bill, and it does not track the 5-hour or weekly usage limits. Dollars were also built into the harness-neutral contract, although only the Claude adapter has a dollar flag and Codex has no background adapter.

## What changed in code

- `SessionRequest.budgetUsd` is now `limits?: SessionLimit[]`, with `SessionLimit = { kind: 'usd'; amount: number }`.
- `SessionCapabilities.budgetEnforcement` is now `limitKinds`, the kinds the adapter can enforce.
- The probe requirement `budget` is now `limit:<kind>`. The conductor refuses before launch when a requested kind is not declared.
- The Claude adapter maps `usd` to `--max-budget-usd` and refuses any other kind.

Unchanged: `execution.max_budget_usd`, `--max-budget-usd` on the conductor, `reservedBudgetUsd`, and the even split across attempts. No feature spec changes.

## Exact spec edits

`architecture/reference-cli`, Conductor section:

1. Replace `It rejects unsupported backend, lifecycle, or budget requirements.` with `It rejects unsupported backend, lifecycle, or limit requirements.`
2. Replace `mode: 'unattended', budgetUsd?, signal}` with `mode: 'unattended', limits?, signal}`.
3. After `It identifies an installed procedure, never an arbitrary prompt/command string.` add `Each entry of `limits` is `{kind, amount}`; the only kind in protocol 1 is `usd`, derived from the configured budget.`
4. Replace `launch/observe/resume/cancel capabilities, and budget enforcement capability;` with `launch/observe/resume/cancel capabilities, and `limitKinds`, the limit kinds it can enforce;`

`claude:architecture/claude-integration`:

5. Launch: replace `--max-budget-usd <budgetUsd>` with `--max-budget-usd <amount>`.
6. Launch: replace ``--max-budget-usd` is omitted only when the request has no `budgetUsd`.`` with ``--max-budget-usd` is passed only for a `usd` limit, and any other limit kind refuses.``
7. Probe: replace `` and `budgetEnforcement` true, only after`` with `` and `limitKinds` as `['usd']`, only after``, and replace `Otherwise the capability is false` with `Otherwise each capability is false and `limitKinds` is empty`.

Applying them also needs the packaged copy in `packages/cli/assets/docs/sources/` and its manifest digest refreshed, then a `specplane spec pin --check`.

## Adding a percentage limit later

Add `{ kind: 'usage_percent', window: 'five_hour' | 'seven_day', amount }` and a harness-scoped config key. That key is a feature spec change, so its text needs the user's approval. The conductor must pass this kind whole, because an account-wide threshold cannot be split across attempts.

Check these first; the docs do not settle them:

1. Whether `rate_limits.five_hour.used_percentage` and `rate_limits.seven_day.used_percentage` can be read during or around a `claude -p` run. They are documented only in status line JSON, for subscribers, after the first API response.
2. What `claude -p` reports when it hits a usage limit: exit code, result subtype, and whether it waits.

The percentage is account-wide, so other sessions count toward it. No host flag exists, so the adapter would enforce it by checking and cancelling, with some overshoot. API-key users have no percentage and keep `usd`. A Codex adapter would declare its own kinds.
