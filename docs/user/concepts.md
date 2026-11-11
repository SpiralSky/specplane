---
title: Concepts
summary: Requirements, feature and architecture specs, approval, evidence, plans and roles, and how they differ.
related: [getting-started, specification-format, verification, permissions]
---

# Concepts

Specplane tracks four things separately, because one does not prove the others.

- **Intended behaviour**: requirements (the product page), feature specs (what it does) and architecture specs (how it is built). Each layer cites the layer above.
- **Review**: a spec is `approved` or `awaiting-review`. Status is computed from the committed content and the approval records; it is never written in the file. Approval binds to a content fingerprint, so any change to the spec, or to a part it cites, returns it to review. The reason is one of `never-approved`, `edited`, `outdated: <cite>`, `unapproved-dependency: <cite>`.
- **Implementation**: an architecture spec is marked implemented when every check it declares passes on the commit it is recorded against. A later change of the spec makes the record stop applying.
- **Evidence**: test results are records bound to the content they ran against. A result for changed content is shown as outdated and counts for nothing.

## Roles and permissions

A person at the CLI is a Standard User or an Administrator. An agent in a harness is the LLM role. Each permission has a mode per role: `allow`, `request-user` or `deny` (see `permissions`). Approving a spec is its own permission, so writing a spec and approving it are different acts.

## Plans

A plan is an optional folder of steps on its own branch `plan/<id>` and worktree. Any other way to implement works too: branches have no prescribed role, and specs and implementation may change together or separately (see `plans`).

## Records are not proof

Declaring something implemented, or recording a passing test, is a declaration backed by fingerprints. Matching a fingerprint does not prove the code is correct; it shows what content the declaration was made against.
