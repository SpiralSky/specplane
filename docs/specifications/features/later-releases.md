---
id: feature/later-releases
title: Later Releases
status: approved
approval:
  by:
    llm: claude-sonnet-5-5
    delegated-by: spiralsky
  date: 2026-11-09
  commit: 17593fb2d8b9e511414505bbc75c799d37eb5297
  note: re-approved by the LLM, not a human, under the user's 2026-11-09 delegation after the session 16 fixes (hand-edited; see docs/work-records/2026-11-09-spec-format.md)
  fingerprint: spec-v3:sha256:7a8daef4d21cf12f35d0a5de2f46540821b12c85a44b5546c4d5fb41f9ce33cd
  cited:
    R37: sec-v1:sha256:7eb2b096d3266c52e3c5b200046efd11dd70fac7ee9042c081d971c2eee4956a
    R37.1: sec-v1:sha256:ded3146384ebcb28de429cb55fba22bd7690806abe8e1ce83583682e9a03c8f2
    R39: sec-v1:sha256:a89ca79a1e729dac084029b774c71c9e3e54d12b0bf99839394182c27807afd9
    R39.1: sec-v1:sha256:2431690a7235645eb441e5575be0093bce45b90e3bd3331f7991c68affef605c
    R39.2: sec-v1:sha256:39b97d687490efa513c50246e352eebfe6d8ed85539764f15013293160bcda08
    R39.3: sec-v1:sha256:8fa60e43e8a85b597e62ee20202bba7f37aa078d6b7878d7cbeb907483476161
    R39.4: sec-v1:sha256:079af62927bbd3dade5a9b335eb41fee9cca6f29043cc00ed999e49dcbd78a54
    R66: sec-v1:sha256:5096aaea66887cd36536fffe4824778b40045d889af65e9b87b3aea138ae658c
    R14: sec-v1:sha256:8ccf7a4a5b9852e8022cdf66efe5439946d7ff481b893c86a45ba5cf333b4e2c
    R62.3: sec-v1:sha256:92c9b13c4f37b8fae856dfb136133ef8d03910e3f8745ef619f8da2c7c5c6607
    specifications R9: sec-v1:sha256:faa3544c96036f5eb5010877f99d4e5bd3e346628f86440922d0b919ba0203e7
    specifications R11: sec-v1:sha256:57fb631a35838abb06b893d183aae50c7cd3ab7d8e322aae1b81908c1be1f94e
    specifications R65: sec-v1:sha256:d62687005561171f9fa170d8e5a9505e8ec81875f07a1c9d7bc8ac3de001c9bf
    roles-and-permissions R50: sec-v1:sha256:6e06bc008e3c498900010a6e4117f60f0626279609ce22d6b0bcb36c4c245ce2
    roles-and-permissions R57: sec-v1:sha256:1b06f3e6eaf07d7054ecb2cfcd8fb151df181db7d98bba461eae8802dd944f38
    harness R14: sec-v1:sha256:c55f58fe1dea4db1a9b76c56fc683dad6c33fb43da8bca5e125c7a55e7ddd0ad
    configuration R25: sec-v1:sha256:e07f837db35bfe39bbd28e56e36f3bbb1d0afc25bc3b8784f90a92be6d49b071
    requests R52: sec-v1:sha256:4be72ae24a0b5e7c5b2eefb5802cfce58bb3673eef335e1e8496d43183631388
    steering R59: sec-v1:sha256:7078d03a4c2a8767271e37f7c1b6ed4551ee563aa732399d8e620e759d99deb4
    R68: sec-v1:sha256:e9eaf1d52d8d0cef132600b1477d50b693c999e94354ebe540005b2543cab444
    specifications R7: sec-v1:sha256:b97cf139a08f8de7a4af660c79a35472f627e128accb361ef4a5453ad230418e
authors:
  - llm: claude-sonnet-5-5
    contribution: drafted
references: [R14, R62.3, specifications R9, specifications R11, specifications R65, roles-and-permissions R50, roles-and-permissions R57, harness R14, configuration R25, requests R52, steering R59, R68, specifications R7]
covers: [R37, R37.1, R39, R39.1, R39.2, R39.3, R39.4, R66]
---

# Later Releases

