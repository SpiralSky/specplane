---
id: feature/spec-overlays
title: "Overlay spec roots: namespacing, extension, and validation"
status: review
author: mixed
---

# Overlay spec roots: namespacing, extension, and validation

Overlay roots allow a project to have context-specific specs that apply only in one environment or integration context, without contaminating the base spec set.

---

## Motivation

Some features of a framework or system only apply in a specific context. For example:

- A web service may have extra specs for a mobile-app integration.
- This framework has extra features when used with Claude Code (slash commands, hooks, subagents) that do not apply to every user.

Placing these in the base root would pollute it with context-specific concerns. Overlay roots solve this by adding a second (or further) spec root that extends the base.

---

## Declaring an overlay root

Overlay roots are declared in `.specplane/config.yaml` under `spec_roots`. An overlay root has an optional `extends` key naming the root it overlays:

```yaml
spec_roots:
  - name: base
    path: docs/specifications
  - name: claude
    path: harnesses/claude/specifications
    extends: base
```

A root with no `extends` is a standalone root. A root with `extends` is an overlay.

---

## ID namespacing

Every spec has an ID of the form `<type>/<slug>`. Across multiple roots, IDs may collide. Specplane avoids collisions by namespacing IDs with the root name when the ID is referenced across roots.

### Qualified IDs

A **qualified ID** prefixes the root name: `<root>:<type>/<slug>`.

Examples:
- `base:feature/plan-system` — the `plan-system` feature spec in the `base` root.
- `claude:feature/claude-integration` — the `claude-integration` spec in the `claude` root.

### Unqualified ID resolution

An **unqualified ID** (no root prefix) is resolved as follows.

**From a spec** (the reference appears inside a spec file, including its `implements`, `supersedes`, and `extends` fields):

1. Look in the root containing the referring spec.
2. If not found, look in the root it extends, then the root that one extends, and so on along the chain.
3. If not found, report an error: "ID `<id>` not found in root `<root>` or its extends chain."

**Without a root context** (plans, step files, ADRs, and CLI arguments, which do not belong to any spec root):

1. Look in every declared root.
2. If exactly one root contains the ID, resolve to it.
3. If several roots contain it (possible only for sibling overlays that do not extend each other), report an error: "Ambiguous ID `<id>`: found in roots `<a>`, `<b>`. Use `<root>:<id>`."
4. If none contains it, report an error: "Spec `<id>` not found."

### No shadowing

A spec in an overlay root must not have the same ID as a spec anywhere in its root's extends chain (validation error: "`claude:feature/plan-execution` shadows `base:feature/plan-execution`; use a distinct slug with `extends`."). To add to a base spec, an overlay creates a spec with its own slug and an `extends` field. This keeps every unqualified ID unambiguous within a chain.

### Cross-root references in specs and plans

- A spec in an overlay root may reference base specs using an unqualified ID (it resolves via the `extends` chain) or a qualified ID.
- A plan may reference specs from any root using qualified or unqualified IDs.
- Tooling and skills must never hardcode spec paths; they must resolve IDs from config.

---

## Types of overlay specs

An overlay spec is either **new** or **extending**.

### New overlay specs

A new overlay spec has no `extends` field. It describes a feature or component that exists only in the overlay context.

```yaml
---
id: feature/claude-integration
title: Claude Code integration
status: review
author: mixed
---
```

This spec has no counterpart in the base root. It is valid only in the context where the `claude` root applies. A spec that builds on base specs should be an extending overlay instead, so that changes to those base specs are tracked (see "Base pins").

### Extending overlay specs

An extending overlay spec declares that it adds to a base spec:

```yaml
---
id: feature/claude/plan-execution
title: Plan execution — Claude Code extensions
status: review
author: mixed
extends: [base:feature/plan-execution, base:feature/plan-steps]
based_on: { base:feature/plan-execution: "0e7de32", base:feature/plan-steps: "c8cd747" }
---
```

The `extends` field names the spec or specs being extended: a single ID or a list (qualified or unqualified). The extending spec:

- **Adds** capabilities, scenarios, or rules beyond what the base spec defines.
- **Must not contradict** any claim in any spec it extends. Contradiction checks run once per extended spec.

A contradiction between an overlay spec and a spec it extends is a **defect**: the overlay must not be approved while a contradiction is known. Because contradictions in natural language cannot be detected reliably by automation, validation reports suspected contradictions as warnings and a human reviewer decides (see below).

---

## Base pins

An extending overlay is written against the base specs as they were when it was last reviewed. Base specs change; without a record of what the overlay was reviewed against, the overlay drifts silently. A **base pin** records it.

