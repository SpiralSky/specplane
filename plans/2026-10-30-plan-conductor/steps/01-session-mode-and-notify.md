---
plan: 2026-10-30-plan-conductor
step: 1
title: "Session mode and notification policy in config"
status: pending
context:
  - spec: feature/spec-precedence#Precedence model
  - spec: feature/spec-precedence#Spec gaps record
  - spec: feature/configuration#Key reference
  - spec: feature/configuration#Full schema with defaults
  - spec: feature/agent-integration
  - spec: claude:feature/claude-integration#Sessions in worktrees and the cloud
  - file: packages/cli/src/config.ts
  - file: packages/cli/src/schemas.ts
  - file: harnesses/claude/specifications/architecture/claude-integration.md
---

## Goal

Make "unattended" a first-class, configurable input instead of a flag that only the harness knows
about, and separate *deciding to alert* (Specplane) from *delivering* it (the harness or the user's
own setup).

## Acceptance criteria

- [ ] `execution.session_mode: auto | unattended` (default `auto`) exists in the schema, the defaults,
      `feature/configuration` § Full schema and § Key reference, and is validated as an enum.
- [ ] Semantics are specified and tested: `auto` = the harness detection already defined by
      `claude:architecture/claude-integration` § Session mode; `unattended` forces unattended. There is
      **no** value that forces attended — a session with no human available must never wait.
- [ ] `feature/spec-precedence` gains one sentence naming config as an input to the decision, without
      restating the consequences (which stay in the existing rules).
- [ ] `execution.notify` exists with defaults: `{ on: [blocked, consideration, finish_ready, failed],
      transport: none, command: "", dedupe: true }`; `on` is a list of the closed consideration kinds
      plus `done` and `failed`; `transport` is `none | harness | command`.
- [ ] `transport: harness` means Specplane emits the alert and sends nothing itself: delivery is the
      harness's, governed by the notification settings the user configured there.
      `transport: command` means Specplane runs `command` once per new alert with
      `SPECPLANE_PLAN`, `SPECPLANE_KIND`, `SPECPLANE_DETAIL`, `SPECPLANE_COMMAND`,
      `SPECPLANE_SESSION`, `SPECPLANE_CHECKOUT` in the environment.
- [ ] `execution.max_parallel` (default 1) and `execution.max_budget_usd` (default empty) are added.
- [ ] `specplane validate`, `npm test`, and config-doc generation (`specplane generate`) are clean.

## Tasks

1. Add the keys to `feature/configuration` (schema block, defaults block, key reference entries with
   the alert-ingress/egress distinction spelled out) and to `src/schemas.ts` + `src/config.ts`
   defaults and validation.
2. Extend `feature/spec-precedence`'s decision inputs by one sentence; reference, do not duplicate,
   the existing attended/unattended behaviour table.
3. Add the conductor/consideration vocabulary to `feature/agent-integration`: what a consideration is,
   its closed kind set, and that the transport is not Specplane's business.
4. State the harness obligation in `claude:feature/claude-integration`: where alarms are surfaced, that
   the user's own notification configuration decides whether anything leaves the machine, and that
   Specplane must not enable notifications on the user's behalf.
5. Tests: enum validation, defaults, and a config-resolution test showing `unattended` overriding a
   detected attended session while `auto` does not.

## Guidance

- Do not add a `session_mode: attended` value to "fix" a headless run. Safety direction is always
  toward unattended.
- Notifications are user-owned: never install, enable, or bypass a harness notification channel, and
  never default to a transport that reaches the network.
- If naming `execution.notify` conflicts with an existing settings namespace, record a `gap` entry in
  `spec-gaps.md` and pick `execution.alerts.*` instead.