This spec describes three features that are planned for releases after the first one (`docs/release-plan.md`): user decision records, subprojects and project migration. Nothing here is needed for the first release. The behaviour is described briefly so that earlier specs can point at it and so that the first release does not make it impossible.

## §1 Terms

- **Decision record:** a short record of a decision the user made in a discussion with the LLM, together with the context it was made in.
- **Subproject:** a part of a project with its own feature and architecture specifications, and optionally its own requirements specification. The project it lives in is the root project.
- **Root project:** the project that contains the subprojects.

## R37: User Decision Records

Later release. When the user discusses work with the LLM in the harness and makes a decision, the decision and its context can be stored as a decision record. The LLM retrieves records when it later faces a related choice, so that a settled question is not reopened without the user knowing.

- Decision records are on or off (setting `decisions.enabled`, `configuration R25`). When off, nothing is stored and nothing is retrieved, and the permissions below have no effect.
- A record holds what was decided, the context and reasons the user gave, the date, and any specification or plan it concerns. It records the user's decision, not the LLM's suggestion; a record is written only after the user has made the decision in the conversation.
- The LLM can search records and read them. A record is retrieved by its identifier or by a description of the topic, and the LLM tells the user when a record it found affects what it is about to do.
- A record can be corrected by editing it, or removed by deleting it. Editing and deleting are explicit actions, never a side effect of other work.
- A record is not a specification. It does not define behaviour, is not approved and is not checked by tests. Where a decision should bind the product, the user puts it in a specification.
- Records are part of the project and travel with it, so that every user and every LLM in the project sees the same decisions.
- Taking the old architecture decision records into this feature is optional: existing records of that kind can be kept as decision records, but Specplane no longer requires them.
- Assumption, awaiting the user's confirmation: the page describes only user decision records, so the older architecture decision records (numbering, supersession, their own validation and approval workflow) are not carried over as a separate feature. This answers conflict question 4 in `docs/work-records/2026-11-09-requirements-conflicts.md` provisionally.

Scenario: Given decision records are on, When the user decides in a discussion to keep push notifications off by default, Then the LLM stores a record with that decision and the reason, and a later session asked to enable them by default finds the record and asks the user before acting against it.

Scenario: Given decision records are off, When the user makes a decision, Then no record is stored and the LLM does not look for any.

### R37.1: User Decision Records Permissions

There are four permissions: add, retrieve, edit and delete decision records. Each has the modes allow, request user and deny (`roles-and-permissions R50`, `roles-and-permissions R57`).

- In the default presets, the LLM role may retrieve records and needs the user's agreement to add, edit or delete one (request user); the user may do all four (`roles-and-permissions R57`).
- With request user, the LLM sends a request showing the record as it would be stored, or the change to it, and nothing is stored until the user accepts (`requests R52`).
- With deny, the LLM does not store or change records and is told not to work around the limit. It can still make a suggestion in the conversation for the user to store.
- Retrieving with deny means the LLM is not shown any records and does not say whether any exist. Records are shown to it only when the user brings one into the conversation.
- Steering for each permission is part of its documentation (`steering R59`).

Test (deterministic): with decision records on and add set to deny for the LLM role, an attempt to add a record is refused and nothing is stored; with retrieve set to allow, searching returns the records that match.

## R39: Subprojects

Later release. A project can contain subprojects, for example folders that hold feature and architecture specifications. Requirements specifications can also live in a subproject. For example, an integration for one harness can have its own feature and architecture specifications while sharing the requirements of the root project, which then has no requirements of its own to write.

- Each subproject is a named location in the project, set in the `subprojects` setting (`configuration R25`). Specifications in it behave like any other specifications: types, layers, approval, metadata and checks all apply (`specifications R11`, `specifications R65`).
- A subproject may have no requirements specification of its own; it then relies on the root project's.
- Roots and subprojects are checked together: warnings, validation and coverage reports show which project each finding belongs to.
- Assumption, awaiting the user's confirmation: the page has no overlays, so overlay roots (a root that extends another) are not part of Specplane; a project that used them declares each overlay as a subproject (`R66`). This answers conflict question 5 in `docs/work-records/2026-11-09-requirements-conflicts.md` provisionally.

### R39.1: Subproject Decisions

