---
name: specplane
description: "Use Specplane workflows for specifications and plans in this repository: read the matching contract, then follow it."
---
# Specplane

Read `.specplane/config.yaml` through the Specplane tools first and resolve every path from it. Before acting on a workflow, read its contract file below in full and follow its steps in order. A contract names Specplane harness actions; call them as the tools of the `specplane` MCP server and never run the Specplane CLI yourself.

If a contract needs a capability this setup lacks (for example the MCP tools are not registered), stop and name what is missing. Do not substitute another route, and do not approve anything on the user's behalf.

| Workflow | Use for | Contract |
|----------|---------|----------|
| `spec-assist` | Write or change a specification together with the user. | `contracts/spec-assist.md` |
| `spec-draft-architecture` | Draft an architecture specification from feature specifications. | `contracts/spec-draft-architecture.md` |
| `plan-create` | Create a new plan from the specifications it implements. | `contracts/plan-create.md` |
| `plan-start` | Start a plan: create its worktree and report where to continue it. | `contracts/plan-start.md` |
| `plan-step` | Execute the next selected steps of a plan, one at a time. | `contracts/plan-step.md` |
| `plan-finish` | Run the final review of a plan and decide whether it is complete. | `contracts/plan-finish.md` |
| `plan-status` | Show plans with live status and the next step. | `contracts/plan-status.md` |
| `validate` | Check the specifications and show warnings and coverage. | `contracts/validate.md` |
| `verify` | Judge an architecture specification against its implementation and record evidence. | `contracts/verify.md` |
| `plan-abandon` | Abandon a plan after the user confirms. | `contracts/plan-abandon.md` |

- `approve`: not offered in Codex, because approval is a typed, user-only command and Codex has no verified way to run one without a model turn. The user can run it in their own terminal.
- `requests`: not offered in Codex, because the requests pane is a typed, user-only command and Codex has no verified way to run one without a model turn. The user can run it in their own terminal.
