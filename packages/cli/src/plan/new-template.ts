/** Plan ID pattern (`architecture/file-formats` §2.1). */
export const ID_RE_PLAN = /^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*[a-z0-9]$/;

/** PLAN.md body for a new plan (`architecture/file-formats` §2.2 sections). */
export function planBody(title: string): string {
  return `
# ${title}

## Goal

TODO: one paragraph.

## Scope

- TODO

## Non-goals

- TODO

## Specs implemented

| Spec | Coverage |
|------|----------|
| TODO | TODO |

## Acceptance criteria

- [ ] TODO

## Risks

1. TODO

## Steps

1. \`slug\`: TODO
`;
}
