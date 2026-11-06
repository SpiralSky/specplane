---
id: decision/0005
title: "Shared conductor with extension-owned harness adapters"
date: 2026-11-01
status: accepted
superseded_by: ""
related_specs: [architecture/reference-cli, feature/plan-execution]
---

# Shared conductor with extension-owned harness adapters

## Context

Repeated manual session startup is error-prone. The existing conductor plan requests serial steps, optional concurrent plans, restart protection, and human attention without automatic merges. This experimental implementation is authorized for development; this ADR remains proposed for human final review.

## Options considered

A. A loop per harness: quick initial implementation, but duplicates safety and status logic.

B. A CLI conductor with a capability-checked adapter: one testable gate and state machine across harnesses.

D. A shared core/conductor bundled in harness extensions: one gate/state machine, adapters supplied by the host extension, and a standalone manual CLI without runtime selection or provider discovery.

C. External orchestrator only: useful for external backends, but does not implement the worktree conductor.

## Decision

Use option D as the target architecture. An extension is any plugin, extension, or mod providing workflows inside a harness. It bundles a compatible core and supplies its adapter directly. Standalone Specplane supports the full manual lifecycle, including explicit approvals, and never chooses or launches a runtime. There is no provider registration protocol. An entry point offering multiple hosts requires explicit selection; a single-host extension already supplies the host.

Use Claude's plugin/mod native command API for deterministic slash dispatch, with skills only for reasoning phases and hooks for policy. Codex native command support remains capability-dependent and background execution remains unavailable until verified. Resolve status from plan files and git, serialize each plan under a lock, and launch only in its exact plan branch. The unattended conductor never invokes approval, finish, merge, rebase, push, or cleanup; the step procedure can publish where its shared contract requires it. External backends own their sessions. This ADR remains proposed; these edits do not record acceptance.

## Consequences

Fake adapters make all stop, retry, budget, and concurrency cases deterministic, but do not certify any real model integration. Live compatibility remains a separately reported prerequisite. Runtime locks and derived alert caches are stored under Git’s private common directory to avoid dirtying worktrees; a crashed lock-recovery guard requires manual inspection. A configured per-plan budget is reserved conservatively in equal per-session shares, not claimed as measured usage.
