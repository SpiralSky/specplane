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

## Decision records

When `decisions.enabled` is on, a decision you make in a discussion can be stored as a decision record, `.specplane/decisions/D<n>.md`: what was decided, the context and reasons you gave, the date and the specifications or plans it concerns. The LLM searches the records before a related choice and tells you when one applies, so a settled question is not reopened without you knowing. A record is not a specification: it defines no behaviour and no test checks it. It is approved by ID (`approve D1`) like a specification, and the LLM can only ask for that; an LLM-stored record is Awaiting Review until you do. Where a decision should bind the product, put it in a specification. The permissions are `decision.add`, `decision.retrieve`, `decision.edit` and `decision.delete`; by default the LLM may retrieve and must ask to add, edit or delete.

### Migrating an existing project

`/migrate` (Codex: the `migrate` contract) guides the LLM through bringing a project you already have into Specplane, including one written for an older Specplane. Name the folders, documents or code to read. The LLM shows what it found and what it proposes to write before it writes anything, prefers asking you over guessing, and leaves out what it finds no evidence for. It writes specifications only through its own `spec.create.requirement`, `spec.create.feature` and `spec.create.architecture` permissions: where one is `request user` you get requests, and where all are `deny` you get a proposal and a list of what to create. Every specification it writes is Awaiting Review, even if the source was approved before, because approval of the old text says nothing about the new. Old files are never deleted or rewritten unless you ask. Running it again only adds what is missing and never overwrites a specification already written. Old architecture records may become decision records and old overlay folders may become subprojects only if you accept the mapping; old per-type role settings are replaced by a permission preset you choose. The migration prompt can be replaced with `harness.instructions.migrate`. This is separate from `specplane migrate status`, which only moves older approval records into the notes store.


## Plans

A plan is an optional folder of steps on its own branch `plan/<id>` and worktree. Any other way to implement works too: branches have no prescribed role, and specs and implementation may change together or separately (see `plans`).

## Records are not proof

Declaring something implemented, or recording a passing test, is a declaration backed by fingerprints. Matching a fingerprint does not prove the code is correct; it shows what content the declaration was made against.
