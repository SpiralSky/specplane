---
id: feature/later-releases
title: Later Releases
authors:
  - llm: claude-sonnet-5-5
    contribution: drafted
references: [R14, R62.3, specifications R9, specifications R11, specifications R65, roles-and-permissions R50, roles-and-permissions R57, harness R14, configuration R25, requests R52, steering R59, R68, specifications R7]
covers: [R37, R37.1, R39, R39.1, R39.2, R39.3, R39.4, R66]
---

# Later Releases

This spec describes three features; decision records (`R37`) and subprojects (`R39`) are built, and project migration is planned for a release after the first one (`docs/release-plan.md`): user decision records, subprojects and project migration. The behaviour is described briefly so that earlier specs can point at it.

## §1 Terms

- **Decision record:** a short record of a decision the user made in a discussion with the LLM, together with the context it was made in.
- **Subproject:** a part of a project with its own feature and architecture specifications, and optionally its own requirements specification. The project it lives in is the root project.
- **Root project:** the project that contains the subprojects.

## R37: User Decision Records

When the user discusses work with the LLM in the harness and makes a decision, the decision and its context can be stored as a decision record. The LLM retrieves records when it later faces a related choice, so that a settled question is not reopened without the user knowing.

- Decision records are on or off (setting `decisions.enabled`, `configuration R25`). When off, nothing is stored and nothing is retrieved, and the permissions below have no effect.
- A record holds what was decided, the context and reasons the user gave, the date, and any specification or plan it concerns. It records the user's decision, not the LLM's suggestion; a record is written only after the user has made the decision in the conversation.
- The LLM can search records and read them. A record is retrieved by its identifier or by a description of the topic, and the LLM tells the user when a record it found affects what it is about to do.
- A record can be corrected by editing it, or removed by deleting it. Editing and deleting are explicit actions, never a side effect of other work.
- A record is not a specification. It does not define behaviour, is not checked by tests and is not part of coverage. Where a decision should bind the product, the user puts it in a specification. A record has an approval state of its own, by its ID (see below): a record the LLM stores is Awaiting Review until the user approves it, and the LLM still finds and shows it, with its state.
- Records are part of the project and travel with it, so that every user and every LLM in the project sees the same decisions. Each is a file `.specplane/decisions/D<n>.md` with the format of `§14` of `file-formats`.
- Approval is by ID (`approve D1`, `spec approve D1`, `decision approve D1`), of committed content, with the `spec.approve` permission of `roles-and-permissions R50`: the user approves, and the LLM can only send a request when its mode is request user. A change to a record's text, title, date or concerns returns it to Awaiting Review. Records and specifications are approved in separate commands.
- Commands: `decision add|list|show|edit|delete|approve` for people, the harness actions `decision.add`, `decision.retrieve`, `decision.edit` and `decision.delete`, and the harness command `/decision-new`, which writes a record from the user's description or from the decision the user has just stated, after searching the existing records for the topic. `decision list <topic>` and `decision.retrieve` rank records by how many words of the description they contain.
- During `spec-assist`, when records are enabled and the user states a decision, the LLM searches first and stores the decision, context and reasons the user gave through `decision.retrieve` and `decision.add`, subject to their permissions. It never records its own suggestion; with records disabled it neither searches nor stores.
- Validation checks every record's format (an error) and that each entry of `concerns` names an existing specification, plan or cite (a warning), only while records are on.
- Taking the old architecture decision records into this feature is optional: existing records of that kind can be kept as decision records, but Specplane no longer requires them.
- Product scope decision awaiting review: the first implementation uses one decision-record system to avoid duplicate review and approval workflows. A separate ADR lifecycle is deferred, not ruled out by its absence from requirements. Existing ADRs remain available as source records; retaining or replacing their lifecycle needs a decision based on user value and maintenance cost.

Scenario: Given decision records are on, When the user decides in a discussion to keep push notifications off by default, Then the LLM stores a record with that decision and the reason, and a later session asked to enable them by default finds the record and asks the user before acting against it.

