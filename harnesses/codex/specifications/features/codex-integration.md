---
id: feature/codex-integration
title: Codex workflow integration
status: approved
author: mixed
extends: [feature/agent-integration, feature/plan-steps, feature/spec-policies, feature/spec-system]
based_on: { feature/agent-integration: "f2fe6d4", feature/plan-steps: "00332af", feature/spec-policies: "84f50b3", feature/spec-system: "ce32511" }
---

# Codex workflow integration

The Codex extension provides Specplane agent workflows inside supported Codex surfaces, including cloud environments where the required capabilities are available. Extension means the ecosystem's plugin, extension, or mod mechanism; it is not a claim that all surfaces support the same capabilities.

## Rules

- Bundle a compatible Specplane core and complete applicable shared workflow procedures. Preserve shared policy and explicit human decisions. Installing Codex support does not select a background runtime or affect a co-installed Claude extension.
- Support the existing Codex session executing an isolated step: synchronize the remote branch when applicable, resolve context, record structured gaps and context expansion, assess acceptance criteria, record the outcome, and publish when required by the shared workflow and current user instructions.
- Mechanical commands execute through verified native handlers without a model turn. Reasoning is explicitly delegated between deterministic preparation and validation. A skill-only delivery provides reasoning workflows but does not claim deterministic slash commands.
- Report unavailable command, session, budget, or interaction capabilities explicitly. Initially, background execution is unsupported; never substitute Claude or infer support from installed skills or CLI help. The standalone manual CLI remains available.
- Preserve each model that contributes to a spec, across model switches and later revisions. Unknown host/session/model identities remain unknown. Provenance never grants approval authority.
- Preserve user settings, credentials, permissions, user-owned instructions, and customized workflows. Explicit installation cannot write outside the repository through existing or dangling symlinks.

## Acceptance scenarios

- Installing Codex alongside Claude, in either order, leaves shared guidance neutral and each integration independently usable.
- A normal permitted step synchronizes, implements, verifies acceptance, records its gaps/outcome, and publishes when applicable. A draft experimental fixture is separate evidence, not a substitute for this scenario.
- A dangling skill symlink targeting a nonexistent outside file is refused without creating that file.
- Requesting unsupported background execution launches nothing. A missing native handler is not silently replaced with an agent prompt.
- Two models contributing in one session and a third in a later revision all remain visible in contribution history.

## Shared documentation and optional workflow guidance

Deliver the shared conceptual orientation and expose documentation through the compatible bundled core's `docs` operation. Native documentation entry points return the same versioned topics as that core's CLI; host invocation and live capability notices may supplement them. Preserve existing host command names on collision and provide discovery of the available entry point. No network service or source checkout is required.

Orient users and agents to optional plans, arbitrary Git branches, separate review/completion states, valid manual completion edits and fingerprint reassessment. Plan-only checkout and recording rules apply when that workflow is invoked. Shared docs never imply a host can execute an unsupported operation. Update managed guidance explicitly with the release's documentation and contract versions, preserving user-owned material.
