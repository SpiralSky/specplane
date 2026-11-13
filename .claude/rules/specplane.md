## Specplane

This repository uses Specplane. Before acting on specs or plans, read `.specplane/config.yaml` through the harness and resolve every path from it; never assume one.
Look up your steering for your role and follow it. Use the Specplane harness actions, never the Specplane CLI.
Load the documentation essentials with `docs.essentials` at the start of a session; when you lack information, search the rest with `docs.search` instead of guessing.
If the project has no Specplane configuration, do not apply Specplane rules.

Before a model command workflow, call `command.begin` with its command name so the harness applies that command’s session restrictions. A new command replaces the previous one; never switch just to evade a refusal.

### Claude Code

- Commands: `/spec-assist`, `/spec-draft-architecture`, `/plan-create`, `/plan-step`, `/plan-finish`, `/plan-start`, `/plan-status`, `/plan-abandon`, `/validate`, `/verify`, `/approve`, `/requests`, `/spec-view`, `/decision-new`, `/migrate`, `/spec-review`.
- Commits: put `Specplane-Agent: $SPECPLANE_AGENT` and `Specplane-Session: $SPECPLANE_SESSION` in the trailers when those variables are set.
- In a plan checkout, the session start context names the plan and its next step; work only on that step.
