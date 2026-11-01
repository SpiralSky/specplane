---
id: decision/0005
title: "CLI conductor with capability-checked harness adapters"
date: 2026-11-01
status: proposed
superseded_by: ""
related_specs: [architecture/reference-cli, feature/plan-execution]
---

# CLI conductor with capability-checked harness adapters

## Context

Repeated manual session startup is error-prone. The existing conductor plan requests serial steps, optional concurrent plans, restart protection, and human attention without automatic merges. This experimental implementation is authorized for development; this ADR remains proposed for human final review.

## Options considered

A. A loop per harness: quick initial implementation, but duplicates safety and status logic.

B. A CLI conductor with a capability-checked adapter: one testable gate and state machine across harnesses.

C. External orchestrator only: useful for external backends, but does not implement the worktree conductor.

## Decision

Experiment with option B. Resolve status from existing plan files and git, serialize each plan under a lock, and launch only in its exact plan branch. Never invoke approval, finish, merge, rebase, push, or cleanup. External backends remain responsible for their own sessions. Claude support fails closed unless local capabilities and observation schema match; no installed Claude version was available for live verification.

## Consequences

Fake adapters make all stop, retry, budget, and concurrency cases deterministic, but do not certify any real model integration. Live compatibility remains a separately reported prerequisite. Runtime locks and derived alert caches are stored under Git’s private common directory to avoid dirtying worktrees; a crashed lock-recovery guard requires manual inspection. A configured per-plan budget is reserved conservatively in equal per-session shares, not claimed as measured usage.