When the LLM is allowed to design feature and architecture specifications and a requirements specification exists, it may propose subprojects where the work is separate from the rest, for example one subproject per harness integration.

- Creating a subproject is creating specifications, so it needs the permission to create those specification types (`roles-and-permissions R50`). If that permission is request user, the request describes the proposed subproject and what it will contain (`requests R52`).
- The LLM does not move or delete existing specifications to create a subproject unless it has the permissions to do so and the user has asked for it.
- If subprojects are not wanted, the user denies the permission or says so; the LLM does not create them uninvited.

### R39.2: Subproject References

Specifications in a subproject can reference requirement, feature and architecture specifications, in the subproject itself, in other subprojects and in the root project (`specifications R9`). Referencing a specification in the root project makes the subproject depend on it in the same way as any reference: if the referenced part changes, the referencing specification is outdated (`specifications R11`).

### R39.3: Subproject IDs

Requirement IDs must be unique within the root project and within each subproject. The same ID may appear in two different subprojects, because each is a separate numbering.

- A reference to something in another subproject, or in the root project, names the project as well as the cite, written `<project>:<cite>` where the cite is any citation shape (`specifications R7`). Examples are `claude:R7` for requirement R7 of the subproject `claude`, and `claude:harness R14` for a section of a feature specification in it. A reference without a project name means the project of the specification that makes the reference. The syntax is an assumption, because the page only says the project is named as well as the ID.
- The name `root` always means the root project and cannot be used as a subproject name. Specification IDs are unique within a project, so the project name tells apart two specifications with the same ID in different projects.
- A reference that names a project that does not exist, or an ID that does not exist in the named project, is reported by validation as an error.
- A subproject's name is unique in the root project and does not change once specifications reference it.

Scenario: Given the root project and the subproject `claude` both have a requirement R7, When a specification in `claude` cites R7, Then it means the subproject's R7, and the root project prefix followed by the number 7 means the root project's.

### R39.4: Subproject Precedence

The root project's requirements outrank a subproject's requirements. Within a subproject, layer precedence applies as in the rest of the project (`specifications R65`): requirements outrank feature specifications, which outrank architecture specifications.

- If a subproject requirement contradicts a root requirement, the root requirement wins and the contradiction is reported as a warning for the user to resolve; the LLM does not implement the subproject side.

## R66: Project Migration

Later release. A harness command guides the LLM through bringing an existing project into Specplane, including a project that uses an older Specplane format. Migration without an LLM is not a goal (`R62.3`).

- The LLM uses the project's existing specifications, documents and code as sources. It writes specifications for the project, each tracing to requirements where the project has requirements (`R68`), and shows the user what it found and what it proposes to write before it writes.
- The prompt the LLM receives is configurable like any other command instructions (`R14`, `harness R14`). The default prompt tells the LLM to prefer asking the user over guessing, and to leave out what it cannot find evidence for.
- The LLM follows the permissions of its role. Where it may not create a specification, it requests it or tells the user what to create (`roles-and-permissions R50`, `requests R52`).
- Every specification that results from migration starts as Awaiting Review, even if the source had been approved in an older format, because approval in the old format says nothing about the new content (`specifications R11`).
- Migration never deletes or rewrites the old files unless the user asks for it, and it can be stopped and resumed: a later run recognises what it has already written and carries on.
- At the end, the LLM lists what it migrated, what it left, and what it was unsure about, so the user can review it.
- The old architecture records, overlay roots and per-type LLM role settings of earlier versions are inputs to migration: records become decision records when those are on, overlays become subprojects (`R39`), and the old role settings are replaced by a permission preset the user chooses.

Scenario: Given a project with specifications in an older format, all approved, When the user runs the migration command, Then the LLM proposes the new specifications, writes them within its permissions, and all of them are Awaiting Review.

Test (intelligent): run the migration command in a project with previously approved specifications under a preset that lets the LLM create specifications; expect every new specification to be Awaiting Review and the old files unchanged.

## §2 Edge cases

- Turning decision records off keeps existing records but hides them from retrieval; turning them on again makes them available.
- A reference to a subproject in a project that has none is an error, not a request to create one.
- Renaming a subproject is a change to every reference to it; the references are outdated until updated.
- Running migration twice is safe: the second run only adds what is missing and never overwrites a specification the user has already reviewed.
