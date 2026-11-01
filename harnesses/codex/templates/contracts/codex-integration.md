---
id: architecture/codex-integration
title: "Codex and Dot CLI workflow integration"
status: draft
author: llm
implements: ["feature/agent-integration"]
---

# Codex and Dot CLI workflow integration

Experimental draft. The development branch is intentionally unmerged; no plan/specification is approved by this integration.

## Purpose

Expose the existing specification/planning CLI to Codex and Dot cloud sessions without copying Claude permissions, settings, hooks, or background flags. Preserve existing Claude support. The CLI remains the source of deterministic operations; the current agent performs implementation and tests in its authorized checkout.

## Components

`harness/codex.ts` registers an explicit `codex` harness. It writes `.agents/skills/specplane/SKILL.md` and supplies the managed AGENTS.md workflow line. The common initializer still resolves config and preserves text outside its managed block. `--harness none` bypasses all auto-detection and writes neutral scaffolding only, including in a repository with `.claude/`.

The Codex installer never writes `.codex/config.toml`, `.claude/settings.json`, credentials, MCP setup, or permission grants. Existing differing skills are preserved with a notice, not overwritten. Skill paths resolving outside the repository are refused. Templates are included in the npm package and normal builds.

## Workflow contract

1. Read current user instructions, AGENTS.md and configured source-of-truth paths. Check a verified local CLI before use.
2. Inspect specs, plans, status, and validation through the CLI. Use real source and tests; indexes are supporting evidence only.
3. Execute permitted work in isolated branches/worktrees. A user-authorized experimental development exception is recorded with its scope and exact base; it does not become a fabricated plan/spec approval or a permanent bypass setting.
4. When normal plan gates allow it, use start/next/step-done and preserve gaps and history. When the explicitly authorized experiment stays on a draft plan, document the manual experimental implementation/test procedure on its named development branch and leave the plan draft. Do not claim a `plan next` gate refusal is a successful conductor run.
5. Run relevant tests and validation, commit incrementally, and stop before final merge or plan finalization. Never change protected branches, permissions, secrets or deployment infrastructure as a side effect.

## Background-session limitation

The supported integration here is **CLI-driven workflow instructions**, not a native Dot MCP tool or a Codex background adapter. Local `codex-cli 0.166.0-alpha.1` help was inspected on 2026-11-01 and advertises exec/resume, but no model session was launched and no session-storage access was inferred. Codex installation and help output do not prove that a background lifecycle or monetary budget protocol is available.

`plan run --harness codex` explicitly refuses the unsupported background adapter. An installed Codex skill selects that refusal by default rather than silently launching Claude. `--harness claude` remains available only through its own runtime capability checks. No approval/sandbox bypass flag or user configuration override is introduced.

## Verification

Tests cover explicit initialization alongside existing Claude/Codex settings, neutral mode with `.claude/`, idempotency, preserved custom files, path containment, package template delivery, and unsupported background refusal. A representative temporary-repository test creates draft specifications/plan, creates an experimental worktree, implements and tests a tiny module, validates, and commits only there while asserting plan/spec content and the baseline checkout remain unchanged. This is a real CLI/git/test workflow with manual agent execution, not a live Codex model evaluation.
