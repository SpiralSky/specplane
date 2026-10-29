---
id: decision/0001
title: Build Specplane from scratch rather than fork an existing tool
date: 2026-10-28
status: accepted
superseded_by: ""
related_specs: [feature/spec-system, feature/configuration, feature/spec-overlays]
---

# Build Specplane from scratch rather than fork an existing tool

## Context

Several open-source projects exist in the spec-and-plan-for-AI-development space. Before starting Specplane, we evaluated whether any of them could serve as the foundation.

The tools evaluated (all MIT-licensed):

- **OpenSpec** (Fission-AI): a spec-based change-proposal system that dogfoods itself and supports spec deltas. Strong on traceability.
- **GitHub Spec Kit**: a linear Spec → Plan → Tasks → Implement flow, tightly coupled to GitHub issues.
- **Backlog.md**: markdown-native task tracking in git, with cross-branch task state reading and an MCP server.

## Options considered

### Fork OpenSpec

**Pros**: mature spec format, dogfood discipline established, community.  
**Cons**: its data model centres on "change proposals with spec deltas", not on a two-tier spec hierarchy (feature vs. architecture). Adapting it would mean replacing most of its core concepts, leaving only the markdown convention and dogfood practice.

### Fork GitHub Spec Kit

**Pros**: the Spec → Plan → Task flow is close to what Specplane wants.  
**Cons**: tightly coupled to GitHub Issues for task tracking; Specplane's core principle is that markdown is the only source of truth. Decoupling from GitHub Issues would require rewriting the task layer.

### Fork Backlog.md

**Pros**: cross-branch markdown state reading is directly relevant to plan status. MCP integration is a plus.  
**Cons**: Backlog.md is a task tracker; Specplane is a spec manager with plans as a secondary concern. The data models are different enough that forking would be more confusing than starting fresh.

### Build from scratch

**Pros**: design the data model to match Specplane's specific requirements (two-tier specs, overlay roots, per-step context economy, architecture-leak guard, configurable policies). Deliver the format specification as the primary artifact, not the CLI.  
**Cons**: no existing community or tooling to build on; more initial work.

## Decision

Build Specplane from scratch. The core deliverable is a format specification (this spec set), not a CLI. A reference CLI is one implementation of it.

## Consequences

- The spec set must be thorough enough that an independent implementer could build a compatible CLI.
- We can take ideas from the projects above (e.g. Backlog.md's cross-branch state reading) as inspiration without being constrained by their architectures.
- We accept the cost of building without an existing community. The dogfood discipline (this repo uses Specplane to track its own work) compensates by keeping the spec grounded.
- Future work: if any of the evaluated tools adds features that would benefit Specplane, compatibility bridges (MCP, import/export) are possible without a fork dependency.