Scenario: Given decision records are off, When the user makes a decision, Then no record is stored and the LLM does not look for any.

### R37.1: User Decision Records Permissions

There are four permissions: add, retrieve, edit and delete decision records. Each has the modes allow, request user and deny (`roles-and-permissions R50`, `roles-and-permissions R57`).

- In the default presets, the LLM role may retrieve records and needs the user's agreement to add, edit or delete one (request user); the user may do all four (`roles-and-permissions R57`).
- With request user, the LLM sends a request showing the record as it would be stored, or the change to it, and nothing is stored until the user accepts (`requests R52`).
- With deny, the LLM does not store or change records and is told not to work around the limit. It can still make a suggestion in the conversation for the user to store.
- Retrieving with deny means the LLM is not shown any records and does not say whether any exist. Records are shown to it only when the user brings one into the conversation.
- Steering for each permission is part of its documentation (`steering R59`).

Test T1 (deterministic): with decision records on and add set to deny for the LLM role, an attempt to add a record is refused and nothing is stored; with retrieve set to allow, searching returns the records that match.

## R39: Subprojects

A project can contain subprojects, for example folders that hold feature and architecture specifications. Requirements specifications can also live in a subproject. For example, an integration for one harness can have its own feature and architecture specifications while sharing the requirements of the root project, which then has no requirements of its own to write.

