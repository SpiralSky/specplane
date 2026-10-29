---
id: feature/spec-policies
title: "Spec policies: authorship, ordering, and the architecture-leak guard"
status: approved
author: mixed
---

# Spec policies: authorship, ordering, and the architecture-leak guard

This spec defines the three policies that govern how specs are written and promoted. All policies have defaults that can be changed in config (see `feature/configuration`).

---

## 1. Authorship policy

The authorship policy controls who may write a spec and what role an LLM may play.

### Settings

| Config key | Applies to | Type | Default | Allowed values |
|---|---|---|---|---|
| `specs.feature.authorship` | Feature specs | enum | `user` | `user` \| `llm` \| `either` |
| `specs.feature.llm_role` | Feature specs | enum | `assist` | `review` \| `assist` \| `draft` \| `none` |
| `specs.architecture.authorship` | Architecture specs | enum | `either` | `user` \| `llm` \| `either` |
| `specs.architecture.llm_role` | Architecture specs | enum | `draft` | `review` \| `assist` \| `draft` \| `none` |

### Meaning of each value

**`authorship`**:
- `user`: the spec is expected to be written by a human. An LLM-written draft may not leave `draft` until a human takes over (a warning; see below).
- `llm`: the spec may be authored entirely by the LLM. The LLM sets `author: llm`.
- `either`: no authorship restriction. Both humans and LLMs may author.

**`llm_role`**:
- `review`: the LLM may ask clarifying questions, suggest edits, and flag issues, but must not write the spec body. It applies a suggested edit only after the user approves that exact change.
- `assist`: the LLM writes the spec body from the user's description, following the refine-then-write flow below. It must not write body text before the user has finalised the content, and must not add requirements the user did not agree to.
- `draft`: the LLM may produce an initial draft for human review. The `author` field is set to `llm` or `mixed` depending on subsequent human edits.
- `none`: the LLM must not edit, review, or suggest changes to the spec body. It may read it (for example, to implement it).

### Refine-then-write (`llm_role: assist`)

1. **Describe**: the user describes the feature in their own words. The LLM writes nothing to the spec yet.
2. **Refine**: the LLM and the user discuss the description to find issues: gaps, ambiguous rules, contradictions with other specs, missing edge cases and acceptance scenarios, and architecture leaks. The LLM raises each issue and suggests a resolution; the user decides. This repeats until no issues are open or the user chooses to stop.
3. **Finalise**: the LLM summarises the agreed content (rules, scenarios, the decision on each issue, and anything left open). The user confirms the summary is final.
4. **Write**: the LLM writes the spec body from the finalised content only and shows it to the user, marking any detail it had to fill in as an assumption to confirm. The file is written only after the user approves the text. The LLM sets `author: mixed` and does not change `status`.

Revising an existing spec follows the same flow: the user's requested change is the description, and Write produces the revised text.

### Interaction between `authorship` and `llm_role`

The `authorship` setting constrains who the final author is. The `llm_role` setting constrains what the LLM may do during the writing process. A spec with `authorship: user` and `llm_role: review` means: a human writes the spec and the LLM may help. With `llm_role: assist`, the human decides the content and the LLM writes the text, so `author: mixed` is consistent with `authorship: user`. A spec with `authorship: user` and `llm_role: none` means: the LLM is a read-only observer.

### The `author` frontmatter field

The `author` field records observed authorship, not policy:
- `user`: written entirely by a human.
- `llm`: written entirely by an LLM.
- `mixed`: written collaboratively or with significant contributions from both.

Validation checks that the `author` value is consistent with the authorship policy:

- `authorship: user` and `author: llm` on a spec with status `review` or `approved` → warning: a human must take over (and set `author: mixed` or `user`) before the spec leaves `draft`. An LLM-written `draft` is not flagged, because `llm_role: draft` explicitly permits it.
- `authorship: llm` and `author: user` → no finding (`llm` permits but does not require LLM authorship).

