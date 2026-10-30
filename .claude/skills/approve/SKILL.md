---
name: approve
description: Approve specs, plans, or decision records by ID, or reopen an approved spec. Use when the user runs /approve.
argument-hint: "<id>... [--reopen]"
disable-model-invocation: true
---
<!-- specplane-contract: architecture/agent-skills#approve@396f26e -->

# approve

Approves specs, plans, and decision records, and reopens approved specs, on the user's request (the `approve` workflow integration). Approval is the human's decision: the agent never runs this on its own initiative and never changes a `status` field by editing a file.

## Preconditions

1. **Specplane configured**: if `.specplane/config.yaml` does not exist at the repository root (an `AGENTS.md` alone does not count), say "This repository is not set up for Specplane. Run `specplane init --harness claude`." and stop.
2. **CLI availability**: run `command -v specplane`. If present, use the CLI for resolution, validation, and plan flows. If absent, follow the same rules by hand from the format and flow specs (`architecture/agent-skills` § Config resolution in skills) and say once that the CLI was not found. For `/validate` without the CLI, check frontmatter and IDs by hand against `architecture/file-formats` and label the result "manual check". `/plan-finish` without the CLI stops and tells the user to install it.

Resolve every spec, plan, and ADR path from config (`.specplane/config.yaml`), never from hardcoded paths.

## Policy check

No spec body is edited: approval changes only the `status:` line, through the CLI.

- If the CLI is unavailable: stop and tell the user to install it; this integration is not reimplemented by hand.
- Only when the user asks: never approve or accept during other work.

## Steps

`$ARGUMENTS` is `<id>... [--reopen]`: `--reopen` marks reopen mode; every other token is an ID, in the user's order.

1. Parse `$ARGUMENTS` in the user's order.
2. Resolve each ID's kind: a spec (through `spec/resolve.ts`), a plan (through `plan/resolve.ts`), or a decision record (`decision/<NNNN>`, through `decisions/parse.ts`).
3. Run the matching command: `specplane spec approve <id>`, `specplane plan approve <id>`, or `specplane decision accept <id>`; several IDs of one kind may go in one command, which stops at the first refusal.
4. On a refusal, report the reason and the fix for that ID and stop. Do not retry another way and do not edit frontmatter directly.
5. In reopen mode, run `specplane spec reopen <id>` and show the specs it reports as no longer able to stay approved; reopen one only when the user asks for it.

## Output

One line per ID: the commit that approved it, or the refusal and its fix. In reopen mode, the reopen commit and the reported dependants with their commands.