### The `based_on` field

`based_on` is an optional frontmatter field on any spec: a map from a referenced spec ID to the git blob hash of that spec's file at the time the referencing spec was last reviewed against it.

```yaml
based_on: { feature/agent-integration: "3f2a9c1", feature/plan-steps: "81bd0e4" }
```

1. Keys must be IDs listed in the spec's `extends` or `implements`. Keys and list entries are compared after resolution, so a qualified key (`base:feature/x`) matches an unqualified entry that resolves to the same spec, and vice versa.
2. A value is an abbreviated git blob hash of at least 7 hex characters, written as a quoted string (an unquoted all-digit hash would parse as a number): the output of `git rev-parse HEAD:<path>` for the committed file.
3. The pin is content-addressed, so it survives rebases and squash merges, and `git diff <pin> <current>` shows exactly what changed in the base spec since review.

### Stale pins

A pin is **stale** when the referenced file's current committed blob differs from the pin.

1. `validate` reports the warning `base-changed`: "`claude:feature/claude-integration` was reviewed against an older `feature/agent-integration`; review `git diff 3f2a9c1 <new>` then run `specplane spec pin claude:feature/claude-integration`."
2. A change to the referenced spec that touches only its frontmatter `status` or `author` is ignored: no warning.
3. If the pinned blob is not in the local object store (for example, a shallow clone), the warning still fires on a hash mismatch, but says the diff is unavailable.
4. A spec with a stale pin cannot be set `approved` (validation error), the same as a known contradiction: the base change must be reviewed first.

### Commands and configuration