These are warnings, not errors, because the `author` field may be set incorrectly by tooling; a human reviewer is the final arbiter.

### Rationale

Feature specs describe intended product behaviour; they need to reflect human intent, not LLM inference. Architecture specs often require substantial technical exploration that the LLM can usefully drive. Separating the two policies acknowledges that different spec types have different trust requirements.

---

## 2. Ordering policy

The ordering policy controls when an architecture spec may be approved, relative to the feature specs it implements.

### Setting

| Config key | Type | Default | Allowed values |
|---|---|---|---|
| `specs.architecture.require_approved_features` | boolean | `true` | `true` \| `false` |

### Behaviour

When `require_approved_features: true`, an architecture spec may not transition to `approved` if any spec in its `implements` list has a status other than `approved`.

Validation checks the resulting state rather than the transition: an architecture spec with `status: approved` whose `implements` list contains a spec that is not `approved` is a blocking validation **error** listing each unapproved spec. Architecture specs in `draft` or `review` are never flagged, so architecture work may proceed in parallel with feature review. The same check also catches a feature spec that is moved back to `draft` after its architecture spec was approved.

When `require_approved_features: false`, the ordering constraint is removed. An architecture spec may be approved at any time.

### Rationale

Approving an architecture spec before its feature specs are agreed creates a risk of implementing the wrong behaviour. The default `true` enforces that intent is settled before structure is fixed. The override exists for teams that use architecture specs as part of their exploration process (write the architecture to clarify the feature) and accept the risk of revision.

---

## 3. Architecture-leak guard

The architecture-leak guard detects and prevents implementation details from appearing in feature specs.

### What counts as architecture

The following are architecture details and must not appear in feature specs:

- File paths, directory names, module names, class names, or function names.
- Technology names, library names, or language names.
- Data schemas (field names, types, storage formats).
- Algorithms, data structures, or processing pipelines.
- API endpoints, ports, or transport protocols beyond what is user-visible.
- Configuration keys of implementing systems (as opposed to Specplane config keys, which are part of the feature being specified).

### What does not count as architecture

The following are acceptable in feature specs:

