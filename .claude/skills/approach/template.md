# Optional decision record

Use only when a persistent decision record is useful and no existing format fits.
This is not a required framework, log schema or work-session protocol. Store it
in the project's established durable location or a user-designated store, never
in /tmp. Omit fields that do not help the decision.

```markdown
# <Decision or goal>

- Objective and constraints:
- Decision and next action:
- Default and strongest plausible alternative:
- Evidence: source, actual finding, date, conditions and limitations.
- Applicability: fit to this project and transfer assumptions.
- Remaining consequential uncertainty:
- Reconsider when:

## Meta-level contribution (if useful)

Question → external finding → method implication → project action.
State whether research changed the decision or resolved a consequential doubt.

## Project validation (only if justified)

Use relevant observations from normal work first. If a dedicated test is needed,
state the decision it resolves and why its full cost is worthwhile. Include a
prediction, threshold, deadline or baseline only where meaningful.

## Later evidence (when available)

Record the outcome and limitations. Distinguish successful execution, evidence
of improvement and evidence that improvement exceeds overhead. Unknown outcomes
remain unknown; a successful outcome alone does not prove the method caused it.
```

Existing approach logs can remain as historical evidence. Do not create empty
session rows, migrate their schema or run experiments merely to complete records.
