---
id: architecture/codex-integration
title: Codex extension implementation
status: draft
author: mixed
implements: [codex:feature/codex-integration, feature/agent-integration]
extends: [architecture/agent-skills]
---

# Codex extension implementation

This Codex overlay packages the shared workflow contracts and core for execution inside the host. It replaces the former base-root Codex contract; references use `codex:architecture/codex-integration`. It is a target contract, not certification that native command or session APIs are implemented.

## Package and compatibility

`harnesses/codex/` contains the ecosystem manifest, bundled compatible core, workflow assets, shared/harness contract snapshots, and tests. The `codex` spec root extends `base`. An explicit `init --harness codex` installs or refreshes only this integration; plain init and `--harness none` write neutral scaffolding. The shared AGENTS.md block is always neutral. The extension identifies its host directly; no provider registration or default runtime exists.

Initially `.agents/skills/specplane/SKILL.md` supplies the existing-session reasoning workflow. Package the complete applicable procedures, including `architecture/agent-skills#plan-step`, and declare separate pins for shared and Codex contracts. Consumer installations need not contain Specplane's source specifications. Local contracts take precedence over scoped bundled snapshots, and ambiguous resolution is refused. A snapshot pin validates integrity, not behavioral conformance.

Use each target surface's verified command/tool/hook APIs. Native deterministic slash dispatch is enabled only after its complete path is verified, including result display without a model call. Otherwise report it unavailable and expose reasoning skills plus manual CLI instructions. Lifecycle hooks alone are not proof of native command dispatch. Built-in session commands remain untouched. Hook scripts must exist in the execution environment and use the host's normal trust flow; installing a package never changes sandbox or approval policy.

## Installation containment

Preserve customized skills with an actionable notice. Never write Codex configuration, Claude settings, credentials, or persistent permissions as a side effect. Inspect each existing path component with `lstat`, including dangling final links; refuse symlinked installation paths before creating directories or writing files. Validate package destinations and common initializer outputs separately. This requirement is not satisfied by `existsSync` followed by `realpath` on existing targets only.

## Workflow contract

1. Read current user instructions and configured paths. Verify the bundled core's version and contract compatibility before mutation.
2. Use the complete shared `plan-step` procedure: synchronize an existing remote plan branch and refuse divergence; resolve the earliest unfinished step; read named context and HANDOFF; record context expansion and numbered gaps with required fields.
3. Delegate implementation and acceptance reasoning to the existing Codex session in the authorized isolated checkout. Validate structured outcomes and repository evidence before recording the permitted step through the core. Inspect staging before committing. Publish the plan branch when the shared procedure requires it, respecting explicit user constraints.
4. Record runtime-reported model identity at contribution time. Model A and B in one session are separate contributors; later model C adds a third rather than replacing either. Do not fabricate native session IDs or infer a model from the product label.
5. Human approval and finish/merge remain explicit user actions; unattended orchestration never performs them. A user-authorized experimental exception is recorded with scope and base, without changing global policy or inventing approval.

## Background-session limitation

There is initially no supported background Codex adapter. Refuse automation before plan preparation rather than using Claude flags or silently substituting hosts. Future background support must supply the shared adapter explicitly and verify launch, observation, resume, identity mapping, recovery instructions, and requested budget enforcement against named runtime versions. Executable presence or help text alone is insufficient.

## Verification

Test explicit/neutral initialization, coexistence and repeated initialization in both orders, customized files, dangling file links and escaping directory links, packaged core/procedures, and refusal without side effects. Test a normal permitted step against a temporary remote, including synchronization, acceptance checks, outcome recording, and publication. Keep experimental draft-worktree fixtures separately labeled.

Remove inherited `NODE_TEST_CONTEXT` from nested Node test environments, assert expected tests actually ran, and confirm a deliberately broken implementation fails the outer fixture. Fake adapters do not certify native command or live model compatibility. Verification records must state which tests executed and which host capabilities remain unverified.