- User-visible behaviour and outcomes.
- Acceptance scenarios with concrete inputs and outputs.
- Terms from a domain model that are user-visible (e.g. "a spec has an ID and a title").
- Names that form the user-visible interface of the system being specified: commands a user types, files a user must create or read, configuration keys a user sets. For a tool whose interface is a set of files (as Specplane's is), those file names and layouts are behaviour, not architecture.
- References to Specplane's own config keys and frontmatter fields, because they are part of the interface every Specplane project uses.
- High-level descriptions that inform behaviour without prescribing implementation.
- Illustrative examples inside fenced code blocks.

### Check method

The guard is applied in two stages:

**Heuristic checks** (fast, cheap, always run by validation):
- Pattern-match for common technology names, file paths and extensions (`.js`, `.py`, `.go`, etc.), code identifiers, and schema syntax (`type:`, `$ref:`, etc.).
- Fenced code blocks, Specplane's own config keys and frontmatter fields, and the project's `specs.feature.leak_guard_allow` terms are not flagged.
- Heuristics produce **warnings**, not hard failures. A false positive on a legitimate mention of a concept (e.g. discussing that the format supports YAML) should not block a spec.

**LLM review** (optional; enabled by `specs.llm_review`):
- Performed by an agent as part of the `validate` workflow integration (see `feature/agent-integration`), not by the CLI.
- The agent is asked: "Does this text describe how something is implemented (architecture) rather than what it does (behaviour)? List any suspect passages."
- The LLM review produces additional warnings.

The guard never hard-fails a spec on its own. A human reviewer decides whether a flagged passage is removed, rewritten, covered by `leak_guard_allow`, or justified with a per-spec override (see below).

### Per-spec override

A feature spec may override the guard by setting:

```yaml
allow_architecture: true
architecture_reason: "<non-empty explanation>"
```

The `architecture_reason` is recorded so that reviewers can later judge whether the override was warranted. The guard warnings are suppressed for that spec.

This exists for features where the implementation approach is genuinely part of the user-visible contract (for example, a feature that exposes an LLM workflow, where the choice of workflow is what users configure). The override should be challenged in review if the reason is not convincing.

### Configuration

| Config key | Type | Default | Meaning |
|---|---|---|---|
| `specs.feature.forbid_architecture` | boolean | `true` | Enable the guard for feature specs |
| `specs.feature.leak_guard_allow` | list of strings | `[]` | Project interface terms the heuristics must not flag |
| `specs.llm_review` | boolean | `false` | Add the agent-performed LLM review stage |

The guard applies only to feature specs; architecture specs exist to hold architecture detail, so there is no architecture-side setting.

---

## Acceptance scenarios

### Scenario 1: LLM attempts to draft a feature spec under `authorship: user`

Given `specs.feature.authorship: user` and `specs.feature.llm_role: review`,
When an LLM agent attempts to create a new feature spec file with content from scratch,
Then the agent must refuse to draft the spec body and instead offer to assist (ask questions, suggest structure, review drafts).

### Scenario 1a: Writing without a description under `llm_role: assist`

Given `specs.feature.llm_role: assist`,
When the user asks "Write the feature spec for search" without describing the feature,
Then the agent asks the user to describe it and writes nothing.

### Scenario 1b: Writing a finalised spec under `llm_role: assist`

Given `specs.feature.llm_role: assist`,
And the user has confirmed the Finalise summary and approved the written text,
When the agent writes the spec file,
Then the file has `author: mixed` and its `status` is unchanged.

### Scenario 2: LLM drafts an architecture spec

Given `specs.architecture.authorship: either` and `specs.architecture.llm_role: draft`,
When an LLM creates a new architecture spec with `author: llm`,
Then no authorship policy violation is reported.

### Scenario 3: Approving an architecture spec with an unapproved feature spec

Given `specs.architecture.require_approved_features: true`,
And `feature/search` has `status: draft`,
And `architecture/search` has `implements: [feature/search]`,
When a user sets `architecture/search` to `status: approved` and validation runs,
Then validation reports the error: "Cannot approve `architecture/search`: `feature/search` is `draft`, not `approved`."

### Scenario 4: Feature spec with a technology name (heuristic warning)

Given `specs.feature.forbid_architecture: true`,
And the body of `feature/search` contains the sentence "The search validator uses a JSON Schema library",
When the guard runs,
Then a warning is produced: "Possible architecture detail: 'JSON Schema library' in `feature/search`."
And the spec is not hard-failed; the human reviewer decides whether to remove it or add `allow_architecture: true`.

### Scenario 5: Feature spec with a justified architecture override

Given `feature/llm-workflow` has `allow_architecture: true` and a non-empty `architecture_reason`,
When the architecture-leak guard runs,
Then no warnings or errors are produced for that spec.

### Scenario 6: Feature spec with `allow_architecture: true` but empty reason

Given `allow_architecture: true` and `architecture_reason: ""`,
When validation runs,
Then a hard error is produced: "`architecture_reason` is required and must be non-empty when `allow_architecture: true`."

---

## Edge cases

- Approval is also blocked by a stale base pin (`based_on`); that rule is defined in `feature/spec-overlays#base-pins`, not here.

- The ordering policy only constrains approved architecture specs. Creating an architecture spec before its feature specs exist is allowed; the check fires only once it is `approved`.
- The heuristic guard does not scan `INFO.md` files; those are free-form documentation.
- The LLM-review stage of the guard is skipped when `specs.feature.llm_role: none` (reviewing is a form of suggesting changes, which that role forbids).
- If `forbid_architecture: false` and `allow_architecture: true` are both set, the `allow_architecture` field is redundant but not an error.