- Each subproject is a named location in the project, set in the `subprojects` setting (`configuration R25`) as a list of items with a `name` and a `path`. The folder at `path` has the same layout as the project's spec folders: `requirements/` (optional), `features/` and `architecture/`. A declared folder that does not exist, a repeated name, `root` or `file` as a name, and paths that contain each other are reported as errors. Specifications in it behave like any other specifications: types, layers, approval, metadata and checks all apply (`specifications R11`, `specifications R65`).
- A subproject may have no requirements specification of its own; it then relies on the root project's.
- Roots and subprojects are checked together: validation runs the requirement, format and cite checks inside each subproject and every finding names its project (a finding without a project is the root's). The validation summary counts errors and warnings per project. An unqualified cite resolves only within the citing subproject, even when it has no requirements of its own. A cite that resolves only in the root is an error naming the qualified form to use, written `root:<cite>`.
- Approval and review state, test and implementation records and coverage work for a subproject's specifications like any other. A subproject specification is named with its project, `<name>:feature/<slug>` (`<name>:R<n>` for a requirement in coverage); a specification of the root project keeps its plain ID. A specification that depends on one in another project is held back until that one is approved.
- Product scope decision awaiting review: overlay inheritance is deferred while the initial model uses explicit subprojects and references. Requirements do not prohibit overlays. A subproject is not automatically equivalent to an overlay: migration must preserve the intended behaviour and obtain the user's decision before replacing inheritance (`R66`).

### R39.1: Subproject Decisions

When the LLM is allowed to design feature and architecture specifications and a requirements specification exists, the drafting contracts consider and choose subprojects where needed to separate the work from the rest, for example one subproject per harness integration.

- The drafting contracts use a declared subproject or describe the needed declaration for the user; they do not bypass configuration permissions.
- Creating a subproject is creating specifications, so it needs the permission to create those specification types (`roles-and-permissions R50`). If that permission is request user, the request describes the proposed subproject and what it will contain (`requests R52`).
- The LLM does not move or delete existing specifications to create a subproject unless it has the permissions to do so and the user has asked for it.
- If subprojects are not wanted, the user denies the permission or says so; the LLM does not create them uninvited.

### R39.2: Subproject References

Specifications in a subproject can reference requirement, feature and architecture specifications, in the subproject itself, in other subprojects and in the root project (`specifications R9`). Referencing a specification in the root project makes the subproject depend on it in the same way as any reference: if the referenced part changes, the referencing specification is outdated (`specifications R11`).

### R39.3: Subproject IDs

Requirement IDs must be unique within the root project and within each subproject. The same ID may appear in two different subprojects, because each is a separate numbering.

- A reference to something in another subproject, or in the root project, names the project as well as the cite, written `<project>:<cite>` where the cite is any citation shape (`specifications R7`). For example, a cite of requirement R7 of the subproject `claude` is the project name, a colon and the requirement ID, and a cite of a section of the feature specification `harness` in it adds that cite after the colon in the same way. A reference without a project name means the project of the specification that makes the reference. The syntax is an assumption, because the page only says the project is named as well as the ID.
- The name `root` always means the root project and cannot be used as a subproject name. Specification IDs are unique within a project, so the project name tells apart two specifications with the same ID in different projects; outside commands run in the root they are written with the project name, a colon and then the ID.
- A reference that names a project that does not exist, or an ID that does not exist in the named project, is reported by validation as an error.
- A subproject's name is unique in the root project and does not change once specifications reference it.

Scenario: Given the root project and the subproject `claude` both have a requirement R7, When a specification in `claude` cites R7, Then it means the subproject's R7, and the root project prefix followed by the number 7 means the root project's.

### R39.4: Subproject Precedence

The root project's requirements outrank a subproject's requirements. Within a subproject, layer precedence applies as in the rest of the project (`specifications R65`): requirements outrank feature specifications, which outrank architecture specifications.

- If a subproject requirement contradicts a root requirement, the root requirement wins and the contradiction is reported as a warning for the user to resolve; the LLM does not implement the subproject side. Validation cannot judge meaning, so it reports the case it can see: a subproject requirement with the title of a root requirement but a different text. Other contradictions are found in review.

## R66: Project Migration

A harness command guides the LLM through bringing an existing project into Specplane, including a project that uses an older Specplane format. Migration without an LLM is not a goal (`R62.3`).

- The LLM uses the project's existing specifications, documents and code as sources. It writes specifications for the project, each tracing to requirements where the project has requirements (`R68`), and shows the user what it found and what it proposes to write before it writes.
- The prompt the LLM receives is configurable like any other command instructions (`R14`, `harness R14`). The default prompt tells the LLM to prefer asking the user over guessing, and to leave out what it cannot find evidence for.
- The LLM follows the permissions of its role. Where it may not create a specification, it requests it or tells the user what to create (`roles-and-permissions R50`, `requests R52`).
- Every specification that results from migration starts as Awaiting Review, even if the source had been approved in an older format, because approval in the old format says nothing about the new content (`specifications R11`).
- The command is `migrate` (`/migrate` in Claude Code); it is separate from `specplane migrate status`, which only moves approval records of an older frontmatter format into the notes store (reference-cli section 5.7). It reads the sources the user names, with the LLM role's `info.retrieve`, and writes through `spec.create.requirement`, `spec.create.feature` and `spec.create.architecture` under their modes (allow, request user, deny).
- Migration never deletes or rewrites the old files unless the user asks for it, and it can be stopped and resumed: a later run recognises what it has already written and carries on.
- At the end, the LLM lists what it migrated, what it left, and what it was unsure about, so the user can review it.
- The old architecture records, overlay roots and per-type LLM role settings of earlier versions are inputs to migration: records may become decision records when those are on and the user chooses; overlays may become subprojects (`R39`) only after their inheritance semantics are accounted for and the user accepts the mapping; the old role settings are replaced by a permission preset the user chooses. Unmapped records and overlays are retained and reported, not silently discarded.

Scenario: Given a project with specifications in an older format, all approved, When the user runs the migration command, Then the LLM proposes the new specifications, writes them within its permissions, and all of them are Awaiting Review.

Test T1 (intelligent): run the migration command in a project with previously approved specifications under a preset that lets the LLM create specifications; expect every new specification to be Awaiting Review and the old files unchanged.

## §2 Edge cases

- Turning decision records off keeps existing records but hides them from retrieval; turning them on again makes them available.
- A reference to a subproject in a project that has none is an error, not a request to create one.
- Renaming a subproject is a change to every reference to it; the references are outdated until updated.
- Running migration twice is safe: the second run only adds what is missing and never overwrites a specification the user has already reviewed.