| Command | Behaviour |
|---------|-----------|
| `specplane spec pin <id> [<ref-id>...]` | Writes or refreshes pins to the current committed blobs of the named references (all of the spec's `extends` and `implements` when none are named). Refuses for a referenced file with uncommitted changes. |
| `specplane spec pin --check` | Lists stale pins. Exit code 1 if any. |

Pins are optional. Config `specs.pin_bases` sets the policy:

| Value | Behaviour |
|-------|-----------|
| `off` | Missing pins are not reported. Stale pins are still reported and still block approval. |
| `warn` (default) | An overlay spec with `extends` but no pin gets a warning. |
| `require` | A missing pin is an error, for both `extends` and `implements`. |

Pinning records that a human reviewed the base change; running `specplane spec pin` is how the reviewer says so.

### Section references

A spec may reference a section of another spec as `<id>#<heading-slug>`, where the slug is the GitHub-style slug of the heading text (for example `feature/spec-policies#meaning-of-each-value`). `validate` warns when the slug matches no heading in the referenced spec, which catches renamed sections. The prose form `<id> § <Heading>` remains allowed but is not checked; the anchor form is recommended.

---

## Validation rules for overlays

| Rule | Severity | Description |
|------|----------|-------------|
| `extends` (spec field) is only allowed in an overlay root | Error | A spec in a standalone root has nothing to extend. |
| `extends` must reference a spec in the root's extends chain | Error | The referenced spec must exist in a root the overlay extends (qualified or unqualified). |
| An overlay spec must not shadow a spec in its extends chain | Error | See "No shadowing". |
| Root `extends` must name a declared root and must not form a cycle | Error | See `feature/configuration`. |
| Extending spec must not contradict any spec it extends | Warning (suspected) | Detected by heuristics and optional LLM review, per extended spec; a human confirms. |
| `based_on` keys must be IDs in the spec's `extends` or `implements` | Error | See "Base pins". |
| Pin differs from the referenced file's current blob | Warning (`base-changed`) | Ignored when only `status`/`author` changed. |
| Spec with a stale pin set to `approved` | Error | Review the base change and re-pin first. |
| Missing pin | Off / warning / error | Per `specs.pin_bases`. |
| `<id>#<slug>` matches no heading in the referenced spec | Warning | `<id> § <Heading>` is not checked. |
| No tool, skill, or agent instruction may hardcode spec paths | Design rule | Paths are always resolved from config. This is enforced by convention and code review, not automated checks. |

### Contradiction detection

Detecting a contradiction between an extending spec and its base is non-trivial for natural language content. The validation approach:

1. **Structural heuristics** (run by validation): look for explicit negations ("must not", "never") in the overlay spec that apply to something permitted by the base spec, and vice versa.
2. **LLM review** (when `specs.llm_review: true`): an agent running the `validate` workflow integration asks whether the overlay spec adds to or contradicts the base spec.
3. Both stages produce warnings; a human reviewer makes the final call.

---

## Acceptance scenarios

### Scenario 1: Qualified ID resolution

Given the `claude` root extends the `base` root,
And `base` contains `feature/plan-execution`,
When a spec in the `claude` root references `base:feature/plan-execution`,
Then the spec is found in the `base` root.

### Scenario 2: Unqualified ID resolution via extends chain

Given the `claude` root extends `base`,
And a spec in `claude` references `feature/plan-execution` (unqualified),
When the resolver looks up the ID,
Then it first checks the `claude` root, does not find it, then checks `base`, finds it, and returns `base:feature/plan-execution`.

### Scenario 3: New overlay spec

Given a new spec at `harnesses/claude/specifications/features/claude-integration.md` with no `extends` field,
When validation runs,
Then it is treated as a new overlay spec specific to the `claude` root, and no base spec is required.

### Scenario 4: Extending overlay spec that contradicts its base

Given `base:feature/plan-execution` says "Plans run on a single branch",
And an overlay spec extends it and says "Plans may run on multiple branches simultaneously",
When validation runs,
Then a suspected contradiction warning is reported: "`claude:feature/claude/plan-execution` may contradict `base:feature/plan-execution`: conflicting statements about branch count."
And the overlay spec is not approved until a human resolves it.

### Scenario 5: Hardcoded path rejected

Given a skill contains a hardcoded path `docs/specifications/features/`,
When the skill is run in a project where `spec_roots[0].path: specifications/`,
Then the skill fails to find the spec root.
And this is a design violation; all skills must resolve roots from config.

### Scenario 6: Plan references spec from overlay root

Given a plan has `specs: [claude:feature/claude-integration, feature/plan-system]`,
When the plan is displayed or validated,
Then `claude:feature/claude-integration` resolves to the `claude` root, and `feature/plan-system` (unqualified, no root context) is found only in `base` and resolves there.

---

### Scenario 7: Stale pin warning

Given `claude:feature/claude-integration` has `based_on: { feature/agent-integration: "3f2a9c1" }`,
And `feature/agent-integration` has since been committed with different body text,
When validation runs,
Then it reports the warning `base-changed`: "`claude:feature/claude-integration` was reviewed against an older `feature/agent-integration`; review `git diff 3f2a9c1 <new>` then run `specplane spec pin claude:feature/claude-integration`."

### Scenario 8: Status-only base change is ignored

Given a pinned spec whose referenced spec's only committed change is `status: review` to `status: approved`,
When validation runs,
Then no `base-changed` warning is reported.

### Scenario 9: Approval blocked by a stale pin

Given `claude:feature/claude-integration` has a stale pin,
When a user sets it to `status: approved` and validation runs,
Then validation reports an error: the base change in `feature/agent-integration` must be reviewed and the spec re-pinned first.
And after `specplane spec pin claude:feature/claude-integration` the error no longer appears.

### Scenario 10: Extending several specs

Given an overlay spec has `extends: [feature/agent-integration, feature/plan-steps]`,
When validation runs,
Then both IDs are resolved via the extends chain,
And contradiction warnings are evaluated against each extended spec separately.

### Scenario 11: Renamed section anchor

Given a spec references `feature/spec-policies#meaning-of-each-value`,
And that heading has been renamed,
When validation runs,
Then a warning is reported that the anchor matches no heading in `feature/spec-policies`.

### Scenario 12: Shallow clone

Given a shallow clone in which a pinned blob is not available locally,
And the referenced spec's current blob differs from the pin,
When validation runs,
Then the `base-changed` warning is still reported, and states that the diff is unavailable.

### Scenario 13: Refusing to pin uncommitted base changes

Given `feature/agent-integration` has uncommitted changes,
When the user runs `specplane spec pin claude:feature/claude-integration`,
Then the command refuses and names the file with uncommitted changes.

---

## Edge cases

- A spec file moved to another root keeps its ID only if the path-derived ID is unchanged; renaming creates a new ID (`feature/spec-system` § Spec IDs), so the referencing spec must update its `extends`/`implements` entry and re-pin. Until then the pin is reported as unresolvable (warning).

- A root may extend a root that is itself an overlay (chaining). Resolution traverses the full chain in order.
- A root may not extend itself or create a cycle in the extends chain (validation error).
- A standalone root (no `extends`) does not inherit any specs from other roots; all its specs must be fully self-contained.
- Two overlay roots may extend the same base root independently. They do not interact with each other. Because they are not in each other's chain, they may both contain the same ID; references from outside either root must then be qualified.
