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

This spec has no counterpart in the base root. It is valid only in the context where the `claude` root applies.

### Extending overlay specs

An extending overlay spec declares that it adds to a base spec:

```yaml
---
id: feature/claude/plan-execution
title: Plan execution — Claude Code extensions
status: review
author: mixed
extends: base:feature/plan-execution
---
```

The `extends` field names the spec being extended (qualified or unqualified). The extending spec:

- **Adds** capabilities, scenarios, or rules beyond what the base spec defines.
- **Must not contradict** any claim in the base spec.

A contradiction between an overlay spec and the spec it extends is a **defect**: the overlay must not be approved while a contradiction is known. Because contradictions in natural language cannot be detected reliably by automation, validation reports suspected contradictions as warnings and a human reviewer decides (see below).

---

## Validation rules for overlays

| Rule | Severity | Description |
|------|----------|-------------|
| `extends` (spec field) is only allowed in an overlay root | Error | A spec in a standalone root has nothing to extend. |
| `extends` must reference a spec in the root's extends chain | Error | The referenced spec must exist in a root the overlay extends (qualified or unqualified). |
| An overlay spec must not shadow a spec in its extends chain | Error | See "No shadowing". |
| Root `extends` must name a declared root and must not form a cycle | Error | See `feature/configuration`. |
| Extending spec must not contradict its base spec | Warning (suspected) | Detected by heuristics and optional LLM review; a human confirms. |
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

## Edge cases

- A root may extend a root that is itself an overlay (chaining). Resolution traverses the full chain in order.
- A root may not extend itself or create a cycle in the extends chain (validation error).
- A standalone root (no `extends`) does not inherit any specs from other roots; all its specs must be fully self-contained.
- Two overlay roots may extend the same base root independently. They do not interact with each other. Because they are not in each other's chain, they may both contain the same ID; references from outside either root must then be qualified.
