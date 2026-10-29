---
plan: 2026-10-29-cli-spec-search
step: 4
title: Leak-guard heuristics and deprecated-reference warnings
status: pending
context:
  - spec: architecture/reference-cli#Architecture-leak guard (`spec/leak-guard.ts`)
  - spec: architecture/reference-cli#Spec validation (`spec/validate.ts`)
  - spec: architecture/file-formats#1.5 Pin, anchor, and skill-contract findings
  - spec: feature/spec-policies
  - spec: feature/spec-system
  - file: packages/cli/src/spec/leak-guard.ts
  - file: packages/cli/src/spec/validate.ts
---

## Goal

Add the leak-guard additions and the deprecated-reference warnings from step 01 to `validate`.

## Acceptance criteria

- [ ] A feature spec mentioning "JSON Schema" gets a `tech_name` warning; one mentioning `JSON Schema` only inside a code fence or `leak_guard_allow` gets none.
- [ ] A bare filename with a code extension (`foo.ts`, `config.yaml`) outside code fences and the allow-list produces a `path` warning; ordinary prose such as "e.g." or "Node.js" in the allow-list does not.
- [ ] `implements` or `extends` pointing at a spec whose status is `deprecated` produces a warning with the finding-message format in `architecture/file-formats` §1.5.
- [ ] Warnings never change the exit code.
- [ ] `specplane validate` on this repository exits 0; the number of new warnings is recorded in HANDOFF.

## Tasks

1. Extend the tech-name list and add the bare-extension rule with exclusions (URLs, link targets, allow-list).
2. Add the deprecated-reference check next to the other `implements`/`extends` checks.
3. Unit tests for each new heuristic and each exclusion.
4. Run validate on the repo; if the new warnings are noisy on first-party specs, tune the exclusions, not the specs.

## Guidance

- Preprocess exactly as the existing heuristics do (code blocks, link targets).
- Do not edit feature specs to silence warnings; list noisy hits in HANDOFF as feature-spec proposals for the user.
